import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'subscription' })
export class Subscription {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'plan_code', type: 'varchar', length: 32, default: 'starter' })
  planCode!: 'starter' | 'basic' | 'pro';

  @Column({ name: 'plan_name', type: 'varchar', length: 80, default: 'Starter' })
  planName!: string;

  @Column({ name: 'is_trial', type: 'boolean', default: true })
  isTrial!: boolean;

  @Column({ name: 'trial_ends_at', type: 'timestamptz', nullable: true })
  trialEndsAt!: Date | null;

  @Column({
    name: 'status',
    type: 'varchar',
    length: 20,
    default: 'active',
  })
  status!: 'active' | 'past_due' | 'canceled';

  @Column({ name: 'provider', type: 'varchar', length: 20, nullable: true })
  provider!: 'midtrans' | 'xendit' | null;

  @Column({ name: 'provider_ref', type: 'varchar', length: 120, nullable: true })
  providerRef!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
