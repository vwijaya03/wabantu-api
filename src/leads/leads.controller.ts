import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import type { AuthUser } from '../common/types/request.types';
import { LeadsService } from './leads.service';

class UpdateLeadDto {
  @IsOptional()
  @IsIn(['new', 'contacted', 'qualified', 'won', 'lost'])
  status?: 'new' | 'contacted' | 'qualified' | 'won' | 'lost';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

@Controller({ path: 'leads', version: '1' })
@UseGuards(RolesGuard)
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Get()
  @Roles('owner', 'staff')
  list(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: 'new' | 'contacted' | 'qualified' | 'won' | 'lost',
  ) {
    return this.leads.list(user, status);
  }

  @Patch(':id')
  @Roles('owner', 'staff')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateLeadDto,
  ) {
    return this.leads.update(user, id, body);
  }
}
