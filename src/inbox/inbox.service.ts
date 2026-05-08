import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import type Redis from 'ioredis';
import { Observable } from 'rxjs';
import { Brackets, In } from 'typeorm';
import { TenantConnectionService } from '../database/tenant/tenant-connection.service';
import { Contact } from '../database/tenant/entities/contact.entity';
import { Conversation } from '../database/tenant/entities/conversation.entity';
import { Message } from '../database/tenant/entities/message.entity';
import { Lead } from '../database/tenant/entities/lead.entity';
import { WhatsappChannel } from '../database/tenant/entities/whatsapp-channel.entity';
import type { AuthUser } from '../common/types/request.types';
import { REDIS_CLIENT } from '../redis/redis.module';
import { MetaCloudProvider } from '../whatsapp/providers/meta-cloud.provider';
import { inboxActivityStream, publishInboxActivity } from './inbox-realtime';
import {
  decodeCursor,
  encodeCursor,
  type ConversationListCursor,
  type MessageHistoryCursor,
} from './inbox-cursor';

interface ListConversationsParams {
  search?: string;
  unreadOnly?: boolean;
  aiHandled?: boolean;
  /** Page size (default 30, max 100). */
  limit?: number;
  /** Keyset cursor from previous page. */
  cursor?: string;
}

function clampLimit(raw: number | undefined, fallback: number, max: number) {
  if (raw == null || !Number.isFinite(raw)) return fallback;
  return Math.min(Math.max(Math.floor(raw), 1), max);
}

function toMessageDto(m: Message) {
  return {
    id: m.id,
    conversationId: m.conversationId,
    externalId: m.externalId,
    direction: m.direction,
    author: m.author,
    type: m.type,
    body: m.body,
    status: m.status,
    createdAt: m.createdAt,
  };
}

