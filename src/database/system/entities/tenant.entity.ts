import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { encryptedStringTransformer } from '../../../common/utils/data-crypto.util';
import { TenantCompany } from './tenant-company.entity';

/**
 * Master record per tenant (one row = one signed-up business account).
 * Lives in `jb_system.public.tenant`.
 */
@Entity({ name: 'tenant' })
export class Tenant {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Human-friendly slug, used in URLs and tenant_company.schema_name lookup. */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  slug!: string;

  /** Display name for the business / workspace. */
  @Column({ type: 'text', transformer: encryptedStringTransformer })
  name!: string;

  /** Lifecycle status — useful for soft-suspending a tenant without deleting data. */
  @Column({
    type: 'varchar',
    length: 20,
    default: 'active',
  })
  status!: 'active' | 'suspended' | 'deleted';

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @OneToOne(() => TenantCompany, (tc) => tc.tenant, { cascade: true })
  company!: TenantCompany;
}
