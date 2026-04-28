import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { encryptedStringTransformer } from '../../../common/utils/data-crypto.util';

/**
 * Single row per tenant — stores everything the AI needs to know about
 * the business so it can answer customer questions on WhatsApp.
 */
@Entity({ name: 'business_profile' })
export class BusinessProfile {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({
    name: 'business_name',
    type: 'text',
    transformer: encryptedStringTransformer,
  })
  businessName!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'text', nullable: true })
  address!: string | null;

  /** Free-text "Senin–Jumat 09:00–17:00, Sabtu 09:00–14:00, Minggu tutup". */
  @Column({ name: 'opening_hours', type: 'text', nullable: true })
  openingHours!: string | null;

  /** Comma- or newline-separated list of products/services. */
  @Column({ name: 'products_services', type: 'text', nullable: true })
  productsServices!: string | null;

  /** Free-text starting price info: "Mulai Rp 50.000". */
  @Column({ name: 'base_pricing', type: 'text', nullable: true })
  basePricing!: string | null;

  /** Free-text shipping coverage: "Jakarta & sekitarnya, COD untuk area Jaksel". */
  @Column({ name: 'delivery_area', type: 'text', nullable: true })
  deliveryArea!: string | null;

  /** Optional WhatsApp greeting/intro the AI should use. */
  @Column({ name: 'greeting_template', type: 'text', nullable: true })
  greetingTemplate!: string | null;

  /** Tone preset the AI should follow. */
  @Column({
    type: 'varchar',
    length: 20,
    default: 'friendly',
  })
  tone!: 'friendly' | 'formal' | 'casual';

  /** Master switch — when false, AI auto-reply is disabled for this tenant. */
  @Column({ name: 'ai_enabled', type: 'boolean', default: true })
  aiEnabled!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
