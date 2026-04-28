import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { DatabaseConfig } from '../../config/configuration';
import { TenantAccount } from './entities/tenant-account.entity';
import { TenantCompany } from './entities/tenant-company.entity';
import { Tenant } from './entities/tenant.entity';

export const SYSTEM_DATA_SOURCE = 'SYSTEM_DATA_SOURCE';

/**
 * The "control plane" datasource. Holds the master tables: tenants,
 * tenant_company (connection info), tenant_account (login credentials).
 *
 * The default datasource of the app is this one — every TypeORM
 * decorator without an explicit datasource will resolve to it.
 */
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const db = config.getOrThrow<DatabaseConfig>('database');
        return {
          type: 'postgres',
          host: db.system.host,
          port: db.system.port,
          username: db.system.username,
          password: db.system.password,
          database: db.system.database,
          ssl: db.system.ssl ? { rejectUnauthorized: false } : false,
          synchronize: db.system.synchronize,
          logging: db.system.logging,
          autoLoadEntities: false,
          entities: [Tenant, TenantCompany, TenantAccount],
          poolSize: db.system.poolMax,
          extra: {
            min: db.system.poolMin,
            max: db.system.poolMax,
          },
        };
      },
    }),
    TypeOrmModule.forFeature([Tenant, TenantCompany, TenantAccount]),
  ],
  exports: [TypeOrmModule],
})
export class SystemDatabaseModule {}
