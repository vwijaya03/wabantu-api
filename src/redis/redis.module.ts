import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { RedisConfig } from '../config/configuration';

export const REDIS_CLIENT = 'REDIS_CLIENT';

/**
 * Single shared ioredis client used for:
 *  - session storage (auth)
 *  - app-level caching
 *
 * BullMQ uses its own client created in BullModule.forRoot — we keep
 * them separate so a slow queue job can't starve the auth/cache traffic.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const c = config.getOrThrow<RedisConfig>('redis');
        return new Redis({
          host: c.host,
          port: c.port,
          password: c.password,
          db: c.db,
          keyPrefix: c.keyPrefix,
          maxRetriesPerRequest: null,
          enableReadyCheck: true,
          lazyConnect: false,
        });
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
