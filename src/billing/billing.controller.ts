import {
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { IsIn, IsOptional } from 'class-validator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import type { AuthUser } from '../common/types/request.types';
import { BillingService } from './billing.service';

class SelectPlanDto {
  @IsIn(['starter', 'basic', 'pro'])
  planCode!: 'starter' | 'basic' | 'pro';

  @IsOptional()
  @IsIn(['midtrans', 'xendit'])
  provider?: 'midtrans' | 'xendit';
}

@Controller({ path: 'billing', version: '1' })
@UseGuards(RolesGuard)
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('overview')
  @Roles('owner')
  overview(@CurrentUser() user: AuthUser) {
    return this.billing.overview(user);
  }

  @Get('invoices')
  @Roles('owner')
  invoices(@CurrentUser() user: AuthUser) {
    return this.billing.listInvoices(user);
  }

  @Post('select-plan')
  @Roles('owner')
  selectPlan(@CurrentUser() user: AuthUser, @Body() body: SelectPlanDto) {
    if (!body?.planCode) {
      throw new BadRequestException('planCode wajib diisi');
    }
    return this.billing.selectPlan(user, body.planCode, body.provider);
  }
}
