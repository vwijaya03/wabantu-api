import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'lead' })
@Index(['phoneNumber'])
@Index(['status', 'createdAt'])
export class Lead {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'contact_id', type: 'uuid', nullable: true })
  contactId!: string | null;

  @Column({ name: 'conversation_id', type: 'uuid', nullable: true })
  conversationId!: string | null;

  @Column({ name: 'phone_number', type: 'varchar', length: 32 })
  phoneNumber!: string;

  @Column({ name: 'name', type: 'varchar', length: 120, nullable: true })
  name!: string | null;

  @Column({ name: 'product_interest', type: 'varchar', length: 200, nullable: true })
  productInterest!: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  budget!: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  location!: string | null;

  @Column({
    type: 'varchar',
    length: 20,
    default: 'new',
  })
  status!: 'new' | 'contacted' | 'qualified' | 'won' | 'lost';

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
