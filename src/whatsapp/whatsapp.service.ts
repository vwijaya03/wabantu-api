import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { TenantConnectionService } from '../database/tenant/tenant-connection.service';
import { WhatsappChannel } from '../database/tenant/entities/whatsapp-channel.entity';
import type { AuthUser } from '../common/types/request.types';
import { MetaCloudProvider } from './providers/meta-cloud.provider';
import type { WhatsappProvider } from './providers/whatsapp-provider.interface';
import type { ConnectChannelDto } from './dto/connect-channel.dto';

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);
  private readonly providers: Record<
    'meta_cloud' | 'baileys',
    WhatsappProvider | null
  >;

  constructor(
    private readonly tenantConn: TenantConnectionService,
    metaCloud: MetaCloudProvider,
  ) {
    this.providers = {
      meta_cloud: metaCloud,
      // Baileys integration is intentionally deferred — keeping the slot
      // explicit so the rest of the code can stay provider-agnostic.
      baileys: null,
    };
  }

  private async repo(user: AuthUser) {
    const ds = await this.tenantConn.getDataSourceForTenant(user.tenantId);
    return ds.getRepository(WhatsappChannel);
  }

  async listChannels(user: AuthUser): Promise<WhatsappChannel[]> {
    const repo = await this.repo(user);
    return repo.find({ order: { createdAt: 'ASC' } });
  }

  async connectChannel(
    user: AuthUser,
    dto: ConnectChannelDto,
  ): Promise<WhatsappChannel> {
    const provider = this.providers[dto.provider];
    if (!provider) {
      throw new BadRequestException(`Provider belum tersedia: ${dto.provider}`);
    }
    if (dto.provider === 'meta_cloud') {
      if (!dto.accessToken || !dto.metaPhoneNumberId) {
        throw new BadRequestException(
          'Meta Cloud API perlu accessToken dan metaPhoneNumberId',
        );
      }
    }

    const repo = await this.repo(user);
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
}
