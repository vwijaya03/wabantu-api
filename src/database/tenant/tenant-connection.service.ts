import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Repository } from 'typeorm';
import type { DatabaseConfig } from '../../config/configuration';
import { TenantCompany } from '../system/entities/tenant-company.entity';
import { TENANT_ENTITIES } from './tenant-entities';

/** Postgres reserved word check + sanity validation for schema_name. */
const SCHEMA_NAME_RE = /^[a-z_][a-z0-9_]{0,62}$/;

/**
 * Manages per-tenant DataSource instances against the jb_tenant DB.
 *
 * Strategy:
 *  - One physical Postgres pool per (host, port, database, schema_name) combo.
 *  - Schema-per-tenant via TypeORM's `schema` option, which makes every
 *    query implicitly use `SET search_path TO <schema>`.
 *  - Connections are cached for the process lifetime; we close them all
 *    on application shutdown.
 *
 * Why not "one global pool + manual SET search_path per query"?
 *  Because TypeORM repositories cache parsed schemas at boot. Using one
 *  DataSource per tenant gives clean repository isolation and lets us
 *  scale read replicas / sharding per tenant in the future.
 */
@Injectable()
export class TenantConnectionService implements OnModuleDestroy {
  private readonly logger = new Logger(TenantConnectionService.name);
  private readonly pool = new Map<string, DataSource>();

  constructor(
    @InjectRepository(TenantCompany)
    private readonly tenantCompanyRepo: Repository<TenantCompany>,
    private readonly config: ConfigService,
  ) {}

  /**
   * Resolve a tenant's DataSource by tenantId. Uses the metadata stored
   * in `tenant_company` to know which host/db/schema to connect to.
   */
  async getDataSourceForTenant(tenantId: string): Promise<DataSource> {
    const company = await this.tenantCompanyRepo.findOne({
      where: { tenantId },
    });
    if (!company) {
      throw new NotFoundException(`Tenant company not found: ${tenantId}`);
    }
    return this.getDataSourceForCompany(company);
  }

  /**
   * Resolve directly when you already loaded the tenant_company row.
   * Used during register() right after creating the row.
   */
  async getDataSourceForCompany(company: TenantCompany): Promise<DataSource> {
    if (!SCHEMA_NAME_RE.test(company.schemaName)) {
      throw new Error(`Invalid schema_name: ${company.schemaName}`);
    }

    const dbCfg = this.config.getOrThrow<DatabaseConfig>('database').tenant;
    const host = company.host ?? dbCfg.host;
    const port = company.port ?? dbCfg.port;
    const database = company.database ?? dbCfg.database;
    const cacheKey = `${host}:${port}/${database}/${company.schemaName}`;

    const cached = this.pool.get(cacheKey);
    if (cached?.isInitialized) return cached;

    const ds = new DataSource({
      type: 'postgres',
      host,
      port,
      username: dbCfg.username,
      password: dbCfg.password,
      database,
      schema: company.schemaName,
      ssl: dbCfg.ssl ? { rejectUnauthorized: false } : false,
      synchronize: dbCfg.synchronize,
      logging: dbCfg.logging,
      entities: TENANT_ENTITIES,
      poolSize: dbCfg.poolMax,
      extra: { min: dbCfg.poolMin, max: dbCfg.poolMax },
      name: `tenant_${cacheKey}`,
    });

    await ds.initialize();
    this.pool.set(cacheKey, ds);
    this.logger.log(`Initialized tenant DataSource for ${cacheKey}`);
    return ds;
  }

  /**
   * Bootstrap a new tenant schema on the jb_tenant DB:
   *   1. CREATE SCHEMA IF NOT EXISTS <schema>
   *   2. Connect a DataSource scoped to that schema
   *   3. synchronize() to materialize all tenant tables
   *
   * Called from AuthService.register() within a system-DB transaction so
   * a half-created tenant never leaks to the master tables.
   */
  async bootstrapTenantSchema(company: TenantCompany): Promise<DataSource> {
    if (!SCHEMA_NAME_RE.test(company.schemaName)) {
      throw new Error(`Invalid schema_name: ${company.schemaName}`);
    }
    const dbCfg = this.config.getOrThrow<DatabaseConfig>('database').tenant;
    const host = company.host ?? dbCfg.host;
    const port = company.port ?? dbCfg.port;
    const database = company.database ?? dbCfg.database;

    const adminDs = new DataSource({
      type: 'postgres',
      host,
      port,
      username: dbCfg.username,
      password: dbCfg.password,
      database,
      ssl: dbCfg.ssl ? { rejectUnauthorized: false } : false,
      name: `tenant_admin_${company.schemaName}`,
    });
    await adminDs.initialize();
    try {
      await adminDs.query(
        `CREATE SCHEMA IF NOT EXISTS "${company.schemaName}"`,
      );
    } finally {
      await adminDs.destroy();
    }

    const ds = new DataSource({
      type: 'postgres',
      host,
      port,
      username: dbCfg.username,
      password: dbCfg.password,
      database,
      schema: company.schemaName,
      ssl: dbCfg.ssl ? { rejectUnauthorized: false } : false,
      // Synchronize is ONLY used for the first-time bootstrap of a tenant
      // schema. Subsequent changes flow through proper migrations.
      synchronize: true,
      logging: dbCfg.logging,
      entities: TENANT_ENTITIES,
      name: `tenant_bootstrap_${company.schemaName}`,
    });
    await ds.initialize();
    this.logger.log(
      `Bootstrapped tenant schema ${company.schemaName} on ${host}:${port}/${database}`,
    );

    const cacheKey = `${host}:${port}/${database}/${company.schemaName}`;
    this.pool.set(cacheKey, ds);
    return ds;
  }

  async onModuleDestroy(): Promise<void> {
    for (const [key, ds] of this.pool.entries()) {
      try {
        await ds.destroy();
        this.logger.log(`Closed tenant DataSource ${key}`);
      } catch (err) {
        this.logger.warn(
          `Failed closing tenant DataSource ${key}: ${(err as Error).message}`,
        );
      }
    }
    this.pool.clear();
  }
}
