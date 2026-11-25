import { createHmac, timingSafeEqual } from 'crypto';
import config from '@/config';

export interface AppealTokenPayload {
  guildId: string;
  userId: string;
  exp: number;
}

function encode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function decode(value: string): string | null {
  try {
    return Buffer.from(value, 'base64url').toString('utf8');
  } catch {
    return null;
  }
}

function signature(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function signAppealToken(payload: AppealTokenPayload, secret = config.api.appealSigningSecret): string {
  if (!secret) throw new Error('Appeal signing secret is not configured');
  const encodedPayload = encode(JSON.stringify(payload));
  return `${encodedPayload}.${signature(encodedPayload, secret)}`;
}

export function verifyAppealToken(
  token: string,
  secret = config.api.appealSigningSecret,
  now = Math.floor(Date.now() / 1000),
): AppealTokenPayload | null {
  if (!secret) return null;

  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;

  const expected = Buffer.from(signature(parts[0], secret));
  const received = Buffer.from(parts[1]);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;

  const decoded = decode(parts[0]);
  if (!decoded) return null;

  try {
    const value = JSON.parse(decoded) as Partial<AppealTokenPayload>;
    if (
      typeof value.guildId !== 'string' ||
      !/^\d{17,20}$/.test(value.guildId) ||
      typeof value.userId !== 'string' ||
      !/^\d{17,20}$/.test(value.userId) ||
      typeof value.exp !== 'number' ||
      !Number.isFinite(value.exp) ||
      value.exp <= now
    ) {
      return null;
    }
    return { guildId: value.guildId, userId: value.userId, exp: value.exp };
  } catch {
    return null;
  }
}
