import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import axios from 'axios';
import { randomBytes } from 'crypto';
import { TenantConnectionService } from '../database/tenant/tenant-connection.service';
import { WhatsappChannel } from '../database/tenant/entities/whatsapp-channel.entity';
import type { AuthUser } from '../common/types/request.types';
import { REDIS_CLIENT } from '../redis/redis.module';
import type { WhatsAppConfig } from '../config/configuration';
import { MetaCloudProvider } from './providers/meta-cloud.provider';
import type { WhatsappProvider } from './providers/whatsapp-provider.interface';
import type { MetaConnectInitDto } from './dto/meta-connect-init.dto';
import type { MetaConnectCallbackDto } from './dto/meta-connect-callback.dto';

interface MetaOauthStatePayload {
  tenantId: string;
  userId: string;
  redirectUri: string;
}

interface ChannelConnectPayload {
  provider: 'meta_cloud' | 'baileys';
  displayName: string;
  phoneNumber: string;
  accessToken?: string;
  metaPhoneNumberId?: string;
  metaWabaId?: string;
}

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);
  private readonly providers: Record<
    'meta_cloud' | 'baileys',
    WhatsappProvider | null
  >;
  private readonly graphVersion: string;
  private readonly appId: string;
  private readonly appSecret: string;
  private readonly oauthStateTtlSeconds = 10 * 60;

  constructor(
    private readonly tenantConn: TenantConnectionService,
    metaCloud: MetaCloudProvider,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    config: ConfigService,
  ) {
    this.providers = {
      meta_cloud: metaCloud,
      // Baileys integration is intentionally deferred — keeping the slot
      // explicit so the rest of the code can stay provider-agnostic.
      baileys: null,
    };
    const wa = config.getOrThrow<WhatsAppConfig>('whatsapp');
    this.graphVersion = wa.metaGraphApiVersion;
    this.appId = wa.metaAppId;
    this.appSecret = wa.metaAppSecret;
  }

  private async repo(user: AuthUser) {
    return this.repoByTenantId(user.tenantId);
  }

  private async repoByTenantId(tenantId: string) {
    const ds = await this.tenantConn.getDataSourceForTenant(tenantId);
    return ds.getRepository(WhatsappChannel);
  }

  async listChannels(user: AuthUser): Promise<WhatsappChannel[]> {
    const repo = await this.repo(user);
    return repo.find({ order: { createdAt: 'ASC' } });
  }

  private async upsertConnectedChannel(
    repo: Awaited<ReturnType<WhatsappService['repoByTenantId']>>,
    dto: ChannelConnectPayload,
  ): Promise<WhatsappChannel> {
    const existing = await repo.findOne({
      where: { phoneNumber: dto.phoneNumber },
    });
    if (existing) {
      Object.assign(existing, {
        provider: dto.provider,
        displayName: dto.displayName,
        accessToken: dto.accessToken ?? existing.accessToken,
        metaPhoneNumberId: dto.metaPhoneNumberId ?? existing.metaPhoneNumberId,
        metaWabaId: dto.metaWabaId ?? existing.metaWabaId,
        status: 'connected',
        connectedAt: new Date(),
        lastError: null,
      });
      return repo.save(existing);
    }

    const channel = repo.create({
      provider: dto.provider,
      displayName: dto.displayName,
      phoneNumber: dto.phoneNumber,
      accessToken: dto.accessToken ?? null,
      metaPhoneNumberId: dto.metaPhoneNumberId ?? null,
      metaWabaId: dto.metaWabaId ?? null,
      status: 'connected',
      connectedAt: new Date(),
    });
    return repo.save(channel);
  }

  async initMetaConnect(user: AuthUser, dto: MetaConnectInitDto) {
    if (!this.appId || !this.appSecret) {
      throw new BadRequestException(
        'META_APP_ID dan META_APP_SECRET wajib diisi untuk flow OAuth Meta',
      );
    }
    const state = randomBytes(24).toString('hex');
    const key = this.oauthStateKey(state);
    const payload: MetaOauthStatePayload = {
      tenantId: user.tenantId,
      userId: user.userId,
      redirectUri: dto.redirectUri,
    };
    await this.redis.set(
      key,
      JSON.stringify(payload),
      'EX',
      this.oauthStateTtlSeconds,
    );

    const scopes = [
      'whatsapp_business_messaging',
      'whatsapp_business_management',
      'business_management',
    ];
    const oauthUrl = new URL(
      `https://www.facebook.com/${this.graphVersion}/dialog/oauth`,
    );
    oauthUrl.searchParams.set('client_id', this.appId);
    oauthUrl.searchParams.set('redirect_uri', dto.redirectUri);
    oauthUrl.searchParams.set('state', state);
    oauthUrl.searchParams.set('scope', scopes.join(','));
    oauthUrl.searchParams.set('response_type', 'code');

    return {
      state,
      oauthUrl: oauthUrl.toString(),
      expiresInSeconds: this.oauthStateTtlSeconds,
    };
  }

  async completeMetaConnect(dto: MetaConnectCallbackDto): Promise<WhatsappChannel> {
    const key = this.oauthStateKey(dto.state);
    const raw = await this.redis.get(key);
    if (!raw) {
      throw new BadRequestException(
        'State OAuth invalid/expired. Ulangi proses connect WhatsApp.',
      );
    }
    await this.redis.del(key);

    let payload: MetaOauthStatePayload;
    try {
      payload = JSON.parse(raw) as MetaOauthStatePayload;
    } catch {
      throw new BadRequestException('State OAuth tidak valid');
    }
    if (!payload.tenantId || !payload.userId || !payload.redirectUri) {
      throw new BadRequestException('State OAuth tidak lengkap');
    }

    const accessToken = await this.exchangeMetaCodeForToken(
      dto.code,
      payload.redirectUri,
    );

    const repo = await this.repoByTenantId(payload.tenantId);
    return this.upsertConnectedChannel(repo, {
      provider: 'meta_cloud',
      displayName: dto.displayName,
      phoneNumber: dto.phoneNumber,
      accessToken,
      metaPhoneNumberId: dto.metaPhoneNumberId,
      metaWabaId: dto.metaWabaId,
    });
  }

  async disconnect(
    user: AuthUser,
    channelId: string,
  ): Promise<WhatsappChannel> {
    const repo = await this.repo(user);
    const ch = await repo.findOne({ where: { id: channelId } });
    if (!ch) throw new NotFoundException('Channel tidak ditemukan');
    ch.status = 'disconnected';
    ch.connectedAt = null;
    return repo.save(ch);
  }

  async sendTestMessage(
    user: AuthUser,
    channelId: string,
    to: string,
    body: string,
  ): Promise<{ externalId: string }> {
    const repo = await this.repo(user);
    const ch = await repo.findOne({ where: { id: channelId } });
    if (!ch) throw new NotFoundException('Channel tidak ditemukan');
    if (ch.status !== 'connected') {
      throw new BadRequestException('Channel belum tersambung');
    }
    const provider = this.providers[ch.provider];
    if (!provider) {
      throw new BadRequestException(`Provider tidak tersedia: ${ch.provider}`);
    }
    if (!ch.accessToken) {
      throw new BadRequestException('Access token belum diset');
    }
    return provider.sendText(
      {
        displayName: ch.displayName,
        phoneNumber: ch.phoneNumber,
        accessToken: ch.accessToken,
        metaPhoneNumberId: ch.metaPhoneNumberId ?? undefined,
        metaWabaId: ch.metaWabaId ?? undefined,
      },
      { to, body },
    );
  }

  private oauthStateKey(state: string): string {
    return `whatsapp:meta:oauth:${state}`;
  }

  private async exchangeMetaCodeForToken(
    code: string,
    redirectUri: string,
  ): Promise<string> {
    if (!this.appId || !this.appSecret) {
      throw new BadRequestException(
        'META_APP_ID dan META_APP_SECRET wajib diisi untuk token exchange',
      );
    }
    const url = new URL(
      `https://graph.facebook.com/${this.graphVersion}/oauth/access_token`,
    );
    url.searchParams.set('client_id', this.appId);
    url.searchParams.set('client_secret', this.appSecret);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('code', code);

    try {
      const res = await axios.get<{ access_token?: string }>(url.toString(), {
        timeout: 15_000,
      });
      const token = res.data.access_token;
      if (!token) {
        throw new Error('Meta did not return access_token');
      }
      return token;
    } catch (error) {
      this.logger.error('Meta token exchange failed', error);
      throw new BadRequestException(
        'Gagal menukar authorization code ke access token Meta',
      );
    }
  }
}
