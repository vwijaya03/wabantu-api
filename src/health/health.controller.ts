import { Controller, Get, Inject } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import type Redis from 'ioredis';
import { Public } from '../common/decorators/public.decorator';
import { REDIS_CLIENT } from '../redis/redis.module';

@Controller({ path: 'health', version: '1' })
export class HealthController {
  constructor(
    @InjectDataSource() private readonly systemDs: DataSource,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Public()
  @Get()
  liveness() {
    return {
      status: 'ok',
      service: 'wabantu-api',
      ts: new Date().toISOString(),
    };
  }

  @Public()
  @Get('ready')
  async readiness() {
    const dbOk = await this.systemDs
      .query('SELECT 1')
      .then(() => true)
      .catch(() => false);
    const redisOk = await this.redis
      .ping()
      .then(() => true)
      .catch(() => false);
    return {
      status: dbOk && redisOk ? 'ok' : 'degraded',
      checks: { systemDb: dbOk, redis: redisOk },
    };
  }
}
