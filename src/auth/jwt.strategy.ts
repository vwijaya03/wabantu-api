import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Request } from 'express';
import type { AuthConfig } from '../config/configuration';
import type { AuthUser } from '../common/types/request.types';
import { SessionService } from './session.service';

export interface JwtPayload {
  sub: string;
  sid: string;
}

const COOKIE_NAME = 'wabantu_at';

const cookieExtractor = (req: Request): string | null => {
  const c = req?.cookies as Record<string, string> | undefined;
  return c?.[COOKIE_NAME] ?? null;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly sessions: SessionService,
  ) {
    const auth = config.getOrThrow<AuthConfig>('auth');
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        cookieExtractor,
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey: auth.jwtAccessSecret,
    });
  }

  /**
   * Cross-check the JWT against the Redis session — this is what makes
   * "log out everywhere" / "force re-login" work even when the JWT
   * itself is still cryptographically valid.
   */
  async validate(payload: JwtPayload): Promise<AuthUser> {
    const session = await this.sessions.get(payload.sid);
    if (!session) {
      throw new UnauthorizedException('Session expired or revoked');
    }
    if (session.userId !== payload.sub) {
      throw new UnauthorizedException('Session/identity mismatch');
    }
    await this.sessions.touch(session.sessionId);
    return session;
  }
}

export const ACCESS_TOKEN_COOKIE = COOKIE_NAME;
