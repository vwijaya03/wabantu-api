/**
 * Adapter interface every WhatsApp provider must implement.
 *
 * The rest of the app (inbox, AI auto-reply) talks ONLY to this contract,
 * so swapping Meta Cloud API for Baileys (or anything else) later is a
 * one-file change in WhatsappModule.providers.
 */
export interface SendTextInput {
  to: string;
  body: string;
}

export interface SendTextResult {
  externalId: string;
}

export interface InboundMessage {
  /** Provider message id — used to dedupe. */
  externalId: string;
  /** E.164 phone of the customer. */
  fromPhone: string;
  /**
   * Meta Cloud: `metadata.phone_number_id` for the business number that received the message.
   * Used to match `WhatsappChannel.metaPhoneNumberId`.
   */
  toAddress: string;
  /**
   * Meta Cloud: `metadata.display_phone_number` (may include formatting).
   * Used to match `WhatsappChannel.phoneNumber` when `metaPhoneNumberId` was never stored.
   */
  toDisplayPhoneNumber?: string;
  /**
   * Optional sender display name (when webhook payload includes it, e.g. Meta
   * `contacts[].profile.name`).
   */
  fromDisplayName?: string | null;
  type: 'text' | 'image' | 'audio' | 'video' | 'document' | 'location';
  body: string | null;
  /** Provider-specific raw payload kept for debugging / replay. */
  raw: Record<string, unknown>;
  receivedAt: Date;
}

export interface ChannelCredentials {
  /** Display label, e.g. "Toko Cabang Jaksel". */
  displayName: string;
  /** E.164 number associated with this channel. */
  phoneNumber: string;
  /** Long-lived access token (encrypted at rest). */
  accessToken: string;
  /** Provider-specific extra fields. */
  metaPhoneNumberId?: string;
  metaWabaId?: string;
}

export interface WhatsappProvider {
  readonly providerName: 'meta_cloud' | 'baileys';
  sendText(
    creds: ChannelCredentials,
    input: SendTextInput,
  ): Promise<SendTextResult>;
  /** Parse a raw webhook payload into a normalized list of inbound messages. */
  parseWebhook(payload: unknown): InboundMessage[];
}
