import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'invoice' })
@Index(['issuedAt'])
export class Invoice {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'invoice_no', type: 'varchar', length: 50, unique: true })
  invoiceNo!: string;

  @Column({ name: 'plan_code', type: 'varchar', length: 32 })
  planCode!: 'starter' | 'basic' | 'pro';

  @Column({ name: 'plan_name', type: 'varchar', length: 80 })
  planName!: string;

  @Column({ name: 'amount_idr', type: 'integer' })
  amountIdr!: number;

  @Column({ type: 'varchar', length: 20, default: 'issued' })
  status!: 'issued' | 'paid' | 'void';

  @Column({ name: 'issued_at', type: 'timestamptz' })
  issuedAt!: Date;

  @Column({ name: 'paid_at', type: 'timestamptz', nullable: true })
  paidAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
