import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { In } from 'typeorm';
import { TenantConnectionService } from '../database/tenant/tenant-connection.service';
import { Contact } from '../database/tenant/entities/contact.entity';
import { Conversation } from '../database/tenant/entities/conversation.entity';
import { Message } from '../database/tenant/entities/message.entity';
import { WhatsappChannel } from '../database/tenant/entities/whatsapp-channel.entity';
import type { AuthUser } from '../common/types/request.types';
import { MetaCloudProvider } from '../whatsapp/providers/meta-cloud.provider';

interface ListConversationsParams {
  search?: string;
  unreadOnly?: boolean;
  aiHandled?: boolean;
}

@Injectable()
export class InboxService {
  constructor(
    private readonly tenantConn: TenantConnectionService,
    private readonly metaCloud: MetaCloudProvider,
  ) {}

  private async repos(tenantId: string) {
    const ds = await this.tenantConn.getDataSourceForTenant(tenantId);
    return {
      convoRepo: ds.getRepository(Conversation),
      contactRepo: ds.getRepository(Contact),
      msgRepo: ds.getRepository(Message),
      channelRepo: ds.getRepository(WhatsappChannel),
    };
  }

  async listConversations(user: AuthUser, params: ListConversationsParams) {
    const { convoRepo, contactRepo, channelRepo } = await this.repos(user.tenantId);
    const qb = convoRepo
      .createQueryBuilder('c')
      .orderBy('c.lastMessageAt', 'DESC', 'NULLS LAST')
      .addOrderBy('c.updatedAt', 'DESC');

    if (params.unreadOnly) qb.andWhere('c.unreadCount > 0');
    if (typeof params.aiHandled === 'boolean') {
      qb.andWhere('c.aiHandled = :aiHandled', { aiHandled: params.aiHandled });
    }

    const rows = await qb.getMany();
    if (rows.length === 0) return [];

    const contactIds = [...new Set(rows.map((r) => r.contactId))];
    const channelIds = [...new Set(rows.map((r) => r.channelId))];
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

    let out = rows.map((row) => {
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

    const search = params.search?.trim().toLowerCase();
    if (search) {
      out = out.filter((item) => {
        const hay = [
          item.contact.displayName ?? '',
          item.contact.phoneNumber,
          item.lastMessagePreview ?? '',
          item.channel.displayName,
        ]
          .join(' ')
          .toLowerCase();
        return hay.includes(search);
      });
    }
    return out;
  }

  async getMessages(user: AuthUser, conversationId: string) {
    const { convoRepo, msgRepo } = await this.repos(user.tenantId);
    const convo = await convoRepo.findOne({ where: { id: conversationId } });
    if (!convo) throw new NotFoundException('Percakapan tidak ditemukan');
    return msgRepo.find({
      where: { conversationId },
      order: { createdAt: 'ASC' },
    });
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

    return saved;
  }
}
