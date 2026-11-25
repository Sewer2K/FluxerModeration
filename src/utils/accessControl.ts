import type { Client, Guild } from '@fluxerjs/core';
import config from '@/config';
import log from '@/utils/consoleLogger';
import { fluxerApiUrl } from '@/utils/fluxerUrls';
import { messageFromError } from '@/utils/messageFromError';

const ADMINISTRATOR = 0x8n;
const MANAGE_GUILD = 0x20n;
const DASHBOARD_ACCESS_TTL_MS = 5 * 60 * 1000;

interface CachedAccess {
  allowed: boolean;
  expiresAt: number;
}

const dashboardAccessCache = new Map<string, CachedAccess>();

/**
 * The single guild this deployment serves. Empty means unrestricted, which is
 * the upstream default. Set ALLOWED_GUILD_ID for a private single-server bot.
 */
export function allowedGuildId(): string | null {
  return config.access?.allowedGuildId ?? null;
}

export function isGuildAllowed(guildId: string | null | undefined): boolean {
  const allowed = allowedGuildId();
  if (!allowed) return true;
  return guildId === allowed;
}

export function isDashboardUserAllowlisted(userId: string | null | undefined): boolean {
  if (!userId) return false;
  if (config.ownerId && userId === config.ownerId) return true;
  return (config.access?.dashboardAllowedUserIds ?? []).includes(userId);
}

function readCachedAccess(userId: string): boolean | null {
  const cached = dashboardAccessCache.get(userId);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    dashboardAccessCache.delete(userId);
    return null;
  }
  return cached.allowed;
}

function cacheAccess(userId: string, allowed: boolean): void {
  if (dashboardAccessCache.size > 5000) {
    const oldest = dashboardAccessCache.keys().next().value;
    if (oldest) dashboardAccessCache.delete(oldest);
  }
  dashboardAccessCache.set(userId, { allowed, expiresAt: Date.now() + DASHBOARD_ACCESS_TTL_MS });
}

/**
 * Dashboard access is limited to the owner, DASHBOARD_ALLOWED_USER_IDS, and
 * users who can manage the single allowed guild. When no guild lock is set,
 * the dashboard keeps its upstream behaviour.
 */
export async function canAccessDashboard(userId: string, token?: string | null): Promise<boolean> {
  if (isDashboardUserAllowlisted(userId)) return true;

  const guildId = allowedGuildId();
  if (!guildId) return true;
  if (!token) return false;

  const cached = readCachedAccess(userId);
  if (cached !== null) return cached;

  try {
    const res = await fetch(fluxerApiUrl('/users/@me/guilds'), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return false;

    const guilds = (await res.json()) as Array<{
      id: string;
      owner_id?: string;
      permissions?: string | null;
    }>;

    const guild = guilds.find((entry) => entry.id === guildId);
    let allowed = false;
    if (guild) {
      if (guild.owner_id && guild.owner_id === userId) {
        allowed = true;
      } else {
        const perms = guild.permissions ? BigInt(guild.permissions) : 0n;
        allowed = (perms & ADMINISTRATOR) === ADMINISTRATOR || (perms & MANAGE_GUILD) === MANAGE_GUILD;
      }
    }

    cacheAccess(userId, allowed);
    return allowed;
  } catch {
    return false;
  }
}

export function clearDashboardAccessCache(): void {
  dashboardAccessCache.clear();
}

async function leaveGuild(client: Client, guild: Guild): Promise<void> {
  log.warn('Access', `Leaving unauthorized guild ${guild.name || guild.id} (${guild.id}) - private deployment`);
  try {
    await client.user?.leaveGuild(guild.id);
  } catch (error: unknown) {
    log.error('Access', `Failed to leave guild ${guild.id}: ${messageFromError(error)}`);
  }
}

/**
 * Drop every guild except the configured one. Called on ready and on join so
 * the bot cannot be used on another server even if someone has the invite.
 */
export async function enforceGuildLock(client: Client): Promise<void> {
  const guildId = allowedGuildId();
  if (!guildId) return;

  if (!client.guilds.has(guildId)) {
    log.warn('Access', `ALLOWED_GUILD_ID=${guildId} is set but the bot is not in that guild yet.`);
  }

  for (const guild of client.guilds.values()) {
    if (guild.id === guildId) continue;
    await leaveGuild(client, guild);
  }
}

/** Returns true when the guild was rejected and the bot is leaving it. */
export async function rejectGuildIfUnauthorized(client: Client, guild: Guild): Promise<boolean> {
  if (isGuildAllowed(guild.id)) return false;
  await leaveGuild(client, guild);
  return true;
}
