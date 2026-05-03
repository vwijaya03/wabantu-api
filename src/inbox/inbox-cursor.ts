import { Buffer } from 'buffer';

export interface ConversationListCursor {
  lastMessageAt: string | null;
  id: string;
}

/** Keyset for message history: `created_at` (ISO) + `id` tie-breaker (never use time alone). */
export interface MessageHistoryCursor {
  createdAt: string;
  id: string;
}

export function encodeCursor(payload: object): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeCursor<T>(raw: string | undefined): T | null {
  if (!raw?.trim()) return null;
  try {
    const json = Buffer.from(raw, 'base64url').toString('utf8');
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}
