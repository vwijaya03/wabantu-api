import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'crypto';
import type { ValueTransformer } from 'typeorm';

const ENC_PREFIX = 'enc:v1:';
const ALGO = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

/**
 * Derive a stable 32-byte key from env.
 * We hash the configured secret so operators can provide either:
 *   - a long random string
 *   - base64 output from openssl
 */
const resolveKey = (): Buffer => {
  const secret = process.env.DATA_ENCRYPTION_KEY ?? '';
  if (!secret || secret.length < 32) {
    throw new Error(
      'DATA_ENCRYPTION_KEY is missing or too short. Use a random string >= 32 chars.',
    );
  }
  return createHash('sha256').update(secret).digest();
};

let KEY_CACHE: Buffer | null = null;
const getKey = (): Buffer => {
  if (KEY_CACHE) return KEY_CACHE;
  KEY_CACHE = resolveKey();
  return KEY_CACHE;
};

export const hashForLookup = (plain: string): string =>
  createHash('sha256').update(plain).digest('hex');

export const normalizeEmail = (email: string): string =>
  email.trim().toLowerCase();

export const encryptField = (plain: string): string => {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  const encrypted = Buffer.concat([
    cipher.update(plain, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${ENC_PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
};

export const decryptField = (stored: string): string => {
  const key = getKey();
  // Backward compatibility: plaintext rows from old versions keep working.
  if (!stored.startsWith(ENC_PREFIX)) return stored;
  const raw = stored.slice(ENC_PREFIX.length);
  const [ivB64, tagB64, dataB64] = raw.split(':');
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('Invalid encrypted payload format');
  }
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');
  const decipher = createDecipheriv(ALGO, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString('utf8');
};

export const encryptedStringTransformer: ValueTransformer = {
  to(value?: string | null): string | null {
    if (value === null || value === undefined) return null;
    return encryptField(value);
  },
  from(value?: string | null): string | null {
    if (value === null || value === undefined) return null;
    return decryptField(value);
  },
};
