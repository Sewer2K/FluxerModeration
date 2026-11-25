import LevelProfile from '@/models/LevelProfile';
import type { ILeveling } from '@/types/Leveling';
import { capXpForMaxLevel, levelFromXp } from './formula';
import { canEarnXp, getLevelingConfig } from './restrictions';
import { evaluateMessageXpQuality } from './messageXpQuality';
import { Client } from '@fluxerjs/core';

type CooldownKey = `${string}:${string}:${string}`;

const cooldowns = new Map<CooldownKey, number>();
const MAX_COOLDOWN_ENTRIES = 50_000;

function cooldownKey(guildId: string, userId: string, kind: string): CooldownKey {
  return `${guildId}:${userId}:${kind}`;
}

function checkCooldown(key: CooldownKey, seconds: number): boolean {
  const now = Date.now();
  const last = cooldowns.get(key);
  if (last && now - last < seconds * 1000) return false;

  if (cooldowns.size > MAX_COOLDOWN_ENTRIES) {
    for (const [k, ts] of cooldowns) {
      if (now - ts >= seconds * 1000) cooldowns.delete(k);
    }
  }
  cooldowns.set(key, now);
  return true;
}

function randomInRange(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

export interface LevelUpResult {
  leveledUp: boolean;
  newLevel: number;
  profile: { xp: number; level: number; messages: number };
}

async function awardXp(
  guildId: string,
  userId: string,
  amount: number,
  leveling: ILeveling,
  countMessage = false,
): Promise<LevelUpResult | null> {
  if (amount <= 0) return null;

  const before = await LevelProfile.findOne({ guildId, userId }).lean();
  const beforeLevel = before?.level ?? 0;

  const doc = await LevelProfile.findOneAndUpdate(
    { guildId, userId },
    { $inc: { xp: amount, weeklyXp: amount, monthlyXp: amount, ...(countMessage ? { messages: 1 } : {}) } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );

  doc.xp = capXpForMaxLevel(doc.xp, leveling.formula);
  const newLevel = levelFromXp(doc.xp, leveling.formula);
  if (newLevel !== doc.level) doc.level = newLevel;
  await doc.save();

  return {
    leveledUp: doc.level > beforeLevel,
    newLevel: doc.level,
    profile: { xp: doc.xp, level: doc.level, messages: doc.messages },
  };
}

export async function trackMessageXp(
  settings: { leveling?: Partial<ILeveling> | null },
  guildId: string,
  userId: string,
  opts: {
    channelId?: string | null;
    memberRoleIds?: readonly string[];
    wordCount?: number;
    isVoiceTextChannel?: boolean;
    content?: string;
    isCommand?: boolean;
    hasAttachments?: boolean;
    hasStickers?: boolean;
  },
): Promise<LevelUpResult | null> {
  const leveling = getLevelingConfig(settings);
  if (!leveling.enabled || !leveling.messageXp.enabled) return null;
  if (!canEarnXp(leveling, opts)) return null;

  const content = opts.content ?? '';
  const wordCount = opts.wordCount ?? (content.trim() ? content.trim().split(/\s+/).filter(Boolean).length : 0);
  const quality = evaluateMessageXpQuality(leveling.messageXp.quality, {
    guildId,
    userId,
    content,
    wordCount,
    isCommand: !!opts.isCommand,
    hasAttachments: !!opts.hasAttachments,
    hasStickers: !!opts.hasStickers,
  });
  if (!quality.allowed) return null;

  const key = cooldownKey(guildId, userId, 'message');
  if (!checkCooldown(key, leveling.messageXp.cooldownSeconds)) return null;

  let amount: number;
  if (leveling.messageXp.mode === 'per_word') {
    const words = Math.min(Math.max(1, wordCount), leveling.messageXp.quality.maxWordsCounted);
    amount = randomInRange(leveling.messageXp.min, leveling.messageXp.max) * words;
  } else {
    amount = randomInRange(leveling.messageXp.min, leveling.messageXp.max);
  }

  return awardXp(guildId, userId, amount, leveling, true);
}

export async function trackReactionXp(
  settings: { leveling?: Partial<ILeveling> | null },
  guildId: string,
  actorId: string,
  messageAuthorId: string,
  opts: { channelId?: string | null; memberRoleIds?: readonly string[] },
): Promise<{ actor?: LevelUpResult | null; author?: LevelUpResult | null }> {
  const leveling = getLevelingConfig(settings);
  if (!leveling.enabled || !leveling.reactionXp.enabled) return {};
  if (!canEarnXp(leveling, opts)) return {};

  const amount = randomInRange(leveling.reactionXp.min, leveling.reactionXp.max);
  const awards = leveling.reactionXp.awards;
  const out: { actor?: LevelUpResult | null; author?: LevelUpResult | null } = {};

  if ((awards === 'both' || awards === 'receive') && messageAuthorId && messageAuthorId !== actorId) {
    const key = cooldownKey(guildId, messageAuthorId, 'reaction-recv');
    if (checkCooldown(key, leveling.reactionXp.cooldownSeconds)) {
      out.author = await awardXp(guildId, messageAuthorId, amount, leveling, false);
    }
  }

  if (awards === 'both' || awards === 'send') {
    const key = cooldownKey(guildId, actorId, 'reaction-send');
    if (checkCooldown(key, leveling.reactionXp.cooldownSeconds)) {
      out.actor = await awardXp(guildId, actorId, amount, leveling, false);
    }
  }

  return out;
}

interface VoiceSession {
  guildId: string;
  channelId: string;
  lastAwardAt: number;
  selfMute: boolean;
  selfDeaf: boolean;
  serverMute: boolean;
  serverDeaf: boolean;
}

const voiceSessions = new Map<string, VoiceSession>();

export function updateVoiceSession(
  guildId: string,
  userId: string,
  data: {
    channelId: string | null;
    selfMute?: boolean;
    selfDeaf?: boolean;
    serverMute?: boolean;
    serverDeaf?: boolean;
  },
): void {
  if (!data.channelId) {
    voiceSessions.delete(userId);
    return;
  }
  const existing = voiceSessions.get(userId);
  voiceSessions.set(userId, {
    guildId,
    channelId: data.channelId,
    lastAwardAt: existing?.lastAwardAt ?? 0,
    selfMute: !!data.selfMute,
    selfDeaf: !!data.selfDeaf,
    serverMute: !!data.serverMute,
    serverDeaf: !!data.serverDeaf,
  });
}

function countChannelMembers(guildId: string, channelId: string): number {
  let count = 0;
  for (const session of voiceSessions.values()) {
    if (session.guildId === guildId && session.channelId === channelId) count++;
  }
  return count;
}

function isAfk(session: VoiceSession, antiAfk: boolean): boolean {
  if (!antiAfk) return false;
  return session.selfMute && session.selfDeaf;
}

export async function tickVoiceXp(
  client: Client,
  settingsByGuild: Map<string, { leveling?: Partial<ILeveling> | null }>,
): Promise<void> {
  const now = Date.now();
  for (const [userId, session] of voiceSessions) {
    const settings = settingsByGuild.get(session.guildId);
    const leveling = getLevelingConfig(settings ?? null);
    if (!leveling.enabled || !leveling.voiceXp.enabled) continue;
    if (isAfk(session, leveling.voiceXp.antiAfk)) continue;

    const members = countChannelMembers(session.guildId, session.channelId);
    if (members < leveling.voiceXp.minimumMembers) continue;

    const elapsed = (now - session.lastAwardAt) / 1000;
    if (session.lastAwardAt && elapsed < leveling.voiceXp.cooldownSeconds) continue;

    session.lastAwardAt = now;
    const amount = randomInRange(leveling.voiceXp.min, leveling.voiceXp.max);
    const result = await awardXp(session.guildId, userId, amount, leveling, false);
    if (!result?.leveledUp) continue;

    const guild = client.guilds?.get(session.guildId);
    if (!guild) continue;

    const { handleLevelUp } = await import('./levelUpHandler');
    await handleLevelUp(client, guild, userId, result, leveling, null).catch(() => {});
  }
}

export { getLevelingConfig, canEarnXp } from './restrictions';
export { applyLevelRoles, renderLevelUpMessage, resolveLevelUpChannelId } from './levelUp';
export { xpForLevel, totalXpForLevel, levelFromXp } from './formula';
export { generateRankCard } from './rankCard';
