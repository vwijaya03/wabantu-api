import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * One row = one Q/A pair the AI can use as ground truth.
 * MVP keeps it as plain text; later we can add embeddings + vector search
 * by adding a separate column or sibling `kb_chunk` table.
 */
@Entity({ name: 'knowledge_base_entry' })
export class KnowledgeBaseEntry {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 500 })
  question!: string;

  @Column({ type: 'text' })
  answer!: string;

  /** Optional grouping tag for filters, e.g. "shipping", "pricing", "general". */
  @Index()
  @Column({ type: 'varchar', length: 60, nullable: true })
  category!: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  /** Source: manual entry, pdf import, excel import, etc. */
  @Column({
    type: 'varchar',
    length: 20,
    default: 'manual',
  })
  source!: 'manual' | 'pdf' | 'excel' | 'csv';

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
