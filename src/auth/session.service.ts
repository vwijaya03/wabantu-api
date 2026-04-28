import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';
import type { AuthConfig } from '../config/configuration';
import { parseDurationToSeconds } from '../common/utils/duration.util';
import { REDIS_CLIENT } from '../redis/redis.module';
import type { AuthUser } from '../common/types/request.types';

/**
 * Server-truth session store backed by Redis.
 *
 * Why also use Redis when JWT already encodes identity?
 *  - Instant logout / password reset / device revoke ("kill switch").
 *  - Sliding TTL: every authenticated request bumps the session expiry,
 *    matching how UMKM owners expect "stay logged in if I'm using the app".
 *  - Audit trail: who logged in, when, from which IP/UA.
 *
 * Key layout (REDIS_KEY_PREFIX is added by ioredis automatically):
 *   sess:<sessionId>          -> JSON of AuthUser + meta (TTL = SESSION_TTL)
 *   sess:user:<userId>        -> SET of sessionIds (for "logout everywhere")
 */
@Injectable()
export class SessionService {
  private readonly ttlSeconds: number;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    config: ConfigService,
  ) {
    const auth = config.getOrThrow<AuthConfig>('auth');
    this.ttlSeconds = parseDurationToSeconds(auth.sessionTtl);
  }

  private sessKey(sessionId: string): string {
    return `sess:${sessionId}`;
  }
  private userSessionsKey(userId: string): string {
    return `sess:user:${userId}`;
  }

  async create(
    user: Omit<AuthUser, 'sessionId'>,
    meta: { ip?: string; ua?: string },
  ): Promise<AuthUser> {
    const sessionId = uuidv4();
    const full: AuthUser & { ip?: string; ua?: string; createdAt: number } = {
      ...user,
      sessionId,
      ip: meta.ip,
      ua: meta.ua,
      createdAt: Date.now(),
    };
    const pipe = this.redis.multi();
    pipe.set(
      this.sessKey(sessionId),
      JSON.stringify(full),
      'EX',
      this.ttlSeconds,
    );
    pipe.sadd(this.userSessionsKey(user.userId), sessionId);
    pipe.expire(this.userSessionsKey(user.userId), this.ttlSeconds);
    await pipe.exec();
    return full;
  }

  async get(sessionId: string): Promise<AuthUser | null> {
    const raw = await this.redis.get(this.sessKey(sessionId));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as AuthUser;
    } catch {
      return null;
    }
  }

  /** Bump TTL on every authenticated request — sliding expiration. */
  async touch(sessionId: string): Promise<void> {
    await this.redis.expire(this.sessKey(sessionId), this.ttlSeconds);
  }

  async destroy(sessionId: string): Promise<void> {
    const raw = await this.redis.get(this.sessKey(sessionId));
    const pipe = this.redis.multi();
    pipe.del(this.sessKey(sessionId));
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as AuthUser;
        pipe.srem(this.userSessionsKey(parsed.userId), sessionId);
      } catch {
        // ignore corrupted payload
      }
    }
    await pipe.exec();
  }

  /** Logout everywhere — used after password change or "log out all devices". */
  async destroyAllForUser(userId: string): Promise<void> {
    const sids = await this.redis.smembers(this.userSessionsKey(userId));
    if (sids.length === 0) return;
    const pipe = this.redis.multi();
    for (const sid of sids) pipe.del(this.sessKey(sid));
    pipe.del(this.userSessionsKey(userId));
    await pipe.exec();
  }
}
