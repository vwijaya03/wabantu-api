import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RedisConfig } from '../config/configuration';
import { MetaCloudProvider } from '../whatsapp/providers/meta-cloud.provider';
import { AI_REPLY_QUEUE } from './ai.constants';
import { AiAutoReplyService } from './ai-auto-reply.service';
import { AiInternalController } from './ai-internal.controller';
import { AiPromptBuilderService } from './ai-prompt-builder.service';
import { AiQueueService } from './ai-queue.service';
import { AiSafetyService } from './ai-safety.service';
import { AnthropicAiService } from './anthropic-ai.service';

@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const redis = config.getOrThrow<RedisConfig>('redis');
        return {
          connection: {
            host: redis.host,
            port: redis.port,
            password: redis.password,
            db: redis.bullmqDb,
          },
        };
      },
    }),
    BullModule.registerQueue({ name: AI_REPLY_QUEUE }),
  ],
  controllers: [AiInternalController],
  providers: [
    MetaCloudProvider,
    AiQueueService,
    AiSafetyService,
    AiPromptBuilderService,
    AnthropicAiService,
    AiAutoReplyService,
  ],
  exports: [AiQueueService],
})
export class AiModule {}
