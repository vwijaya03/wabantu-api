import { Injectable } from '@nestjs/common';

const PROMPT_INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions?/i,
  /system\s+prompt/i,
  /developer\s+message/i,
  /act\s+as\s+(an?\s+)?(admin|developer|root)/i,
  /(show|reveal|leak).*(secret|token|password|key)/i,
  /(drop|truncate|delete|alter)\s+(table|database|schema)/i,
];

const ID_STOPWORDS = new Set([
  'yang',
  'dan',
  'atau',
  'untuk',
  'dengan',
  'dari',
  'kami',
  'kamu',
  'saya',
  'anda',
  'ini',
  'itu',
  'ada',
  'mau',
  'juga',
  'agar',
  'supaya',
  'bisa',
  'lebih',
  'sudah',
  'belum',
  'dalam',
  'pada',
  'di',
  'ke',
  'the',
  'and',
  'for',
  'with',
]);

@Injectable()
export class AiSafetyService {
  sanitizeForPrompt(raw: string | null | undefined): string {
    if (!raw) return '';
    return raw.replace(/\u0000/g, '').trim().slice(0, 2000);
  }

  isPromptInjectionLikely(raw: string | null | undefined): boolean {
    if (!raw) return false;
    const text = raw.trim();
    if (!text) return false;
    return PROMPT_INJECTION_PATTERNS.some((p) => p.test(text));
  }

  isQuestionLike(raw: string | null | undefined): boolean {
    if (!raw) return false;
    const text = raw.trim().toLowerCase();
    if (!text) return false;
    if (text.includes('?')) return true;
    return [
      'apa',
      'apakah',
      'berapa',
      'gimana',
      'bagaimana',
      'kapan',
      'bisa',
      'stok',
      'size',
      'ukuran',
      'harga',
      'order',
      'pesan',
      'kirim',
    ].some((k) => text.includes(k));
  }

  isGreetingLike(raw: string | null | undefined): boolean {
    if (!raw) return false;
    const text = raw.trim().toLowerCase();
    if (!text) return false;
    // Keep this strict to avoid replying to every short message.
    return [
      'selamat pagi',
      'selamat siang',
      'selamat sore',
      'selamat malam',
      'halo',
      'hai',
      'assalamualaikum',
      'salam',
      'permisi',
    ].some((k) => text === k || text.startsWith(`${k} `));
  }

  extractScopeKeywords(scopeText: string): string[] {
    return [...new Set(
      scopeText
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .map((w) => w.trim())
        .filter(
          (w) => w.length >= 4 && !ID_STOPWORDS.has(w) && !/^\d+$/.test(w),
        ),
    )];
  }

  isWithinBusinessScope(
    userText: string,
    scopeKeywords: string[],
    fallbackKeywords: string[] = [],
  ): boolean {
    const text = userText.toLowerCase();
    const lookup = scopeKeywords.length > 0 ? scopeKeywords : fallbackKeywords;
    if (lookup.length === 0) return true;
    return lookup.some((k) => text.includes(k));
  }
}
