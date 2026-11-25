import type { GuildMember, User } from '@fluxerjs/core';
import LevelProfile from '@/models/LevelProfile';
import parseUserId from '../parseUserId';
import type { ILeveling, ILevelingFormula } from '@/types/Leveling';
import { capXpForMaxLevel, levelFromXp } from './formula';

export type LeaderboardPeriod = 'all' | 'weekly' | 'monthly';

export function leaderboardSortField(period: LeaderboardPeriod): 'xp' | 'weeklyXp' | 'monthlyXp' {
  if (period === 'weekly') return 'weeklyXp';
  if (period === 'monthly') return 'monthlyXp';
  return 'xp';
}

export function levelForXp(xp: number, formula: ILevelingFormula): number {
  return levelFromXp(Math.max(0, xp), formula);
}

export function parseLeaderboardPeriod(arg?: string): LeaderboardPeriod | null {
  if (!arg) return 'all';
  const lower = arg.toLowerCase();
  if (['weekly', 'week', 'w'].includes(lower)) return 'weekly';
  if (['monthly', 'month', 'm'].includes(lower)) return 'monthly';
  if (['all', 'total', 'xp'].includes(lower)) return 'all';
  return null;
}

export function resolveTargetUserId(fallbackId: string, arg?: string): string | null {
  if (!arg) return fallbackId;
  const mention = arg.match(/^<@!?(\d+)>$/);
  if (mention && '1' in mention) return mention[1];
  if (/^\d{15,21}$/.test(arg)) return arg;
  return parseUserId(arg);
}

export function resolveMemberUsername(person: GuildMember | User | null | undefined, userId: string): string {
  if (person) {
    const displayName = 'displayName' in person ? person.displayName : null;
    if (typeof displayName === 'string' && displayName.trim()) return displayName.trim();

    const nickname = 'nick' in person ? person.nick : null;
    if (typeof nickname === 'string' && nickname.trim()) return nickname.trim();

    const user = 'user' in person ? person.user : person;

    const globalName = user.globalName;
    if (typeof globalName === 'string' && globalName.trim()) return globalName.trim();

    const username = user.username;
    if (typeof username === 'string' && username.trim()) return username.trim();
  }

  return userId;
}

export function resolveMemberAvatarUrl(person: User | GuildMember | null | undefined): string | null {
  const user = person && ('user' in person ? person.user : person);
  if (!user) return null;

  return (
    user.displayAvatarURL?.({ size: 256 }) ??
    (typeof user.avatarURL === 'function' ? user.avatarURL({ size: 256 }) : user.avatarURL) ??
    null
  );
}

export interface XpAdjustResult {
  userId: string;
  delta: number;
  xp: number;
  level: number;
  leveledUp: boolean;
  previousLevel: number;
}

export async function applyXpDelta(
  guildId: string,
  userId: string,
  delta: number,
  leveling: ILeveling,
): Promise<XpAdjustResult | null> {
  if (!Number.isFinite(delta) || delta === 0) return null;

  const before = await LevelProfile.findOne({ guildId, userId }).lean();
  const previousLevel = before?.level ?? 0;
  const previousXp = before?.xp ?? 0;
  const nextXp = capXpForMaxLevel(Math.max(0, previousXp + delta), leveling.formula);
  const nextLevel = levelFromXp(nextXp, leveling.formula);

  const doc = await LevelProfile.findOneAndUpdate(
    { guildId, userId },
    { $set: { xp: nextXp, level: nextLevel } },
    { upsert: delta > 0, returnDocument: 'after', setDefaultsOnInsert: true },
  );

  if (!doc) return null;

  return {
    userId,
    delta,
    xp: doc.xp,
    level: doc.level,
    leveledUp: doc.level > previousLevel,
    previousLevel,
  };
}

export async function resetMemberXp(guildId: string, userId: string): Promise<boolean> {
  const result = await LevelProfile.deleteOne({ guildId, userId });
  return (result.deletedCount ?? 0) > 0;
}
