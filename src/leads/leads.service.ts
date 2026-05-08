import { Injectable, NotFoundException } from '@nestjs/common';
import { In } from 'typeorm';
import { TenantConnectionService } from '../database/tenant/tenant-connection.service';
import { Contact } from '../database/tenant/entities/contact.entity';
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
    const ds = await this.tenantConn.getDataSourceForTenant(user.tenantId);
    const repo = ds.getRepository(Lead);
    const contactRepo = ds.getRepository(Contact);
    const leads = status
      ? await repo.find({ where: { status }, order: { createdAt: 'DESC' } })
      : await repo.find({ order: { createdAt: 'DESC' } });
    const contactIds = [...new Set(leads.map((l) => l.contactId).filter(Boolean))] as string[];
    if (contactIds.length === 0) return leads;
    const contacts = await contactRepo.find({ where: { id: In(contactIds) } });
    const contactMap = new Map(contacts.map((c) => [c.id, c]));
    return leads.map((lead) => {
      if (lead.name && lead.name.trim().length > 0) return lead;
      const fallback = lead.contactId ? contactMap.get(lead.contactId)?.displayName : null;
      if (!fallback || fallback.trim().length === 0) return lead;
      return { ...lead, name: fallback };
    });
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
