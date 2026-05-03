import {
  Body,
  Controller,
  Get,
  Param,
  ParseBoolPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthUser } from '../common/types/request.types';
import { RolesGuard } from '../common/guards/roles.guard';
import { UseGuards } from '@nestjs/common';
import { InboxService } from './inbox.service';

class SendMessageDto {
  @IsString()
  @MaxLength(4000)
  body!: string;
}

class HandoffDto {
  @IsOptional()
  @IsString()
  @MaxLength(280)
  reason?: string;
}

@Controller({ path: 'inbox', version: '1' })
@UseGuards(RolesGuard)
export class InboxController {
  constructor(private readonly inbox: InboxService) {}

  @Get('conversations')
  @Roles('owner', 'staff')
  list(
    @CurrentUser() user: AuthUser,
    @Query('search') search?: string,
    @Query('unreadOnly', new ParseBoolPipe({ optional: true }))
    unreadOnly?: boolean,
    @Query('aiHandled', new ParseBoolPipe({ optional: true }))
    aiHandled?: boolean,
  ) {
    return this.inbox.listConversations(user, { search, unreadOnly, aiHandled });
  }

  @Get('conversations/:id/messages')
  @Roles('owner', 'staff')
  messages(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) conversationId: string,
  ) {
    return this.inbox.getMessages(user, conversationId);
  }

  @Patch('conversations/:id/read')
  @Roles('owner', 'staff')
  markAsRead(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) conversationId: string,
  ) {
    return this.inbox.markAsRead(user, conversationId);
  }

  @Post('conversations/:id/handoff')
  @Roles('owner', 'staff')
  handoff(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) conversationId: string,
    @Body() body: HandoffDto,
  ) {
    return this.inbox.handoffToHuman(user, conversationId, body.reason);
  }

  @Post('conversations/:id/ai-resume')
  @Roles('owner', 'staff')
  resumeAi(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) conversationId: string,
  ) {
    return this.inbox.resumeAi(user, conversationId);
  }

  @Post('conversations/:id/messages')
  @Roles('owner', 'staff')
  sendMessage(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) conversationId: string,
    @Body() body: SendMessageDto,
  ) {
    return this.inbox.sendHumanMessage(user, conversationId, body.body);
  }
}
