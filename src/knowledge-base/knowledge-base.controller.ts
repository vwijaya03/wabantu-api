import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import type { AuthUser } from '../common/types/request.types';
import { CreateKbEntryDto } from './dto/create-kb-entry.dto';
import { UpdateKbEntryDto } from './dto/update-kb-entry.dto';
import { KnowledgeBaseService } from './knowledge-base.service';

@Controller({ path: 'knowledge-base', version: '1' })
@UseGuards(RolesGuard)
export class KnowledgeBaseController {
  constructor(private readonly kb: KnowledgeBaseService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('search') search?: string,
    @Query('category') category?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.kb.list(user, {
      search,
      category,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Roles('owner', 'staff')
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateKbEntryDto) {
    return this.kb.create(user, dto);
  }

  @Roles('owner', 'staff')
  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateKbEntryDto,
  ) {
    return this.kb.update(user, id, dto);
  }

  @Roles('owner')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':id')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.kb.remove(user, id);
  }
}
