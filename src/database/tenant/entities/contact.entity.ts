import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'contact' })
@Index(['phoneNumber'], { unique: true })
export class Contact {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'phone_number', type: 'varchar', length: 32 })
  phoneNumber!: string;

  @Column({
    name: 'display_name',
    type: 'varchar',
    length: 200,
    nullable: true,
  })
  displayName!: string | null;

  /** Free-text notes the owner can add (e.g. "VIP", "selalu COD"). */
  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  /** Soft-tag list, e.g. ["new", "repeat-customer"]. */
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  tags!: string[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
