import {
  Body,
  Controller,
  Get,
  MessageEvent,
  Param,
  ParseBoolPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Sse,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthUser } from '../common/types/request.types';
import { RolesGuard } from '../common/guards/roles.guard';
import { UseGuards } from '@nestjs/common';
import { SkipResponseTransform } from '../common/decorators/skip-response-transform.decorator';
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

  @Get('unread-summary')
  @Roles('owner', 'staff')
  unreadSummary(@CurrentUser() user: AuthUser) {
    return this.inbox.getUnreadSummary(user);
  }

  /**
   * Server-Sent Events: push when an inbound WhatsApp message is stored (Redis pub/sub).
   * Browser: `new EventSource('/api/v1/inbox/stream')` (same-origin cookies).
   */
  @Sse('stream')
  @SkipResponseTransform()
  @Roles('owner', 'staff')
  inboxStream(@CurrentUser() user: AuthUser): Observable<MessageEvent> {
    return this.inbox.subscribeInboxStream(user.tenantId);
  }

  @Get('conversations')
  @Roles('owner', 'staff')
  list(
    @CurrentUser() user: AuthUser,
    @Query('search') search?: string,
    @Query('unreadOnly', new ParseBoolPipe({ optional: true }))
    unreadOnly?: boolean,
    @Query('aiHandled', new ParseBoolPipe({ optional: true }))
    aiHandled?: boolean,
    @Query('limit') limitStr?: string,
    @Query('cursor') cursor?: string,
  ) {
    const limit =
      limitStr !== undefined && limitStr !== ''
        ? Number(limitStr)
        : undefined;
    return this.inbox.listConversations(user, {
      search,
      unreadOnly,
      aiHandled,
      limit: Number.isFinite(limit) ? limit : undefined,
      cursor,
    });
  }

  @Get('conversations/:id/messages')
  @Roles('owner', 'staff')
  messages(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) conversationId: string,
    @Query('limit') limitStr?: string,
    @Query('offset') offsetStr?: string,
    @Query('cursor') cursor?: string,
  ) {
    const limit =
      limitStr !== undefined && limitStr !== ''
        ? Number(limitStr)
        : undefined;
    const offset =
      offsetStr !== undefined && offsetStr !== ''
        ? Number(offsetStr)
        : undefined;
    return this.inbox.getMessages(user, conversationId, {
      limit: Number.isFinite(limit) ? limit : undefined,
      offset: Number.isFinite(offset ?? NaN) ? offset : undefined,
      cursor: cursor?.trim() || undefined,
    });
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
