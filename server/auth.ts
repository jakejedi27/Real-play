import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

/** Player tokens are high-entropy bearer secrets; only a hash is stored at rest. */
export function newPlayerCredentials(): { token: string; tokenHash: string } {
  const token = `rp_${randomBytes(32).toString('base64url')}`;
  return { token, tokenHash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

export function newId(): string {
  return randomUUID();
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function newGameCode(): string {
  const bytes = randomBytes(6);
  let out = '';
  for (let i = 0; i < 6; i += 1) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return out;
}

export function normalizeNickname(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
}

/** Returns an error message or null. Nicknames are display names only. */
export function validateNickname(nickname: string): string | null {
  if (nickname.length < 2) return 'Nickname must be at least 2 characters.';
  if (nickname.length > 20) return 'Nickname must be 20 characters or fewer.';
  if (!/^[\p{L}\p{N} ._'-]+$/u.test(nickname)) {
    return 'Nickname can use letters, numbers, spaces, dots, dashes and underscores.';
  }
  if (/[\u0000-\u001f\u007f]/.test(nickname)) return 'Nickname contains control characters.';
  return null;
}

export function normalizeCode(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toUpperCase() : '';
}
