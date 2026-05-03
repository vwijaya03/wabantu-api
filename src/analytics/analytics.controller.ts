import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import type { AuthUser } from '../common/types/request.types';
import { AnalyticsService } from './analytics.service';

@Controller({ path: 'analytics', version: '1' })
@UseGuards(RolesGuard)
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('overview')
  @Roles('owner', 'staff')
  overview(@CurrentUser() user: AuthUser, @Query('days') days?: string) {
    return this.analytics.overview(user, Number(days ?? 30));
  }
}
