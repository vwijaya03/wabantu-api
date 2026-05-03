import { Injectable } from '@nestjs/common';
import { MoreThanOrEqual } from 'typeorm';
import { TenantConnectionService } from '../database/tenant/tenant-connection.service';
import { Conversation } from '../database/tenant/entities/conversation.entity';
import { Lead } from '../database/tenant/entities/lead.entity';
import { Message } from '../database/tenant/entities/message.entity';
import type { AuthUser } from '../common/types/request.types';

@Injectable()
export class AnalyticsService {
  constructor(private readonly tenantConn: TenantConnectionService) {}

  async overview(user: AuthUser, days: number) {
    const ds = await this.tenantConn.getDataSourceForTenant(user.tenantId);
    const msgRepo = ds.getRepository(Message);
    const convoRepo = ds.getRepository(Conversation);
    const leadRepo = ds.getRepository(Lead);

    const safeDays = Number.isFinite(days)
      ? Math.max(1, Math.min(90, Math.floor(days)))
      : 30;
    const since = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000);

    const [totalMessages, inboundMessages, aiReplies, humanReplies, leads, unread] =
      await Promise.all([
        msgRepo.count({ where: { createdAt: MoreThanOrEqual(since) } }),
        msgRepo.count({
          where: { direction: 'in', createdAt: MoreThanOrEqual(since) },
        }),
        msgRepo.count({
          where: {
            direction: 'out',
            author: 'ai',
            createdAt: MoreThanOrEqual(since),
          },
        }),
        msgRepo.count({
          where: {
            direction: 'out',
            author: 'human',
            createdAt: MoreThanOrEqual(since),
          },
        }),
        leadRepo.count({ where: { createdAt: MoreThanOrEqual(since) } }),
        convoRepo
          .createQueryBuilder('c')
          .select('COALESCE(SUM(c.unreadCount),0)', 'sum')
          .getRawOne<{ sum: string }>(),
      ]);

    const topQuestionsRows = await msgRepo
      .createQueryBuilder('m')
      .select('LOWER(TRIM(m.body))', 'question')
      .addSelect('COUNT(1)', 'count')
      .where('m.direction = :direction', { direction: 'in' })
      .andWhere('m.type = :type', { type: 'text' })
      .andWhere('m.created_at >= :since', { since })
      .andWhere("m.body IS NOT NULL AND char_length(TRIM(m.body)) >= 4")
      .groupBy('LOWER(TRIM(m.body))')
      .orderBy('COUNT(1)', 'DESC')
      .limit(5)
      .getRawMany<{ question: string; count: string }>();

    const aiCoveragePct =
      inboundMessages > 0 ? Math.round((aiReplies / inboundMessages) * 100) : 0;
    const handoffRatePct =
      inboundMessages > 0 ? Math.round((humanReplies / inboundMessages) * 100) : 0;
    const conversionEstimatePct = Math.min(
      100,
      Math.round((leads / Math.max(inboundMessages, 1)) * 100 * 1.4),
    );

    return {
      windowDays: safeDays,
      totals: {
        totalMessages,
        inboundMessages,
        aiReplies,
        humanReplies,
        leadsGenerated: leads,
        unreadConversations: Number(unread?.sum ?? 0),
      },
      kpis: {
        aiCoveragePct,
        handoffRatePct,
        conversionEstimatePct,
      },
      topQuestions: topQuestionsRows.map((row) => ({
        question: row.question,
        count: Number(row.count),
      })),
    };
  }
}
