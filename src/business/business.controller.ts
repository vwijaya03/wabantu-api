import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import type { AuthUser } from '../common/types/request.types';
import { BusinessService } from './business.service';
import { UpdateBusinessProfileDto } from './dto/update-business-profile.dto';
import { toBusinessProfileResponse } from './mappers/business-profile-response.mapper';

@Controller({ path: 'business/profile', version: '1' })
@UseGuards(RolesGuard)
export class BusinessController {
  constructor(private readonly business: BusinessService) {}

  @Get()
  async get(@CurrentUser() user: AuthUser) {
    const profile = await this.business.getProfile(user);
    return toBusinessProfileResponse(profile);
  }

  @Roles('owner')
  @Patch()
  async update(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateBusinessProfileDto,
  ) {
    const profile = await this.business.updateProfile(user, dto);
    return toBusinessProfileResponse(profile);
  }
}
