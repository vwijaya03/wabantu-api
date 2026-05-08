export interface AiReplyJobPayload {
  tenantId: string;
  conversationId: string;
  inboundMessageId: string;
  inboundType: 'text' | 'image' | 'audio' | 'video' | 'document' | 'location';
}
