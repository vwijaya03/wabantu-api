import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * One WhatsApp number connected to this tenant.
 * Most tenants will have exactly one row; we still model it as a table
 * so multi-number setups (different cities, different products) work later.
 */
@Entity({ name: 'whatsapp_channel' })
export class WhatsappChannel {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({
    type: 'varchar',
    length: 20,
    default: 'meta_cloud',
  })
  provider!: 'meta_cloud' | 'baileys';

  /** Display label for the user, e.g. "Toko Cabang Jaksel". */
  @Column({ name: 'display_name', type: 'varchar', length: 120 })
  displayName!: string;

  @Index()
  @Column({ name: 'phone_number', type: 'varchar', length: 32 })
  phoneNumber!: string;

  /** Meta Cloud API: phone_number_id (Graph). */
  @Column({
    name: 'meta_phone_number_id',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  metaPhoneNumberId!: string | null;

  /** Meta Cloud API: WABA ID. */
  @Column({ name: 'meta_waba_id', type: 'varchar', length: 64, nullable: true })
  metaWabaId!: string | null;

  /**
   * Encrypted access token. The MVP stores it as-is for simplicity;
   * for production wrap with envelope encryption (KMS) before persisting.
   */
  @Column({ name: 'access_token', type: 'text', nullable: true })
  accessToken!: string | null;

  @Column({
    type: 'varchar',
    length: 20,
    default: 'disconnected',
  })
  status!: 'connected' | 'disconnected' | 'error' | 'pending';

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError!: string | null;

  @Column({ name: 'connected_at', type: 'timestamptz', nullable: true })
  connectedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