@Injectable()
export class InboxService {
  constructor(
    private readonly tenantConn: TenantConnectionService,
    private readonly metaCloud: MetaCloudProvider,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  subscribeInboxStream(tenantId: string): Observable<MessageEvent> {
    return inboxActivityStream(this.redis, tenantId);
  }

  private async repos(tenantId: string) {
    const ds = await this.tenantConn.getDataSourceForTenant(tenantId);
    return {
      convoRepo: ds.getRepository(Conversation),
      contactRepo: ds.getRepository(Contact),
      msgRepo: ds.getRepository(Message),
      channelRepo: ds.getRepository(WhatsappChannel),
      leadRepo: ds.getRepository(Lead),
    };
  }

  async getUnreadSummary(user: AuthUser) {
    const { convoRepo } = await this.repos(user.tenantId);
    const row = await convoRepo
      .createQueryBuilder('c')
      .select('COALESCE(SUM(c.unreadCount), 0)', 'sum')
      .getRawOne<{ sum: string }>();
    return { totalUnreadMessages: Number(row?.sum ?? 0) };
  }

  async listConversations(user: AuthUser, params: ListConversationsParams) {
    const limit = clampLimit(params.limit, 30, 100);
    const { convoRepo, contactRepo, channelRepo } = await this.repos(user.tenantId);
    const qb = convoRepo.createQueryBuilder('c');

    const search = params.search?.trim();
    if (search) {
      const like = `%${search.toLowerCase()}%`;
      qb.leftJoin(Contact, 'ct', 'ct.id = c.contactId')
        .leftJoin(WhatsappChannel, 'ch', 'ch.id = c.channelId')
        .andWhere(
          `(
            LOWER(ct.phone_number) LIKE :like OR
            LOWER(COALESCE(ct.display_name, '')) LIKE :like OR
            LOWER(COALESCE(c.last_message_preview, '')) LIKE :like OR
            LOWER(COALESCE(ch.display_name, '')) LIKE :like OR
            LOWER(COALESCE(ch.phone_number, '')) LIKE :like
          )`,
          { like },
        );
    }

    if (params.unreadOnly) qb.andWhere('c.unread_count > 0');
    if (typeof params.aiHandled === 'boolean') {
      qb.andWhere('c.ai_handled = :aiHandled', { aiHandled: params.aiHandled });
    }

    const cur = decodeCursor<ConversationListCursor>(params.cursor);
    if (cur?.id) {
      qb.andWhere(
        `(COALESCE(c.last_message_at, '-infinity'::timestamptz), c.id) < (COALESCE(:cursorLm::timestamptz, '-infinity'::timestamptz), :cursorId::uuid)`,
        {
          cursorLm: cur.lastMessageAt,
          cursorId: cur.id,
        },
      );
    }

    qb.orderBy('c.lastMessageAt', 'DESC', 'NULLS LAST')
      .addOrderBy('c.id', 'DESC')
      .take(limit + 1);

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    if (page.length === 0) {
      return { items: [], nextCursor: null as string | null };
    }

    const contactIds = [...new Set(page.map((r) => r.contactId))];
    const channelIds = [...new Set(page.map((r) => r.channelId))];
    const [contacts, channels] = await Promise.all([
      contactIds.length > 0
        ? contactRepo.find({ where: { id: In(contactIds) } })
        : Promise.resolve([]),
      channelIds.length > 0
        ? channelRepo.find({ where: { id: In(channelIds) } })
        : Promise.resolve([]),
    ]);
    const contactMap = new Map(contacts.map((c) => [c.id, c]));
    const channelMap = new Map(channels.map((c) => [c.id, c]));

    const items = page.map((row) => {
      const contact = contactMap.get(row.contactId);
      const channel = channelMap.get(row.channelId);
      return {
        id: row.id,
        status: row.status,
        aiHandled: row.aiHandled,
        unreadCount: row.unreadCount,
        lastMessageAt: row.lastMessageAt,
        lastMessagePreview: row.lastMessagePreview,
        assignedToName: row.assignedToName,
        handoffReason: row.handoffReason,
        contact: {
          id: row.contactId,
          displayName: contact?.displayName ?? null,
          phoneNumber: contact?.phoneNumber ?? '',
          tags: contact?.tags ?? [],
        },
        channel: {
          id: row.channelId,
          displayName: channel?.displayName ?? '',
          phoneNumber: channel?.phoneNumber ?? '',
        },
      };
    });

    const tail = page[page.length - 1]!;
    const nextCursor = hasMore
      ? encodeCursor({
          lastMessageAt: tail.lastMessageAt?.toISOString() ?? null,
          id: tail.id,
        } satisfies ConversationListCursor)
      : null;

    return { items, nextCursor };
  }

  /**
   * Message history: prefer keyset `cursor` = `{ createdAt, id }` (order `created_at DESC, id DESC`);
   * optional `offset` for legacy clients (do not combine with `cursor`).
   */
  async getMessages(
    user: AuthUser,
    conversationId: string,
    opts: { limit?: number; offset?: number; cursor?: string },
  ) {
    /** Default 50 when omitted; client may send 1–100 (e.g. 10 for smaller UI pages). */
    const take = clampLimit(opts.limit, 50, 100);
    const rawCursor = opts.cursor?.trim();
    const useKeyset = Boolean(rawCursor);

    if (useKeyset) {
      const off = opts.offset;
      if (off != null && Number.isFinite(off) && Math.floor(off) !== 0) {
        throw new BadRequestException(
          'Parameter cursor dan offset tidak boleh dipakai bersamaan.',
        );
      }
    }

    const { convoRepo, msgRepo } = await this.repos(user.tenantId);
    const convo = await convoRepo.findOne({ where: { id: conversationId } });
    if (!convo) throw new NotFoundException('Percakapan tidak ditemukan');

    const qb = msgRepo
      .createQueryBuilder('m')
      .where('m.conversation_id = :cid', { cid: conversationId })
      .orderBy('m.created_at', 'DESC')
      .addOrderBy('m.id', 'DESC')
      .take(take + 1);

    let offset = 0;
    if (useKeyset) {
      const decoded = decodeCursor<MessageHistoryCursor>(rawCursor);
      if (
        !decoded ||
        typeof decoded.id !== 'string' ||
        typeof decoded.createdAt !== 'string'
      ) {
        throw new BadRequestException('Cursor pesan tidak valid.');
      }
      const cursorAt = new Date(decoded.createdAt);
      if (Number.isNaN(cursorAt.getTime())) {
        throw new BadRequestException('Cursor pesan tidak valid.');
      }
      qb.andWhere(
        new Brackets((w) => {
          w.where('m.created_at < :cAt', { cAt: cursorAt }).orWhere(
            new Brackets((w2) => {
              w2
                .where('m.created_at = :cAt', { cAt: cursorAt })
                .andWhere('m.id < :cId', { cId: decoded.id });
            }),
          );
        }),
      );
    } else {
      const rawOff = opts.offset ?? 0;
      offset = Number.isFinite(rawOff)
        ? Math.min(Math.max(Math.floor(rawOff), 0), 500_000)
        : 0;
      qb.skip(offset);
    }

    const rows = await qb.getMany();

    const hasMore = rows.length > take;
    const slice = hasMore ? rows.slice(0, take) : rows;
    slice.reverse();

    let nextCursor: string | null = null;
    let nextOffset: number | null = null;
    if (hasMore) {
      const oldest = slice[0]!;
      /** Always expose keyset `nextCursor` so clients can load older pages without offset. */
      nextCursor = encodeCursor({
        createdAt: oldest.createdAt.toISOString(),
        id: oldest.id,
      } satisfies MessageHistoryCursor);
      if (!useKeyset) {
        nextOffset = offset + take;
      }
    }

    return {
      messages: slice.map(toMessageDto),
      nextCursor,
      nextOffset,
    };
  }

  async markAsRead(user: AuthUser, conversationId: string) {
    const { convoRepo } = await this.repos(user.tenantId);
    const convo = await convoRepo.findOne({ where: { id: conversationId } });
    if (!convo) throw new NotFoundException('Percakapan tidak ditemukan');
    convo.unreadCount = 0;
    return convoRepo.save(convo);
  }

  async handoffToHuman(
    user: AuthUser,
    conversationId: string,
    reason = 'Diambil alih manual oleh staff',
  ) {
    const { convoRepo, msgRepo } = await this.repos(user.tenantId);
    const convo = await convoRepo.findOne({ where: { id: conversationId } });
    if (!convo) throw new NotFoundException('Percakapan tidak ditemukan');

    convo.aiHandled = false;
    convo.aiPausedAt = new Date();
    convo.assignedToUserId = user.userId;
    convo.assignedToName = user.email;
    convo.handoffReason = reason.slice(0, 280);
    await convoRepo.save(convo);

    await msgRepo.save(
      msgRepo.create({
        conversationId: convo.id,
        externalId: null,
        direction: 'out',
        author: 'system',
        type: 'text',
        body: 'Staff mengambil alih percakapan ini.',
        metadata: { reason: convo.handoffReason },
        status: 'sent',
      }),
    );

    return convo;
  }

  async resumeAi(user: AuthUser, conversationId: string) {
    const { convoRepo, msgRepo } = await this.repos(user.tenantId);
    const convo = await convoRepo.findOne({ where: { id: conversationId } });
    if (!convo) throw new NotFoundException('Percakapan tidak ditemukan');
    convo.aiHandled = true;
    convo.aiPausedAt = null;
    convo.assignedToName = null;
    convo.assignedToUserId = null;
    convo.handoffReason = null;
    await convoRepo.save(convo);

    await msgRepo.save(
      msgRepo.create({
        conversationId: convo.id,
        externalId: null,
        direction: 'out',
        author: 'system',
        type: 'text',
        body: 'AI auto-reply diaktifkan kembali.',
        metadata: {},
        status: 'sent',
      }),
    );
    return convo;
  }

  async sendHumanMessage(user: AuthUser, conversationId: string, body: string) {
    const text = body.trim();
    if (!text) throw new BadRequestException('Isi pesan tidak boleh kosong');
    const { convoRepo, contactRepo, msgRepo, channelRepo } = await this.repos(
      user.tenantId,
    );
    const convo = await convoRepo.findOne({ where: { id: conversationId } });
    if (!convo) throw new NotFoundException('Percakapan tidak ditemukan');
    const [contact, channel] = await Promise.all([
      contactRepo.findOne({ where: { id: convo.contactId } }),
      channelRepo.findOne({ where: { id: convo.channelId } }),
    ]);
    if (!contact) throw new NotFoundException('Kontak tidak ditemukan');
    if (!channel) throw new NotFoundException('Channel tidak ditemukan');
    if (channel.status !== 'connected' || !channel.accessToken) {
      throw new BadRequestException(
        'Channel WhatsApp belum terhubung. Silakan reconnect.',
      );
    }
    if (channel.provider !== 'meta_cloud') {
      throw new BadRequestException('Provider channel belum didukung');
    }

    const sendResult = await this.metaCloud.sendText(
      {
        displayName: channel.displayName,
        phoneNumber: channel.phoneNumber,
        accessToken: channel.accessToken,
        metaPhoneNumberId: channel.metaPhoneNumberId ?? undefined,
        metaWabaId: channel.metaWabaId ?? undefined,
      },
      { to: contact.phoneNumber, body: text },
    );

    const saved = await msgRepo.save(
      msgRepo.create({
        conversationId,
        externalId: sendResult.externalId,
        direction: 'out',
        author: 'human',
        type: 'text',
        body: text,
        metadata: {},
        status: 'sent',
      }),
    );

    convo.lastMessageAt = saved.createdAt;
    convo.lastMessagePreview = text.slice(0, 280);
    convo.status = 'open';
    await convoRepo.save(convo);

    publishInboxActivity(this.redis, user.tenantId);

    return saved;
  }

  async getContact(user: AuthUser, contactId: string) {
    const { contactRepo } = await this.repos(user.tenantId);
    const contact = await contactRepo.findOne({ where: { id: contactId } });
    if (!contact) throw new NotFoundException('Kontak tidak ditemukan');
    return {
      id: contact.id,
      phoneNumber: contact.phoneNumber,
      displayName: contact.displayName,
      notes: contact.notes,
      tags: contact.tags,
    };
  }

  async updateContact(
    user: AuthUser,
    contactId: string,
    input: { displayName?: string; notes?: string },
  ) {
    const { contactRepo, leadRepo } = await this.repos(user.tenantId);
    const contact = await contactRepo.findOne({ where: { id: contactId } });
    if (!contact) throw new NotFoundException('Kontak tidak ditemukan');

    if (typeof input.displayName === 'string') {
      const v = input.displayName.trim();
      contact.displayName = v.length ? v : null;
    }
    if (typeof input.notes === 'string') {
      const v = input.notes.trim();
      contact.notes = v.length ? v : null;
    }

    await contactRepo.save(contact);

    // Keep lead.name in sync with the canonical contact display name.
    if (typeof input.displayName === 'string') {
      await leadRepo.update(
        { contactId },
        { name: contact.displayName ? contact.displayName.slice(0, 120) : null },
      );
    }

    return {
      id: contact.id,
      phoneNumber: contact.phoneNumber,
      displayName: contact.displayName,
      notes: contact.notes,
      tags: contact.tags,
    };
  }
}
