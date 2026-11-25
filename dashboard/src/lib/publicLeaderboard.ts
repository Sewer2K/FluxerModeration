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

export const MOCK_PUBLIC_LEADERBOARD: PublicLeaderboardResponse = {
  guild: { id: 'mock', name: 'ClaudeCityMod Mock Server', icon: null },
  slug: 'mock',
  period: 'all',
  entries: [
    { rank: 1, userId: '300000000000000001', username: 'Nova', avatar: null, level: 12, xp: 4200, messages: 842 },
    { rank: 2, userId: '300000000000000002', username: 'Kira', avatar: null, level: 9, xp: 2800, messages: 510 },
    { rank: 3, userId: '300000000000000003', username: 'Rex', avatar: null, level: 7, xp: 1900, messages: 388 },
    { rank: 4, userId: '300000000000000004', username: 'Milo', avatar: null, level: 5, xp: 950, messages: 201 },
    { rank: 5, userId: '300000000000000005', username: 'Jade', avatar: null, level: 4, xp: 620, messages: 144 },
  ],
};

export async function fetchPublicLeaderboard(
  slug: string,
  period: 'all' | 'weekly' | 'monthly' = 'all',
): Promise<PublicLeaderboardResponse> {
  const mockMode = import.meta.env.VITE_MOCK_MODE === 'true';
  if (mockMode && (slug === 'mock' || slug.startsWith('mock'))) {
    return { ...MOCK_PUBLIC_LEADERBOARD, slug, period };
  }

  const params = new URLSearchParams({ period, limit: '25' });
  const res = await fetch(`/api/public/lb/${encodeURIComponent(slug)}?${params.toString()}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Failed to load leaderboard (${res.status})`);
  }
  return res.json();
}
