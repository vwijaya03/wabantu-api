import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Tenant } from './tenant.entity';

/**
 * Connection metadata for a tenant. The actual data lives in:
 *   `<host>:<port>/<database>` schema=`schema_name`
 *
 * For 99% of tenants this points at the shared jb_tenant DB cluster, with
 * a unique per-tenant schema. For VIP/enterprise tenants you can override
 * `host`/`database` to physically isolate them on their own cluster.
 */
@Entity({ name: 'tenant_company' })
export class TenantCompany {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @OneToOne(() => Tenant, (t) => t.company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;

  /** Override host (null = use TENANT_DB_HOST default). */
  @Column({ type: 'varchar', length: 200, nullable: true })
  host!: string | null;

  /** Override port (null = use TENANT_DB_PORT default). */
  @Column({ type: 'integer', nullable: true })
  port!: number | null;

  /** Override database name (null = use TENANT_DB_NAME default). */
  @Column({ type: 'varchar', length: 100, nullable: true })
  database!: string | null;

  /** Postgres schema where this tenant's tables live. Required. */
  @Index({ unique: true })
  @Column({ name: 'schema_name', type: 'varchar', length: 100 })
  schemaName!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
