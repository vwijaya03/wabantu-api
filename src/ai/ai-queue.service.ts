import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { AI_REPLY_JOB, AI_REPLY_QUEUE } from './ai.constants';
import type { AiReplyJobPayload } from './dto/ai-reply-job.dto';

@Injectable()
export class AiQueueService {
  private readonly logger = new Logger(AiQueueService.name);

  constructor(@InjectQueue(AI_REPLY_QUEUE) private readonly queue: Queue) {}

  async enqueueAutoReply(payload: AiReplyJobPayload): Promise<void> {
    // BullMQ restricts custom jobId characters; avoid ":" and keep it URL/Redis friendly.
    const jobId = `${payload.tenantId}_${payload.inboundMessageId}`;
    await this.queue.add(AI_REPLY_JOB, payload, {
      jobId,
      removeOnComplete: 500,
      removeOnFail: 1000,
      attempts: 4,
      backoff: {
        type: 'exponential',
        delay: 5_000,
      },
    });
    this.logger.log(`Queued AI reply job ${jobId} convo=${payload.conversationId}`);
  }
}
