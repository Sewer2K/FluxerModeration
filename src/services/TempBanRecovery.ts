import type { Client } from '@fluxerjs/core';
import type { ITempBan } from '@/models/TempBan';
import TempBan from '@/models/TempBan';
import config from '@/config';
import { messageFromError } from '@/utils/messageFromError';
import { logModAction } from '@/utils/logger';

const MAX_TIMER_DELAY = 2_147_483_647;
const RETRY_DELAY = 60_000;

function isAlreadyUnbanned(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  if ('statusCode' in error && error.statusCode === 404) return true;
  if ('status' in error && error.status === 404) return true;
  if ('code' in error && (error.code === 10026 || error.code === 'UNKNOWN_BAN')) return true;
  return false;
}

function retryTempBanExpiry(entry: ITempBan, client: Client): void {
  const timer = setTimeout(() => {
    void executeTempBanExpiry(entry, client);
  }, RETRY_DELAY);
  timer.unref?.();
}

export function scheduleTempBanExpiry(entry: ITempBan, client: Client): void {
  const delay = entry.expiresAt.getTime() - Date.now();
  if (delay <= 0) {
    void executeTempBanExpiry(entry, client);
    return;
  }

  const timer = setTimeout(
    () => {
      scheduleTempBanExpiry(entry, client);
    },
    Math.min(delay, MAX_TIMER_DELAY),
  );
  timer.unref?.();
}

export async function executeTempBanExpiry(entry: ITempBan, client: Client): Promise<void> {
  const guild = client.guilds?.get(entry.guildId) ?? (await client.guilds.fetch(entry.guildId).catch(() => null));
  if (!guild) {
    console.warn(`[tempban] Guild ${entry.guildId} unavailable while expiring ban for ${entry.userId}`);
    retryTempBanExpiry(entry, client);
    return;
  }

  try {
    await guild.unban(entry.userId);
  } catch (error: unknown) {
    if (!isAlreadyUnbanned(error)) {
      console.error(`[tempban] Failed to unban ${entry.userId} in ${entry.guildId}: ${messageFromError(error)}`);
      retryTempBanExpiry(entry, client);
      return;
    }
  }

  await logModAction(
    guild,
    { id: client.user?.id ?? '0', username: `${config.branding.publicName}` },
    { id: entry.userId, username: entry.userId },
    'unban',
    'Temp ban expired',
    { client },
  ).catch(() => {});

  try {
    await TempBan.deleteOne({ _id: entry._id });
  } catch (error: unknown) {
    console.error(`[tempban] Failed to remove expired record for ${entry.userId}: ${messageFromError(error)}`);
    retryTempBanExpiry(entry, client);
  }
}

export async function scheduleTempBanExpiries(client: Client): Promise<void> {
  try {
    const outstanding = await TempBan.find({});
    for (const entry of outstanding) scheduleTempBanExpiry(entry, client);
    if (outstanding.length > 0) {
      console.log(`[tempban] Scheduled ${outstanding.length} temp ban expiry/ies`);
    }
  } catch (error: unknown) {
    console.warn(`[tempban] Failed to schedule expiries: ${messageFromError(error)}`);
  }
}
