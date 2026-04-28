import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import type { AuthUser } from '../common/types/request.types';
import { BusinessService } from './business.service';
import { UpdateBusinessProfileDto } from './dto/update-business-profile.dto';

@Controller({ path: 'business/profile', version: '1' })
@UseGuards(RolesGuard)
export class BusinessController {
  constructor(private readonly business: BusinessService) {}

  @Get()
  get(@CurrentUser() user: AuthUser) {
    return this.business.getProfile(user);
  }

  @Roles('owner')
  @Patch()
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateBusinessProfileDto) {
    return this.business.updateProfile(user, dto);
  }
}
