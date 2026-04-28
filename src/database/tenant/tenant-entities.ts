import { BusinessProfile } from './entities/business-profile.entity';
import { Contact } from './entities/contact.entity';
import { Conversation } from './entities/conversation.entity';
import { KnowledgeBaseEntry } from './entities/knowledge-base-entry.entity';
import { Message } from './entities/message.entity';
import { WhatsappChannel } from './entities/whatsapp-channel.entity';

/**
 * Single source of truth for the entity classes that live inside a
 * tenant schema. Used by:
 *   - the migration that bootstraps a new tenant schema (synchronize)
 *   - per-request tenant connections (TenantConnectionService)
 */
export const TENANT_ENTITIES = [
  BusinessProfile,
  KnowledgeBaseEntry,
  WhatsappChannel,
  Contact,
  Conversation,
  Message,
];
