import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { encryptedStringTransformer } from '../../../common/utils/data-crypto.util';

/**
 * Login credentials live in jb_system, NOT in tenant schemas.
 * Reasons:
 *   1) The login form has only an email — we don't know the tenant yet.
 *   2) A future "user belongs to multiple tenants" feature only needs a
 *      mapping table (tenant_account <-> tenant) without changing the
 *      login flow.
 *
 * Per-tenant profile data (name, role, etc.) still lives inside the
 * tenant schema so it can be queried alongside conversations/contacts.
 */
@Entity({ name: 'tenant_account' })
export class TenantAccount {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'text', transformer: encryptedStringTransformer })
  email!: string;

  /** Deterministic hash used for email lookup + uniqueness checks. */
  @Index({ unique: true })
  @Column({ name: 'email_hash', type: 'varchar', length: 64 })
  emailHash!: string;

  /** bcrypt hash. Never store plaintext. */
  @Column({ name: 'password_hash', type: 'varchar', length: 255 })
  passwordHash!: string;

  @Column({
    type: 'text',
    nullable: true,
    transformer: encryptedStringTransformer,
  })
  name!: string | null;

  /** Owning tenant for this account in the MVP single-tenant-per-account model. */
  @Index()
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({
    type: 'varchar',
    length: 20,
    default: 'owner',
  })
  role!: 'owner' | 'staff';

  @Column({ name: 'last_login_at', type: 'timestamptz', nullable: true })
  lastLoginAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
