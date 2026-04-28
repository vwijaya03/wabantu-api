import { Injectable, NotFoundException } from '@nestjs/common';
import { ILike } from 'typeorm';
import { TenantConnectionService } from '../database/tenant/tenant-connection.service';
import { KnowledgeBaseEntry } from '../database/tenant/entities/knowledge-base-entry.entity';
import type { AuthUser } from '../common/types/request.types';
import type { CreateKbEntryDto } from './dto/create-kb-entry.dto';
import type { UpdateKbEntryDto } from './dto/update-kb-entry.dto';

interface ListParams {
  search?: string;
  category?: string;
  page?: number;
  pageSize?: number;
}

@Injectable()
export class KnowledgeBaseService {
  constructor(private readonly tenantConn: TenantConnectionService) {}

  private async repo(user: AuthUser) {
    const ds = await this.tenantConn.getDataSourceForTenant(user.tenantId);
    return ds.getRepository(KnowledgeBaseEntry);
  }

  async list(
    user: AuthUser,
    params: ListParams,
  ): Promise<{
    items: KnowledgeBaseEntry[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const repo = await this.repo(user);
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));

    const where: Record<string, unknown> = {};
    if (params.category) where.category = params.category;
    if (params.search) where.question = ILike(`%${params.search}%`);

    const [items, total] = await repo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { items, total, page, pageSize };
  }

  async create(
    user: AuthUser,
    dto: CreateKbEntryDto,
  ): Promise<KnowledgeBaseEntry> {
    const repo = await this.repo(user);
    const entry = repo.create({ ...dto, isActive: dto.isActive ?? true });
    return repo.save(entry);
  }

  async update(
    user: AuthUser,
    id: string,
    dto: UpdateKbEntryDto,
  ): Promise<KnowledgeBaseEntry> {
    const repo = await this.repo(user);
    const entry = await repo.findOne({ where: { id } });
    if (!entry) throw new NotFoundException('FAQ tidak ditemukan');
    Object.assign(entry, dto);
    return repo.save(entry);
  }

  async remove(user: AuthUser, id: string): Promise<void> {
    const repo = await this.repo(user);
    const r = await repo.delete({ id });
    if (!r.affected) throw new NotFoundException('FAQ tidak ditemukan');
  }
}
