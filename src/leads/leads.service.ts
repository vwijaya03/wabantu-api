import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantConnectionService } from '../database/tenant/tenant-connection.service';
import { Lead } from '../database/tenant/entities/lead.entity';
import type { AuthUser } from '../common/types/request.types';

@Injectable()
export class LeadsService {
  constructor(private readonly tenantConn: TenantConnectionService) {}

  private async repo(tenantId: string) {
    const ds = await this.tenantConn.getDataSourceForTenant(tenantId);
    return ds.getRepository(Lead);
  }

  async list(user: AuthUser, status?: Lead['status']) {
    const repo = await this.repo(user.tenantId);
    if (status) {
      return repo.find({ where: { status }, order: { createdAt: 'DESC' } });
    }
    return repo.find({ order: { createdAt: 'DESC' } });
  }

  async update(
    user: AuthUser,
    id: string,
    patch: Partial<Pick<Lead, 'status' | 'notes'>>,
  ) {
    const repo = await this.repo(user.tenantId);
    const lead = await repo.findOne({ where: { id } });
    if (!lead) throw new NotFoundException('Lead tidak ditemukan');
    if (patch.status) lead.status = patch.status;
    if (patch.notes !== undefined) lead.notes = patch.notes;
    return repo.save(lead);
  }
}
