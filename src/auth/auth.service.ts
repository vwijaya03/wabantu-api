import {
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { DataSource, Repository } from 'typeorm';
import type { AuthConfig } from '../config/configuration';
import { slugify } from '../common/utils/slug.util';
import {
  hashForLookup,
  normalizeEmail,
} from '../common/utils/data-crypto.util';
import { TenantAccount } from '../database/system/entities/tenant-account.entity';
import { TenantCompany } from '../database/system/entities/tenant-company.entity';
import { Tenant } from '../database/system/entities/tenant.entity';
import { TenantConnectionService } from '../database/tenant/tenant-connection.service';
import { BusinessProfile } from '../database/tenant/entities/business-profile.entity';
import type { LoginDto } from './dto/login.dto';
import type { RegisterDto } from './dto/register.dto';
import { SessionService } from './session.service';
import type { AuthUser } from '../common/types/request.types';

interface AuthSuccess {
  accessToken: string;
  user: {
    id: string;
    email: string;
    name: string | null;
    role: 'owner' | 'staff';
    tenant: {
      id: string;
      slug: string;
      name: string;
    };
  };
  expiresInSeconds: number;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly hashRounds: number;
  private readonly accessTtl: string;

  constructor(
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(TenantCompany)
    private readonly tenantCompanyRepo: Repository<TenantCompany>,
    @InjectRepository(TenantAccount)
    private readonly accountRepo: Repository<TenantAccount>,
    @InjectDataSource()
    private readonly systemDs: DataSource,
    private readonly tenantConn: TenantConnectionService,
    private readonly jwt: JwtService,
    private readonly sessions: SessionService,
    config: ConfigService,
  ) {
    const auth = config.getOrThrow<AuthConfig>('auth');
    this.hashRounds = auth.passwordHashRounds;
    this.accessTtl = auth.jwtAccessTtl;
  }

  /**
   * Atomic onboarding: create system records first inside a transaction
   * (so we can roll back), then bootstrap the tenant schema. If schema
   * bootstrap fails, the system tx is rolled back and no orphan rows remain.
   */
  async register(
    dto: RegisterDto,
    meta: { ip?: string; ua?: string },
  ): Promise<AuthSuccess> {
    const emailLower = normalizeEmail(dto.email);
    const emailHash = hashForLookup(emailLower);

    const existing = await this.accountRepo.findOne({
      where: { emailHash },
    });
    if (existing) {
      throw new ConflictException('Email sudah terdaftar');
    }

    const baseSlug = slugify(dto.slug || dto.businessName) || 'biz';
    const uniqueSlug = await this.findUniqueTenantSlug(baseSlug);
    const schemaPrefix = 't_';
    const schemaName = `${schemaPrefix}${uniqueSlug}`.slice(0, 63);

    const passwordHash = await bcrypt.hash(dto.password, this.hashRounds);

    const queryRunner = this.systemDs.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    let tenantCompany: TenantCompany;
    let tenant: Tenant;
    let account: TenantAccount;
    try {
      tenant = queryRunner.manager.create(Tenant, {
        slug: uniqueSlug,
        name: dto.businessName.trim(),
        status: 'active',
      });
      await queryRunner.manager.save(tenant);

      tenantCompany = queryRunner.manager.create(TenantCompany, {
        tenantId: tenant.id,
        host: null,
        port: null,
        database: null,
        schemaName,
      });
      await queryRunner.manager.save(tenantCompany);

      account = queryRunner.manager.create(TenantAccount, {
        email: emailLower,
        emailHash,
        passwordHash,
        name: dto.name.trim(),
        tenantId: tenant.id,
        role: 'owner',
      });
      await queryRunner.manager.save(account);

      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction();
      this.logger.error(
        `register() failed in system tx: ${(err as Error).message}`,
      );
      throw err;
    } finally {
      await queryRunner.release();
    }

    try {
      const tenantDs =
        await this.tenantConn.bootstrapTenantSchema(tenantCompany);
      // Seed an empty business profile so the dashboard can render right away.
      const repo = tenantDs.getRepository(BusinessProfile);
      const exists = await repo.count();
      if (exists === 0) {
        await repo.save(
          repo.create({
            businessName: tenant.name,
            tone: 'friendly',
            aiEnabled: true,
          }),
        );
      }
    } catch (err) {
      // Schema bootstrap failed — clean up the system rows so the user
      // can retry without "email already taken".
      this.logger.error(
        `Tenant schema bootstrap failed for ${schemaName}: ${(err as Error).message}`,
      );
      await this.accountRepo.delete({ id: account.id }).catch(() => undefined);
      await this.tenantCompanyRepo
        .delete({ id: tenantCompany.id })
        .catch(() => undefined);
      await this.tenantRepo.delete({ id: tenant.id }).catch(() => undefined);
      throw err;
    }

    return this.completeLogin(account, tenant, tenantCompany, meta);
  }

  async login(
    dto: LoginDto,
    meta: { ip?: string; ua?: string },
  ): Promise<AuthSuccess> {
    const email = normalizeEmail(dto.email);
    const emailHash = hashForLookup(email);
    const account = await this.accountRepo.findOne({ where: { emailHash } });
    if (!account) {
      // Constant-time compare against a dummy hash to avoid timing leaks.
      await bcrypt.compare(dto.password, '$2b$12$invalidsaltinvalidsaltinval');
      throw new UnauthorizedException('Email atau password salah');
    }
    const valid = await bcrypt.compare(dto.password, account.passwordHash);
    if (!valid) throw new UnauthorizedException('Email atau password salah');

    const tenant = await this.tenantRepo.findOne({
      where: { id: account.tenantId },
    });
    const company = await this.tenantCompanyRepo.findOne({
      where: { tenantId: account.tenantId },
    });
    if (!tenant || !company) {
      throw new UnauthorizedException('Tenant tidak ditemukan');
    }
    if (tenant.status !== 'active') {
      throw new UnauthorizedException('Akun bisnis tidak aktif');
    }

    account.lastLoginAt = new Date();
    await this.accountRepo.save(account);

    return this.completeLogin(account, tenant, company, meta);
  }

  async logout(sessionId: string): Promise<void> {
    await this.sessions.destroy(sessionId);
  }

  async getMe(user: AuthUser): Promise<AuthSuccess['user']> {
    const tenant = await this.tenantRepo.findOne({
      where: { id: user.tenantId },
    });
    if (!tenant) throw new UnauthorizedException('Tenant tidak ditemukan');
    const account = await this.accountRepo.findOne({
      where: { id: user.userId },
    });
    if (!account) throw new UnauthorizedException('Akun tidak ditemukan');
    return {
      id: account.id,
      email: account.email,
      name: account.name,
      role: account.role,
      tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name },
    };
  }

  // ---------- helpers ----------

  private async completeLogin(
    account: TenantAccount,
    tenant: Tenant,
    company: TenantCompany,
    meta: { ip?: string; ua?: string },
  ): Promise<AuthSuccess> {
    const session = await this.sessions.create(
      {
        userId: account.id,
        email: account.email,
        tenantId: tenant.id,
        tenantSchema: company.schemaName,
        role: account.role,
      },
      meta,
    );

    const accessToken = await this.jwt.signAsync(
      { sub: account.id, sid: session.sessionId },
      // expiresIn from env arrives as an ms-style string ("15m"); the
      // jsonwebtoken types expect either StringValue or number — cast.
      { expiresIn: this.accessTtl as unknown as number },
    );

    return {
      accessToken,
      user: {
        id: account.id,
        email: account.email,
        name: account.name,
        role: account.role,
        tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name },
      },
      // Caller serializes this into the cookie max-age too.
      expiresInSeconds: this.parseAccessTtlSeconds(),
    };
  }

  private parseAccessTtlSeconds(): number {
    const m = this.accessTtl.match(/^(\d+)\s*(s|m|h|d)$/);
    if (!m) return 900;
    const n = Number(m[1]);
    const u = m[2];
    return n * { s: 1, m: 60, h: 3600, d: 86400 }[u]!;
  }

  private async findUniqueTenantSlug(base: string): Promise<string> {
    let candidate = base;
    let counter = 0;
    while (await this.tenantRepo.exist({ where: { slug: candidate } })) {
      counter += 1;
      candidate = `${base}_${counter}`;
      if (counter > 50) {
        candidate = `${base}_${Date.now()}`;
        break;
      }
    }
    return candidate;
  }
}
