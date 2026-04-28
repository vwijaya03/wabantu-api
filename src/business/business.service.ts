import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantConnectionService } from '../database/tenant/tenant-connection.service';
import { BusinessProfile } from '../database/tenant/entities/business-profile.entity';
import type { AuthUser } from '../common/types/request.types';
import type { UpdateBusinessProfileDto } from './dto/update-business-profile.dto';

@Injectable()
export class BusinessService {
  constructor(private readonly tenantConn: TenantConnectionService) {}

  private async repo(user: AuthUser) {
    const ds = await this.tenantConn.getDataSourceForTenant(user.tenantId);
    return ds.getRepository(BusinessProfile);
  }

  async getProfile(user: AuthUser): Promise<BusinessProfile> {
    const repo = await this.repo(user);
    const profile = await repo.findOne({
      where: {},
      order: { createdAt: 'ASC' },
    });
    if (!profile) {
      // First-time access — create an empty placeholder so the dashboard
      // never has to deal with "what if profile is null".
      return repo.save(repo.create({ businessName: 'Bisnis Baru' }));
    }
    return profile;
  }

  async updateProfile(
    user: AuthUser,
    dto: UpdateBusinessProfileDto,
  ): Promise<BusinessProfile> {
    const repo = await this.repo(user);
    const profile = await repo.findOne({
      where: {},
      order: { createdAt: 'ASC' },
    });
    if (!profile) throw new NotFoundException('Profile tidak ditemukan');
    Object.assign(profile, dto);
    return repo.save(profile);
  }
}
