import { Global, Module } from '@nestjs/common';
import { SystemDatabaseModule } from './system/system-database.module';
import { TenantConnectionService } from './tenant/tenant-connection.service';

/**
 * Aggregates the system datasource (master tables) and the tenant
 * connection resolver. Exported globally so any feature module can
 * request a per-tenant DataSource without re-importing.
 */
@Global()
@Module({
  imports: [SystemDatabaseModule],
  providers: [TenantConnectionService],
  exports: [SystemDatabaseModule, TenantConnectionService],
})
export class DatabaseModule {}
