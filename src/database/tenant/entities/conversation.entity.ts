import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'conversation' })
@Index(['channelId', 'contactId'], { unique: true })
export class Conversation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'channel_id', type: 'uuid' })
  channelId!: string;

  @Column({ name: 'contact_id', type: 'uuid' })
  contactId!: string;

  @Column({
    type: 'varchar',
    length: 20,
    default: 'open',
  })
  status!: 'open' | 'pending' | 'closed' | 'snoozed';

  /**
   * Whether the AI auto-reply is currently handling this conversation.
   * The owner can take over manually any time — flips to false then.
   */
  @Column({ name: 'ai_handled', type: 'boolean', default: true })
  aiHandled!: boolean;

  @Column({ name: 'last_message_at', type: 'timestamptz', nullable: true })
  lastMessageAt!: Date | null;

  @Column({
    name: 'last_message_preview',
    type: 'varchar',
    length: 280,
    nullable: true,
  })
  lastMessagePreview!: string | null;

  @Column({ name: 'unread_count', type: 'integer', default: 0 })
  unreadCount!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
