import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import type { WhatsAppConfig } from '../../config/configuration';
import type {
  ChannelCredentials,
  InboundMessage,
  SendTextInput,
  SendTextResult,
  WhatsappProvider,
} from './whatsapp-provider.interface';

interface MetaWebhookEntry {
  changes?: Array<{
    value?: {
      metadata?: { display_phone_number?: string; phone_number_id?: string };
      contacts?: Array<{
        wa_id?: string;
        profile?: {
          name?: string;
          first_name?: string;
          last_name?: string;
        };
      }>;
      messages?: Array<{
        id: string;
        from: string;
        timestamp: string;
        type: string;
        text?: { body?: string };
        image?: { id: string; caption?: string };
        audio?: { id: string };
        video?: { id: string; caption?: string };
        document?: { id: string; filename?: string; caption?: string };
        location?: { latitude: number; longitude: number; name?: string };
      }>;
    };
  }>;
}

interface MetaWebhookPayload {
  object?: string;
  entry?: MetaWebhookEntry[];
}

@Injectable()
export class MetaCloudProvider implements WhatsappProvider {
  readonly providerName = 'meta_cloud' as const;
  private readonly logger = new Logger(MetaCloudProvider.name);
  private readonly graphVersion: string;

  constructor(config: ConfigService) {
    this.graphVersion =
      config.getOrThrow<WhatsAppConfig>('whatsapp').metaGraphApiVersion;
  }

  async sendText(
    creds: ChannelCredentials,
    input: SendTextInput,
  ): Promise<SendTextResult> {
    if (!creds.metaPhoneNumberId) {
      throw new Error('Channel missing metaPhoneNumberId');
    }
    const url = `https://graph.facebook.com/${this.graphVersion}/${creds.metaPhoneNumberId}/messages`;
    const body = {
      messaging_product: 'whatsapp',
      to: input.to.replace(/^\+/, ''),
      type: 'text',
      text: { preview_url: false, body: input.body },
    };
    const res = await axios.post<{ messages?: Array<{ id: string }> }>(
      url,
      body,
      {
        headers: {
          Authorization: `Bearer ${creds.accessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 15_000,
      },
    );
    const externalId = res.data.messages?.[0]?.id;
    if (!externalId) throw new Error('Meta Cloud API returned no message id');
    return { externalId };
  }

  parseWebhook(payload: unknown): InboundMessage[] {
    const p = payload as MetaWebhookPayload;
    if (!p || p.object !== 'whatsapp_business_account') return [];
    const out: InboundMessage[] = [];
    for (const entry of p.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        const phoneNumberId = value?.metadata?.phone_number_id ?? '';
        const displayPhone = value?.metadata?.display_phone_number;
        const contactMap = new Map<string, string>();
        for (const c of value?.contacts ?? []) {
          const wa = c.wa_id ?? '';
          const name = c.profile?.name
            ? c.profile.name
            : c.profile?.first_name && c.profile?.last_name
              ? `${c.profile.first_name} ${c.profile.last_name}`
              : c.profile?.first_name ?? c.profile?.last_name ?? '';
          if (wa && name.trim()) contactMap.set(wa, name.trim());
        }
        for (const m of value?.messages ?? []) {
          let body: string | null = null;
          let type: InboundMessage['type'] = 'text';
          switch (m.type) {
            case 'text':
              body = m.text?.body ?? null;
              type = 'text';
              break;
            case 'image':
              body = m.image?.caption ?? null;
              type = 'image';
              break;
            case 'audio':
              body = null;
              type = 'audio';
              break;
            case 'video':
              body = m.video?.caption ?? null;
              type = 'video';
              break;
            case 'document':
              body = m.document?.filename ?? null;
              type = 'document';
              break;
            case 'location':
              body = m.location?.name ?? null;
              type = 'location';
              break;
            default:
              this.logger.debug(`Ignored unsupported message type: ${m.type}`);
              continue;
          }
          out.push({
            externalId: m.id,
            fromPhone: m.from,
            toAddress: phoneNumberId,
            toDisplayPhoneNumber: displayPhone,
            fromDisplayName: contactMap.get(m.from) ?? null,
            type,
            body,
            raw: m,
            receivedAt: new Date(Number(m.timestamp) * 1000),
          });
        }
      }
    }
    return out;
  }
}
