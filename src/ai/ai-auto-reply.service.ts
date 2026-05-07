import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import type Redis from 'ioredis';
import { Repository } from 'typeorm';
import { TenantConnectionService } from '../database/tenant/tenant-connection.service';
import { BusinessProfile } from '../database/tenant/entities/business-profile.entity';
import { Contact } from '../database/tenant/entities/contact.entity';
import { Conversation } from '../database/tenant/entities/conversation.entity';
import { KnowledgeBaseEntry } from '../database/tenant/entities/knowledge-base-entry.entity';
import { Message } from '../database/tenant/entities/message.entity';
import { WhatsappChannel } from '../database/tenant/entities/whatsapp-channel.entity';
import { MetaCloudProvider } from '../whatsapp/providers/meta-cloud.provider';
import { REDIS_CLIENT } from '../redis/redis.module';
import { AiPromptBuilderService } from './ai-prompt-builder.service';
import { AnthropicAiService } from './anthropic-ai.service';
import { AiSafetyService } from './ai-safety.service';
import type { AiReplyJobPayload } from './dto/ai-reply-job.dto';

@Injectable()
export class AiAutoReplyService {
  private readonly logger = new Logger(AiAutoReplyService.name);
  private static readonly REASON_AI_GENERATED = 'ai_generated';
  private static readonly REASON_PROFILE_INCOMPLETE = 'profile_incomplete';
  private static readonly REASON_NON_QUESTION = 'non_question';
  private static readonly REASON_OUT_OF_SCOPE = 'out_of_scope';
  private static readonly LLM_CONFIDENCE_THRESHOLD = 0.65;

