import {
  Body,
  Controller,
  Headers,
  Post,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { Public } from '../common/decorators/public.decorator';
import { AiAutoReplyService } from './ai-auto-reply.service';
import type { AiReplyJobPayload } from './dto/ai-reply-job.dto';

@Controller({ path: 'internal/ai', version: '1' })
export class AiInternalController {
  private readonly logger = new Logger(AiInternalController.name);

  constructor(
    private readonly aiAutoReply: AiAutoReplyService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Post('auto-reply')
  async process(
    @Headers('x-ai-internal-token') token: string | undefined,
    @Body() payload: AiReplyJobPayload,
  ) {
    this.logger.log(
      `internal auto-reply called tenant=${payload.tenantId} convo=${payload.conversationId} inbound=${payload.inboundMessageId}`,
    );
    this.assertInternalToken(token);
    try {
      return await this.aiAutoReply.processAutoReply(payload);
    } catch (err) {
      // Let BullMQ retry based on thrown errors; we still record root cause here.
      // Avoid logging secrets/token values.
      this.logger.warn(
        {
          err: (err as Error).message,
          tenantId: payload.tenantId,
          convoId: payload.conversationId,
        },
        'internal auto-reply failed',
      );
      throw err;
    }
  }

  @Public()
  @Post('auto-reply/fallback')
  async fallback(
    @Headers('x-ai-internal-token') token: string | undefined,
    @Body() payload: AiReplyJobPayload,
  ) {
    this.logger.log(
      `internal auto-reply fallback called tenant=${payload.tenantId} convo=${payload.conversationId} inbound=${payload.inboundMessageId}`,
    );
    this.assertInternalToken(token);
    try {
      await this.aiAutoReply.fallbackAutoReply(payload);
    } catch (err) {
      this.logger.warn(
        {
          err: (err as Error).message,
          tenantId: payload.tenantId,
          convoId: payload.conversationId,
        },
        'internal auto-reply fallback failed',
      );
      throw err;
    }
    return { ok: true };
  }

  private assertInternalToken(token: string | undefined): void {
    const expected = this.config.get<string>('ai.internalToken') ?? '';
    if (!expected || !token) {
      throw new UnauthorizedException('Unauthorized internal request');
    }
    const a = Buffer.from(token);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Unauthorized internal request');
    }
  }
}
