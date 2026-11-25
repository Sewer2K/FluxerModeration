import type { Client } from '@fluxerjs/core';
import { Routes } from '@fluxerjs/types';
import type { APIGuild, APIUser } from '@fluxerjs/types';
import LevelProfile from '@/models/LevelProfile';
import settingsCache from '../settingsCache';
import { normalizeLevelingSettings } from '@/types/Leveling';
import { leaderboardPublicSlug } from './leaderboardVanity';
import { levelForXp } from './memberXp';

export type LeaderboardPeriod = 'all' | 'weekly' | 'monthly';

export interface PublicLeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  avatar: string | null;
  level: number;
  xp: number;
  messages: number;
}

export interface PublicLeaderboardPayload {
  guild: { id: string; name: string; icon: string | null };
  slug: string;
  period: LeaderboardPeriod;
  entries: PublicLeaderboardEntry[];
}

function sortFieldForPeriod(period: LeaderboardPeriod): 'xp' | 'weeklyXp' | 'monthlyXp' {
  if (period === 'weekly') return 'weeklyXp';
  if (period === 'monthly') return 'monthlyXp';
  return 'xp';
}

async function resolveUsername(
  client: Client,
  guildId: string,
  userId: string,
): Promise<{ username: string; avatar: string | null }> {
  const guild = client.guilds.get(guildId);
  const member = guild?.members?.get?.(userId);
  if (member) {
    const user = member.user ?? member;
    return {
      username: user.globalName || user.username || userId,
      avatar: user.avatar ?? null,
    };
  }

  try {
    const user = (await client.rest.get(Routes.user(userId))) as APIUser;
    return {
      username: user.global_name || user.username || userId,
      avatar: user.avatar ?? null,
    };
  } catch {
    return { username: userId, avatar: null };
  }
}

async function resolveGuildMeta(client: Client, guildId: string): Promise<{ name: string; icon: string | null }> {
  const cached = client.guilds.get(guildId);
  if (cached) {
    return { name: cached.name, icon: cached.icon ?? null };
  }

  try {
    const guild = (await client.rest.get(Routes.guild(guildId))) as APIGuild;
    return { name: guild.name, icon: guild.icon ?? null };
  } catch {
    return { name: 'Unknown Server', icon: null };
  }
}

export async function buildPublicLeaderboard(
  client: Client,
  guildId: string,
  period: LeaderboardPeriod,
  limit = 25,
): Promise<PublicLeaderboardPayload | null> {
  const settings = await settingsCache.get(guildId).catch(() => null);
  const leveling = normalizeLevelingSettings(settings?.leveling);
  if (!leveling.enabled) return null;

  const sortField = sortFieldForPeriod(period);
  const top = await LevelProfile.getTop(guildId, limit, sortField);
  const guildMeta = await resolveGuildMeta(client, guildId);

  const entries = await Promise.all(
    top.map(async (profile, i): Promise<PublicLeaderboardEntry> => {
      const { username, avatar } = await resolveUsername(client, guildId, profile.userId);

      return {
        rank: i + 1,
        userId: profile.userId,
        username,
        avatar,
        level: levelForXp(profile.xp, leveling.formula),
        xp: profile[sortField] ?? 0,
        messages: profile.messages ?? 0,
      };
    }),
  );

  return {
    guild: { id: guildId, name: guildMeta.name, icon: guildMeta.icon },
    slug: leaderboardPublicSlug(leveling.leaderboardVanity, guildId),
    period,
    entries,
  };
}
