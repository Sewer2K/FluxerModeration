import type { LevelingSettings } from './api';
import { fluxerAvatarUrl, fluxerIconUrl } from './cdn';

export function leaderboardSlug(leveling: Pick<LevelingSettings, 'leaderboardVanity'>, guildId: string): string {
  return leveling.leaderboardVanity || guildId;
}

export function leaderboardPublicPath(leveling: Pick<LevelingSettings, 'leaderboardVanity'>, guildId: string): string {
  return `/lb/${encodeURIComponent(leaderboardSlug(leveling, guildId))}`;
}

export function leaderboardPublicUrl(leveling: Pick<LevelingSettings, 'leaderboardVanity'>, guildId: string): string {
  const path = leaderboardPublicPath(leveling, guildId);
  if (typeof window !== 'undefined') return `${window.location.origin}${path}`;
  return path;
}

export function guildIconUrl(guildId: string, icon: string | null, size = 64): string | null {
  return fluxerIconUrl(guildId, icon, size);
}

export function userAvatarUrl(userId: string, avatar: string | null, size = 64): string | null {
  return fluxerAvatarUrl(userId, avatar, size);
}

export interface PublicLeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  avatar: string | null;
  level: number;
  xp: number;
  messages: number;
}

export interface PublicLeaderboardResponse {
  guild: { id: string; name: string; icon: string | null };
  slug: string;
  period: 'all' | 'weekly' | 'monthly';
  entries: PublicLeaderboardEntry[];
}

export async function fetchPublicLeaderboard(
  slug: string,
  period: 'all' | 'weekly' | 'monthly' = 'all',
): Promise<PublicLeaderboardResponse> {
  const params = new URLSearchParams({ period, limit: '25' });
  const res = await fetch(`/api/public/lb/${encodeURIComponent(slug)}?${params.toString()}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Failed to load leaderboard (${res.status})`);
  }
  return res.json();
}
