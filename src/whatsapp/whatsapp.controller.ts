import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import type { Request } from 'express';
import { ConfigService } from '@nestjs/config';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import type { AuthUser } from '../common/types/request.types';
import type { WhatsAppConfig } from '../config/configuration';
import { ConnectChannelDto } from './dto/connect-channel.dto';
import { WhatsappService } from './whatsapp.service';

interface SendTestBody {
  to: string;
  body: string;
}

@Controller({ path: 'whatsapp', version: '1' })
export class WhatsappController {
  constructor(
    private readonly whatsapp: WhatsappService,
    private readonly config: ConfigService,
  ) {}

  // -------- Authenticated endpoints --------

  @UseGuards(RolesGuard)
  @Get('channels')
  list(@CurrentUser() user: AuthUser) {
    return this.whatsapp.listChannels(user);
  }

  @UseGuards(RolesGuard)
  @Roles('owner')
  @Post('channels')
  connect(@CurrentUser() user: AuthUser, @Body() dto: ConnectChannelDto) {
    return this.whatsapp.connectChannel(user, dto);
  }

  @UseGuards(RolesGuard)
  @Roles('owner')
  @Delete('channels/:id')
  disconnect(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.whatsapp.disconnect(user, id);
  }

  @UseGuards(RolesGuard)
  @Post('channels/:id/test-message')
  testMessage(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SendTestBody,
  ) {
    return this.whatsapp.sendTestMessage(user, id, body.to, body.body);
  }

  // -------- Public webhook (Meta Cloud) --------

  /**
   * Meta verifies a webhook by GETting it with hub.verify_token. We
   * compare against META_WEBHOOK_VERIFY_TOKEN from env and echo the
   * challenge back as plain text per Meta's spec.
   */
  @Public()
  @Get('webhook/meta')
  verifyMeta(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ) {
    const expected =
      this.config.getOrThrow<WhatsAppConfig>('whatsapp').metaWebhookVerifyToken;
    if (mode === 'subscribe' && token && expected && token === expected) {
      return { raw: true, data: challenge };
    }
    return { raw: true, data: 'invalid' };
  }

  /**
   * Webhook receiver. The actual ingestion / AI auto-reply pipeline is
   * implemented incrementally — this endpoint just acknowledges to keep
   * Meta from retrying while the rest of the pipeline is built out.
   */
  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('webhook/meta')
  receiveMeta(@Req() _req: Request, @Body() _payload: unknown) {
    return { received: true };
  }
}
