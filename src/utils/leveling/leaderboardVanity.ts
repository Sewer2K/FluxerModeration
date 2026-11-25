import GuildSettings from '@/models/GuildSettings';

export const RESERVED_LEADERBOARD_VANITIES = new Set([
  'admin',
  'api',
  'auth',
  'assets',
  'guilds',
  'health',
  'lb',
  'login',
  'logout',
  'my-data',
  'privacy',
  'public',
  'stats',
  'status',
  'terms',
]);

const SNOWFLAKE_RE = /^\d{17,20}$/;
const VANITY_RE = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;

export function isSnowflakeId(value: string): boolean {
  return SNOWFLAKE_RE.test(value);
}

export function normalizeLeaderboardVanity(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  if (trimmed.includes('--') || trimmed.startsWith('-') || trimmed.endsWith('-')) return null;
  if (!VANITY_RE.test(trimmed)) return null;
  if (RESERVED_LEADERBOARD_VANITIES.has(trimmed)) return null;
  if (isSnowflakeId(trimmed)) return null;
  return trimmed;
}

export function validateLeaderboardVanityFormat(raw: unknown): true | string {
  if (raw === null || raw === undefined || raw === '') return true;
  if (typeof raw !== 'string') return 'Vanity must be a string';
  const trimmed = raw.trim();
  if (!trimmed) return true;
  const normalized = normalizeLeaderboardVanity(trimmed);
  if (!normalized) {
    return 'Vanity must be 2–32 characters, lowercase letters, numbers, and hyphens only';
  }
  return true;
}

export async function findGuildIdByLeaderboardSlug(slug: string): Promise<string | null> {
  const decoded = decodeURIComponent(slug).trim();
  if (!decoded) return null;

  if (isSnowflakeId(decoded)) return decoded;

  const vanity = normalizeLeaderboardVanity(decoded);
  if (!vanity) return null;

  const doc = await GuildSettings.findOne({ 'leveling.leaderboardVanity': vanity }).select('guildId').lean();
  return doc?.guildId ?? null;
}

export async function findLeaderboardVanityConflict(vanity: string | null, guildId: string): Promise<string | null> {
  if (!vanity) return null;
  const doc = await GuildSettings.findOne({
    guildId: { $ne: guildId },
    'leveling.leaderboardVanity': vanity,
  })
    .select('guildId')
    .lean();
  return doc?.guildId ?? null;
}

export function leaderboardPublicSlug(vanity: string | null | undefined, guildId: string): string {
  return vanity || guildId;
}