  constructor(
    private readonly tenantConn: TenantConnectionService,
    private readonly metaCloud: MetaCloudProvider,
    private readonly promptBuilder: AiPromptBuilderService,
    private readonly anthropic: AnthropicAiService,
    private readonly safety: AiSafetyService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  private redactForLog(raw: string | null | undefined): string {
    if (!raw) return '';
    return raw
      .replace(/\d/g, '#')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80);
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 2);
  }

  private overlapScore(a: string[], b: string[]): number {
    if (a.length === 0 || b.length === 0) return 0;
    const setA = new Set(a);
    const setB = new Set(b);
    let intersection = 0;
    for (const x of setA) if (setB.has(x)) intersection += 1;
    const denom = setA.size + setB.size;
    return denom > 0 ? (2 * intersection) / denom : 0;
  }

  private classifyMessage(input: {
    userText: string;
    inScope: boolean;
    profile: BusinessProfile;
  }): {
    label:
      | 'in_scope_question'
      | 'in_scope_non_question'
      | 'out_of_scope'
      | 'order_intent'
      | 'sensitive_escalate';
    confidence: number;
  } {
    const text = input.userText.toLowerCase();
    const hasOrderIntent = [
      'order',
      'pesan',
      'beli',
      'checkout',
      'jadi ambil',
      'jadi beli',
    ].some((k) => text.includes(k));
    const sensitive = [
      'penipuan',
      'fraud',
      'komplain keras',
      'lapor polisi',
      'ancam',
      'refund gagal',
      'tagihan salah',
    ].some((k) => text.includes(k));

    if (sensitive) return { label: 'sensitive_escalate', confidence: 0.98 };
    if (!input.inScope) return { label: 'out_of_scope', confidence: 0.9 };
    if (hasOrderIntent) return { label: 'order_intent', confidence: 0.88 };
    if (this.safety.isQuestionLike(input.userText)) {
      return { label: 'in_scope_question', confidence: 0.8 };
    }
    return { label: 'in_scope_non_question', confidence: 0.8 };
  }

  private retrieveHybridKb(query: string, kb: KnowledgeBaseEntry[]): KnowledgeBaseEntry[] {
    const qTokens = this.tokenize(query);
    const scored = kb.map((entry) => {
      const text = `${entry.question} ${entry.answer}`;
      const eTokens = this.tokenize(text);
      const lexical = this.overlapScore(qTokens, eTokens);
      const semantic = this.overlapScore(
        this.safety.extractScopeKeywords(query),
        this.safety.extractScopeKeywords(text),
      );
      const rerank = this.overlapScore(this.tokenize(entry.question), qTokens);
      const score = lexical * 0.5 + semantic * 0.3 + rerank * 0.2;
      return { entry, score };
    });
    return scored
      .sort((a, b) => b.score - a.score)
      .filter((x) => x.score > 0)
      .slice(0, 8)
      .map((x) => x.entry);
  }

  private normalizeQuestionForCache(text: string): string {
    return this.tokenize(text).join(' ').slice(0, 240);
  }

  private cacheKey(tenantId: string, normalizedQuestion: string): string {
    const hash = createHash('sha256').update(normalizedQuestion).digest('hex');
    return `ai:faqcache:${tenantId}:${hash}`;
  }

  private async getCachedCanonicalAnswer(
    tenantId: string,
    userText: string,
  ): Promise<string | null> {
    const normalized = this.normalizeQuestionForCache(userText);
    if (!normalized) return null;
    return this.redis.get(this.cacheKey(tenantId, normalized));
  }

  private async setCachedCanonicalAnswer(
    tenantId: string,
    userText: string,
    answer: string,
  ): Promise<void> {
    const normalized = this.normalizeQuestionForCache(userText);
    if (!normalized) return;
    const key = this.cacheKey(tenantId, normalized);
    await this.redis.set(key, answer, 'EX', 24 * 60 * 60);
  }

  private async getOrderState(
    tenantId: string,
    conversationId: string,
  ): Promise<{ step: string; product?: string; variant?: string; qty?: number } | null> {
    const raw = await this.redis.get(`ai:order:${tenantId}:${conversationId}`);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as { step: string; product?: string; variant?: string; qty?: number };
    } catch {
      return null;
    }
  }

  private async setOrderState(
    tenantId: string,
    conversationId: string,
    state: { step: string; product?: string; variant?: string; qty?: number },
  ): Promise<void> {
    await this.redis.set(
      `ai:order:${tenantId}:${conversationId}`,
      JSON.stringify(state),
      'EX',
      2 * 60 * 60,
    );
  }

  private async clearOrderState(tenantId: string, conversationId: string): Promise<void> {
    await this.redis.del(`ai:order:${tenantId}:${conversationId}`);
  }

  private applyOutputPolicy(text: string): string {
    const cleaned = text
      .replace(/```[\s\S]*?```/g, '')
      .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
      .trim()
      .slice(0, 1200);
    const blocked = /(system prompt|api key|database|server root|drop table)/i.test(cleaned);
    if (blocked) {
      return 'Maaf kak, untuk keamanan kami hanya bisa bantu pertanyaan seputar produk, harga, stok, dan order ya 🙏';
    }
    return cleaned;
  }

  private isBusinessProfileComplete(profile: BusinessProfile): boolean {
    const filled = (v: string | null | undefined) =>
      typeof v === 'string' && v.trim().length > 0;
    return (
      profile.businessName.trim().length >= 2 &&
      filled(profile.description) &&
      filled(profile.address) &&
      filled(profile.openingHours) &&
      filled(profile.productsServices) &&
      filled(profile.basePricing) &&
      filled(profile.deliveryArea)
    );
  }

  private counterKey(
    tenantId: string,
    conversationId: string,
    kind: 'offscope' | 'nonscope',
  ): string {
    return `ai:counter:${kind}:${tenantId}:${conversationId}`;
  }

  private async bumpCounter(
    tenantId: string,
    conversationId: string,
    kind: 'offscope' | 'nonscope',
  ): Promise<number> {
    const key = this.counterKey(tenantId, conversationId, kind);
    const n = await this.redis.incr(key);
    // Keep short memory window to avoid permanent penalties.
    await this.redis.expire(key, 6 * 60 * 60);
    return n;
  }

  private async resetScopeCounters(
    tenantId: string,
    conversationId: string,
  ): Promise<void> {
    await this.redis.del(
      this.counterKey(tenantId, conversationId, 'offscope'),
      this.counterKey(tenantId, conversationId, 'nonscope'),
    );
  }

  private nonAiDefaultReply(profile: BusinessProfile): string {
    const scope = profile.productsServices?.trim();
    if (!scope) {
      return 'Maaf kak, tim CS kami akan segera menghubungi kakak untuk bantu lebih lanjut ya 🙏';
    }
    return `Maaf kak, tim CS kami akan segera menghubungi kakak. Saat ini kami fokus bantu seputar: ${scope}.`;
  }

  private scopeDirectionReply(profile: BusinessProfile): string {
    const scope = profile.productsServices?.trim();
    if (!scope) {
      return 'Boleh kak, biar tepat, bisa tanya seputar produk, harga, stok, atau pengiriman dari bisnis kami ya.';
    }
    return `Boleh kak, biar tepat kami bantu pertanyaan seputar: ${scope}. Bisa tanya harga/stok/order ya.`;
  }

  private outOfScopeReply(profile: BusinessProfile): string {
    const scope = profile.productsServices?.trim();
    if (!scope) {
      return 'Maaf kak, itu di luar topik bisnis kami ya. Tim CS kami akan bantu follow-up jika diperlukan.';
    }
    return `Maaf kak, itu di luar topik bisnis kami ya. Kami fokus pada: ${scope}.`;
  }

  async processAutoReply(payload: AiReplyJobPayload): Promise<{ sent: boolean }> {
    this.logger.log(
      `AI job start tenant=${payload.tenantId} convo=${payload.conversationId} inbound=${payload.inboundMessageId}`,
    );
    const ds = await this.tenantConn.getDataSourceForTenant(payload.tenantId);
    const convoRepo = ds.getRepository(Conversation);
    const msgRepo = ds.getRepository(Message);
    const contactRepo = ds.getRepository(Contact);
    const profileRepo = ds.getRepository(BusinessProfile);
    const kbRepo = ds.getRepository(KnowledgeBaseEntry);
    const channelRepo = ds.getRepository(WhatsappChannel);

    const [convo, inbound] = await Promise.all([
      convoRepo.findOne({ where: { id: payload.conversationId } }),
      msgRepo.findOne({ where: { id: payload.inboundMessageId } }),
    ]);
    if (!convo || !inbound) {
      this.logger.warn('AI job: missing convo or inbound message');
      return { sent: false };
    }
    if (!convo.aiHandled) {
      this.logger.warn(`AI job: convo.aiHandled=false convo=${convo.id}`);
      /**
       * Important: if humans are currently taking over (aiHandled=false),
       * conversation state can flip back to aiHandled=true shortly after.
       * So we fail the job to let BullMQ retry instead of dropping it.
       */
      throw new Error('AI_HANDOFF_PAUSED');
    }
    if (inbound.direction !== 'in' || inbound.author !== 'contact') {
      this.logger.warn('AI job: inbound not a contact inbound');
      return { sent: false };
    }
    if (inbound.type !== 'text') {
      this.logger.warn(`AI job: inbound type=${inbound.type} not supported`);
      return { sent: false };
    }

    const [profile, contact, channel] = await Promise.all([
      profileRepo.findOne({ where: {} }),
      contactRepo.findOne({ where: { id: convo.contactId } }),
      channelRepo.findOne({ where: { id: convo.channelId } }),
    ]);
    if (!profile?.aiEnabled) {
      this.logger.warn('AI job: aiEnabled=false');
      return { sent: false };
    }
    if (!contact || !channel) {
      this.logger.warn('AI job: missing contact or channel');
      return { sent: false };
    }
    if (channel.provider !== 'meta_cloud' || channel.status !== 'connected') {
      this.logger.warn(
        `AI job: unsupported/invalid channel provider=${channel.provider} status=${channel.status}`,
      );
      return { sent: false };
    }
    if (!channel.accessToken || !channel.metaPhoneNumberId) {
      this.logger.warn('AI job: channel missing accessToken or metaPhoneNumberId');
      return { sent: false };
    }

    if (!this.isBusinessProfileComplete(profile)) {
      this.logger.warn('AI job: business profile incomplete, using CS default response');
      await this.sendAiMessage({
        msgRepo,
        convoRepo,
        convo,
        channel,
        contact,
        text: this.nonAiDefaultReply(profile),
        author: 'system',
        reason: AiAutoReplyService.REASON_PROFILE_INCOMPLETE,
      });
      return { sent: true };
    }

    const userText = this.safety.sanitizeForPrompt(inbound.body);
    this.logger.log(
      `AI job: inbound text snippet="${this.redactForLog(userText)}" len=${userText.length}`,
    );
    if (this.safety.isGreetingLike(userText)) {
      const greet = (profile.greetingTemplate ?? '').trim();
      const base =
        greet.length > 0
          ? greet
          : profile.tone === 'formal'
            ? 'Selamat siang, kak. Ada yang bisa kami bantu?'
            : 'Selamat siang kak! Ada yang bisa aku bantu?';
      await this.sendAiMessage({
        msgRepo,
        convoRepo,
        convo,
        channel,
        contact,
        text: base,
        reason: AiAutoReplyService.REASON_NON_QUESTION,
      });
      return { sent: true };
    }

    if (this.safety.isPromptInjectionLikely(userText)) {
      this.logger.warn(
        `Potential prompt injection tenant=${payload.tenantId} convo=${convo.id}`,
      );
      const spike = await this.bumpCounter(payload.tenantId, convo.id, 'offscope');
      await this.sendAiMessage({
        msgRepo,
        convoRepo,
        convo,
        channel,
        contact,
        text:
          spike >= 3
            ? this.nonAiDefaultReply(profile)
            : 'Maaf kak, untuk pertanyaan teknis sistem tidak bisa saya proses. Untuk info produk, harga, stok, atau pengiriman, aku bantu ya 🙏',
        reason: AiAutoReplyService.REASON_OUT_OF_SCOPE,
        author: 'system',
      });
      return { sent: true };
    }

    const [history, kb] = await Promise.all([
      msgRepo.find({
        where: { conversationId: convo.id },
        order: { createdAt: 'DESC' },
        take: 12,
      }),
      kbRepo.find({
        where: { isActive: true },
        order: { createdAt: 'DESC' },
        take: 20,
      }),
    ]);
    history.reverse();

    const scopeText = [
      profile.businessName,
      profile.description ?? '',
      profile.productsServices ?? '',
      profile.basePricing ?? '',
      profile.deliveryArea ?? '',
      ...kb.map((x) => `${x.question} ${x.answer}`),
    ].join(' ');
    const scopeKeywords = this.safety.extractScopeKeywords(scopeText);
    const inScope = this.safety.isWithinBusinessScope(userText, scopeKeywords, [
      'harga',
      'stok',
      'produk',
      'order',
      'pengiriman',
      'ukuran',
      'size',
    ]);
    const classifier = this.classifyMessage({ userText, inScope, profile });
    this.logger.log(
      `AI job: classifier label=${classifier.label} confidence=${classifier.confidence.toFixed(2)}`,
    );

    if (classifier.label === 'sensitive_escalate') {
      await this.sendAiMessage({
        msgRepo,
        convoRepo,
        convo,
        channel,
        contact,
        text: 'Maaf kak, untuk topik ini tim CS kami akan langsung mengambil alih dan segera menghubungi kakak 🙏',
        author: 'system',
        reason: AiAutoReplyService.REASON_OUT_OF_SCOPE,
      });
      convo.aiHandled = false;
      convo.aiPausedAt = new Date();
      convo.handoffReason = 'Sensitive/escalate detected';
      await convoRepo.save(convo);
      return { sent: true };
    }

    if (classifier.label === 'out_of_scope') {
      const c = await this.bumpCounter(payload.tenantId, convo.id, 'offscope');
      this.logger.warn(`AI job: out-of-business-scope (count=${c})`);
      await this.sendAiMessage({
        msgRepo,
        convoRepo,
        convo,
        channel,
        contact,
        text: c >= 3 ? this.nonAiDefaultReply(profile) : this.outOfScopeReply(profile),
        author: 'system',
        reason: AiAutoReplyService.REASON_OUT_OF_SCOPE,
      });
      return { sent: true };
    }

    if (classifier.label === 'in_scope_non_question') {
      const c = await this.bumpCounter(payload.tenantId, convo.id, 'nonscope');
      this.logger.warn(`AI job: in-scope non-question (count=${c})`);
      await this.sendAiMessage({
        msgRepo,
        convoRepo,
        convo,
        channel,
        contact,
        text: c >= 3 ? this.nonAiDefaultReply(profile) : this.scopeDirectionReply(profile),
        author: 'system',
        reason: AiAutoReplyService.REASON_NON_QUESTION,
      });
      return { sent: true };
    }

    if (
      classifier.label === 'in_scope_question' &&
      classifier.confidence < AiAutoReplyService.LLM_CONFIDENCE_THRESHOLD
    ) {
      await this.sendAiMessage({
        msgRepo,
        convoRepo,
        convo,
        channel,
        contact,
        text: this.scopeDirectionReply(profile),
        author: 'system',
        reason: AiAutoReplyService.REASON_NON_QUESTION,
      });
      return { sent: true };
    }

    if (classifier.label === 'order_intent') {
      const state = await this.getOrderState(payload.tenantId, convo.id);
      const size = userText.match(/\b(xs|s|m|l|xl|xxl|xxxl|3xl|4xl|5xl|\d{2})\b/i)?.[0];
      const qty = userText.match(/\b(\d{1,3})\s?(pcs|biji|buah|item)?\b/i)?.[1];
      const hasAddress = /(jalan|jl\.|rt|rw|kel\.|kec\.|kota|kab\.|kode pos)/i.test(
        userText,
      );

      if (!state) {
        await this.setOrderState(payload.tenantId, convo.id, { step: 'ask_product' });
        await this.sendAiMessage({
          msgRepo,
          convoRepo,
          convo,
          channel,
          contact,
          text: 'Siap kak, mau order produk yang mana ya? Sekalian tulis varian/size kalau ada.',
          author: 'system',
          reason: AiAutoReplyService.REASON_NON_QUESTION,
        });
        return { sent: true };
      }

      if (state.step === 'ask_product') {
        await this.setOrderState(payload.tenantId, convo.id, {
          step: 'ask_variant',
          product: userText.slice(0, 120),
        });
        await this.sendAiMessage({
          msgRepo,
          convoRepo,
          convo,
          channel,
          contact,
          text: 'Baik kak. Untuk variannya apa ya (mis. size/warna)?',
          author: 'system',
          reason: AiAutoReplyService.REASON_NON_QUESTION,
        });
        return { sent: true };
      }

      if (state.step === 'ask_variant') {
        await this.setOrderState(payload.tenantId, convo.id, {
          ...state,
          step: 'ask_qty',
          variant: size ?? userText.slice(0, 60),
        });
        await this.sendAiMessage({
          msgRepo,
          convoRepo,
          convo,
          channel,
          contact,
          text: 'Siap kak. Mau pesan berapa pcs?',
          author: 'system',
          reason: AiAutoReplyService.REASON_NON_QUESTION,
        });
        return { sent: true };
      }

      if (state.step === 'ask_qty') {
        await this.setOrderState(payload.tenantId, convo.id, {
          ...state,
          step: 'ask_address',
          qty: qty ? Number(qty) : undefined,
        });
        await this.sendAiMessage({
          msgRepo,
          convoRepo,
          convo,
          channel,
          contact,
          text: 'Terima kasih kak. Boleh kirim alamat pengiriman lengkapnya ya.',
          author: 'system',
          reason: AiAutoReplyService.REASON_NON_QUESTION,
        });
        return { sent: true };
      }

      if (state.step === 'ask_address' && hasAddress) {
        await this.clearOrderState(payload.tenantId, convo.id);
        await this.sendAiMessage({
          msgRepo,
          convoRepo,
          convo,
          channel,
          contact,
          text: 'Sip kak, datanya sudah lengkap. Tim CS kami akan segera konfirmasi order kakak ya 🙏',
          author: 'system',
          reason: AiAutoReplyService.REASON_NON_QUESTION,
        });
        return { sent: true };
      }

      await this.sendAiMessage({
        msgRepo,
        convoRepo,
        convo,
        channel,
        contact,
        text: 'Boleh kak lanjutkan data ordernya, nanti tim CS bantu proses sampai selesai ya.',
        author: 'system',
        reason: AiAutoReplyService.REASON_NON_QUESTION,
      });
      return { sent: true };
    }

    await this.resetScopeCounters(payload.tenantId, convo.id);

    const cached = await this.getCachedCanonicalAnswer(payload.tenantId, userText);
    if (cached) {
      this.logger.log('AI job: using cached canonical answer');
      await this.sendAiMessage({
        msgRepo,
        convoRepo,
        convo,
        channel,
        contact,
        text: cached,
        reason: AiAutoReplyService.REASON_AI_GENERATED,
      });
      return { sent: true };
    }

    const kbHybrid = this.retrieveHybridKb(userText, kb);
    this.logger.log(`AI job: hybrid retrieval selected ${kbHybrid.length}/${kb.length} KB entries`);

    const sys = this.promptBuilder.buildSystemPrompt(profile);
    const business = this.promptBuilder.buildBusinessContext(profile);
    const kbCtx = this.promptBuilder.buildKnowledgeContext(kbHybrid);
    const histCtx = this.promptBuilder.buildConversationContext(history);
    this.logger.log(
      `AI job: context sizes sys=${sys.length} business=${business.length} kb=${kbCtx.length} hist=${histCtx.length}`,
    );

    let reply: string;
    try {
      reply = await this.anthropic.generateReply({
        system: sys,
        business,
        kb: kbCtx,
        history: histCtx,
        userMessage: userText,
      });
    } catch (err) {
      this.logger.error(
        {
          err: (err as Error).message,
          tenantId: payload.tenantId,
          convoId: convo.id,
          inboundId: inbound.id,
        },
        'AI job: anthropic.generateReply failed',
      );
      throw err;
    }

    const finalReply = this.applyOutputPolicy(reply);
    await this.setCachedCanonicalAnswer(payload.tenantId, userText, finalReply);
    await this.sendAiMessage({
      msgRepo,
      convoRepo,
      convo,
      channel,
      contact,
      text: finalReply,
      reason: AiAutoReplyService.REASON_AI_GENERATED,
    });
    return { sent: true };
  }

  async fallbackAutoReply(payload: AiReplyJobPayload): Promise<void> {
    const ds = await this.tenantConn.getDataSourceForTenant(payload.tenantId);
    const convoRepo = ds.getRepository(Conversation);
    const msgRepo = ds.getRepository(Message);
    const contactRepo = ds.getRepository(Contact);
    const channelRepo = ds.getRepository(WhatsappChannel);
    const convo = await convoRepo.findOne({ where: { id: payload.conversationId } });
    if (!convo) return;
    const [contact, channel] = await Promise.all([
      contactRepo.findOne({ where: { id: convo.contactId } }),
      channelRepo.findOne({ where: { id: convo.channelId } }),
    ]);
    if (!contact || !channel || !channel.accessToken || !channel.metaPhoneNumberId) return;

    await this.sendAiMessage({
      msgRepo,
      convoRepo,
      convo,
      channel,
      contact,
      text: 'Maaf kak, saat ini sistem kami sedang sibuk. Tim kami akan bantu balas secepatnya ya 🙏',
      author: 'system',
      reason: AiAutoReplyService.REASON_NON_QUESTION,
    });

    convo.aiHandled = false;
    convo.aiPausedAt = new Date();
    convo.handoffReason = 'Auto fallback setelah retry AI gagal';
    await convoRepo.save(convo);
  }

  private async sendAiMessage(input: {
    msgRepo: Repository<Message>;
    convoRepo: Repository<Conversation>;
    convo: Conversation;
    channel: WhatsappChannel;
    contact: Contact;
    text: string;
    author?: 'ai' | 'system';
    reason:
      | 'non_question'
      | 'out_of_scope'
      | 'profile_incomplete'
      | 'ai_generated';
  }) {
    this.logger.log(
      `AI job: sending WhatsApp text len=${input.text.length} author=${input.author ?? 'ai'} reason=${input.reason}`,
    );
    let sendResult: { externalId: string };
    try {
      sendResult = await this.metaCloud.sendText(
        {
          displayName: input.channel.displayName,
          phoneNumber: input.channel.phoneNumber,
          accessToken: input.channel.accessToken!,
          metaPhoneNumberId: input.channel.metaPhoneNumberId ?? undefined,
          metaWabaId: input.channel.metaWabaId ?? undefined,
        },
        { to: input.contact.phoneNumber, body: input.text },
      );
    } catch (err) {
      this.logger.error(
        {
          err: (err as Error).message,
          conversationId: input.convo.id,
          contact: input.contact.phoneNumber,
        },
        'AI job: failed sending WhatsApp message',
      );
      throw err;
    }

    const saved = await input.msgRepo.save(
      input.msgRepo.create({
        conversationId: input.convo.id,
        externalId: sendResult.externalId,
        direction: 'out',
        author: input.author ?? 'ai',
        type: 'text',
        body: input.text,
        metadata: { reason: input.reason },
        status: 'sent',
      }),
    );
    input.convo.lastMessageAt = saved.createdAt;
    input.convo.lastMessagePreview = input.text.slice(0, 280);
    input.convo.status = 'open';
    await input.convoRepo.save(input.convo);
  }
}
