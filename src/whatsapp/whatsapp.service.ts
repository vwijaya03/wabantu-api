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
  metaAppId: string;
  metaAppSecret: string;
}

interface ChannelConnectPayload {
  provider: 'meta_cloud' | 'baileys';
  displayName: string;
  phoneNumber: string;
  accessToken?: string;
  metaPhoneNumberId?: string;
  metaWabaId?: string;
  metaAppId?: string;
  metaAppSecret?: string;
}

interface MetaPhoneNumberNode {
  id?: string;
  display_phone_number?: string;
}

interface MetaWabaNode {
  id?: string;
  phone_numbers?: { data?: MetaPhoneNumberNode[] } | MetaPhoneNumberNode[];
}

interface MetaMeResponse {
  whatsapp_business_accounts?: { data?: MetaWabaNode[] } | MetaWabaNode[];
}

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);
  private readonly providers: Record<
    'meta_cloud' | 'baileys',
    WhatsappProvider | null
  >;
  private readonly graphVersion: string;
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
        metaAppId: dto.metaAppId ?? existing.metaAppId,
        metaAppSecret: dto.metaAppSecret ?? existing.metaAppSecret,
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
      metaAppId: dto.metaAppId ?? null,
      metaAppSecret: dto.metaAppSecret ?? null,
      status: 'connected',
      connectedAt: new Date(),
    });
    return repo.save(channel);
  }

  async initMetaConnect(user: AuthUser, dto: MetaConnectInitDto) {
    const appId = dto.metaAppId;
    const appSecret = dto.metaAppSecret;
    if (!appId || !appSecret) {
      throw new BadRequestException(
        'metaAppId dan metaAppSecret wajib diisi untuk flow OAuth Meta',
      );
    }
    const state = randomBytes(24).toString('hex');
    const key = this.oauthStateKey(state);
    const payload: MetaOauthStatePayload = {
      tenantId: user.tenantId,
      userId: user.userId,
      redirectUri: dto.redirectUri,
      metaAppId: appId,
      metaAppSecret: appSecret,
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
    oauthUrl.searchParams.set('client_id', appId);
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
    if (!payload.metaAppId || !payload.metaAppSecret) {
      throw new BadRequestException('State OAuth app credentials tidak lengkap');
    }

    const accessToken = await this.exchangeMetaCodeForToken(
      dto.code,
      payload.redirectUri,
      payload.metaAppId,
      payload.metaAppSecret,
    );
    const discovered = await this.fetchMetaWabaAndPhoneNumberIds(
      accessToken,
      dto.phoneNumber,
    );

    const repo = await this.repoByTenantId(payload.tenantId);
    return this.upsertConnectedChannel(repo, {
      provider: 'meta_cloud',
      displayName: dto.displayName,
      phoneNumber: dto.phoneNumber,
      accessToken,
      metaPhoneNumberId: dto.metaPhoneNumberId ?? discovered.metaPhoneNumberId,
      metaWabaId: dto.metaWabaId ?? discovered.metaWabaId,
      metaAppId: payload.metaAppId,
      metaAppSecret: payload.metaAppSecret,
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
    appId: string,
    appSecret: string,
  ): Promise<string> {
    if (!appId || !appSecret) {
      throw new BadRequestException(
        'metaAppId dan metaAppSecret wajib diisi untuk token exchange',
      );
    }
    const url = new URL(
      `https://graph.facebook.com/${this.graphVersion}/oauth/access_token`,
    );
    url.searchParams.set('client_id', appId);
    url.searchParams.set('client_secret', appSecret);
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

  private async fetchMetaWabaAndPhoneNumberIds(
    accessToken: string,
    targetPhoneNumber: string,
  ): Promise<{ metaWabaId?: string; metaPhoneNumberId?: string }> {
    const url = new URL(`https://graph.facebook.com/${this.graphVersion}/me`);
    url.searchParams.set(
      'fields',
      'whatsapp_business_accounts{id,phone_numbers{id,display_phone_number}}',
    );
    url.searchParams.set('access_token', accessToken);

    try {
      const res = await axios.get<MetaMeResponse>(url.toString(), {
        timeout: 15_000,
      });
      const wabasRaw = res.data.whatsapp_business_accounts;
      const wabas = Array.isArray(wabasRaw)
        ? wabasRaw
        : (wabasRaw?.data ?? []);
      if (wabas.length === 0) return {};

      const target = this.normalizePhone(targetPhoneNumber);
      const firstWaba = wabas[0];
      let fallbackPhoneId: string | undefined;

      for (const waba of wabas) {
        const phonesRaw = waba.phone_numbers;
        const phones = Array.isArray(phonesRaw)
          ? phonesRaw
          : (phonesRaw?.data ?? []);
        if (!fallbackPhoneId && phones[0]?.id) {
          fallbackPhoneId = phones[0].id;
        }
        for (const phone of phones) {
          const candidate = this.normalizePhone(phone.display_phone_number ?? '');
          if (candidate && target && candidate.endsWith(target) && phone.id) {
            return {
              metaWabaId: waba.id,
              metaPhoneNumberId: phone.id,
            };
          }
        }
      }

      return {
        metaWabaId: firstWaba?.id,
        metaPhoneNumberId: fallbackPhoneId,
      };
    } catch (error) {
      this.logger.warn(
        'Unable to auto-discover Meta WABA/phone IDs; channel will still connect',
      );
      this.logger.debug(error);
      return {};
    }
  }

  private normalizePhone(value: string): string {
    return value.replace(/\D/g, '');
  }
}
