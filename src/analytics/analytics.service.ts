import { Injectable } from '@nestjs/common';
import { MoreThanOrEqual, Repository } from 'typeorm';
import { resolveReportingTimezone } from '../common/utils/timezone.util';
import { TenantConnectionService } from '../database/tenant/tenant-connection.service';
import { BusinessProfile } from '../database/tenant/entities/business-profile.entity';
import { Conversation } from '../database/tenant/entities/conversation.entity';
import { Lead } from '../database/tenant/entities/lead.entity';
import { Message } from '../database/tenant/entities/message.entity';
import type { AuthUser } from '../common/types/request.types';

/** Raw SQL must qualify tenant schema — `DataSource.query` does not inherit TypeORM `schema` search_path. */
function qualifiedTable(repo: Repository<Message>): string {
  const { schema, tableName } = repo.metadata;
  const esc = (id: string) => id.replace(/"/g, '""');
  if (schema != null && schema.length > 0) {
    return `"${esc(schema)}"."${esc(tableName)}"`;
  }
  return `"${esc(tableName)}"`;
}

@Injectable()
export class AnalyticsService {
  constructor(private readonly tenantConn: TenantConnectionService) {}

  /**
   * Count rows whose instant falls in the current **calendar day** in the tenant
   * reporting timezone (`reportingTz`).
   * in the tenant’s reporting timezone. Uses an explicit [start, end) range
   * in that zone so comparisons stay
   * correct for `timestamptz` and avoid brittle `::date = ::date` equality.
   */
  private countMessagesOnLocalCalendarDay(
    msgRepo: Repository<Message>,
    partial: { direction: 'in' | 'out'; author?: 'ai' | 'human' | 'contact' },
    reportingTz: string,
  ) {
    const tz = reportingTz;
    const qb = msgRepo
      .createQueryBuilder('m')
      .where('m.direction = :direction', { direction: partial.direction })
      .andWhere(
        'm.created_at >= ((CURRENT_TIMESTAMP AT TIME ZONE :tzStart)::date AT TIME ZONE :tzStart)',
        { tzStart: tz },
      )
      .andWhere(
        "m.created_at < (((CURRENT_TIMESTAMP AT TIME ZONE :tzEnd)::date + interval '1 day') AT TIME ZONE :tzEnd)",
        { tzEnd: tz },
      );
    if (partial.author !== undefined) {
      qb.andWhere('m.author = :author', { author: partial.author });
    }
    return qb.getCount();
  }

  async overview(user: AuthUser, days: number) {
    const ds = await this.tenantConn.getDataSourceForTenant(user.tenantId);
    const msgRepo = ds.getRepository(Message);
    const convoRepo = ds.getRepository(Conversation);
    const leadRepo = ds.getRepository(Lead);
    const profileRepo = ds.getRepository(BusinessProfile);
    const profile = await profileRepo.findOne({
      where: {},
      order: { createdAt: 'ASC' },
    });
    const reportingTz = resolveReportingTimezone(profile?.reportingTimezone);

    const safeDays = Number.isFinite(days)
      ? Math.max(1, Math.min(90, Math.floor(days)))
      : 30;
    const since = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000);

    const [
      totalMessages,
      inboundMessages,
      aiReplies,
      humanReplies,
      leads,
      unread,
      todayInbound,
      todayAiReplies,
      outboundInWindow,
      outboundReadInWindow,
    ] = await Promise.all([
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
      this.countMessagesOnLocalCalendarDay(
        msgRepo,
        { direction: 'in' },
        reportingTz,
      ),
      this.countMessagesOnLocalCalendarDay(
        msgRepo,
        {
          direction: 'out',
          author: 'ai',
        },
        reportingTz,
      ),
      msgRepo.count({
        where: { direction: 'out', createdAt: MoreThanOrEqual(since) },
      }),
      msgRepo.count({
        where: {
          direction: 'out',
          status: 'read',
          createdAt: MoreThanOrEqual(since),
        },
      }),
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

    const todayAiCoveragePct =
      todayInbound > 0
        ? Math.round((todayAiReplies / todayInbound) * 100)
        : todayAiReplies > 0
          ? 100
          : 0;

    const openRatePct =
      outboundInWindow > 0
        ? Math.round((outboundReadInWindow / outboundInWindow) * 100)
        : null;

    const msgTable = qualifiedTable(msgRepo);
    const avgRows = await msgRepo.manager.query<
      { avg_sec: string | null }[]
    >(
      `
      SELECT AVG(EXTRACT(EPOCH FROM (fo.first_out - fi.first_in)))::float AS avg_sec
      FROM (
        SELECT conversation_id, MIN(created_at) AS first_in
        FROM ${msgTable}
        WHERE direction = 'in' AND created_at >= $1
        GROUP BY conversation_id
      ) fi
      INNER JOIN (
        SELECT conversation_id, MIN(created_at) AS first_out
        FROM ${msgTable}
        WHERE direction = 'out' AND author IN ('ai', 'human') AND created_at >= $1
        GROUP BY conversation_id
      ) fo ON fo.conversation_id = fi.conversation_id
      WHERE fo.first_out > fi.first_in
      `,
      [since],
    );
    const rawAvg = avgRows?.[0]?.avg_sec;
    const avgFirstResponseSec =
      rawAvg != null && Number.isFinite(Number(rawAvg))
        ? Number(rawAvg)
        : null;

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
      today: {
        inbound: todayInbound,
        aiReplies: todayAiReplies,
        aiCoveragePct: todayAiCoveragePct,
      },
      /** IANA zone used for `today.*` boundaries (from business profile). */
      reportingTimezone: reportingTz,
      overview: {
        /** % of outbound messages marked read in the rolling window (WhatsApp read receipts). */
        openRatePct,
        /** Seconds from first inbound to first human/AI reply in window; null if not enough data. */
        avgFirstResponseSec,
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
