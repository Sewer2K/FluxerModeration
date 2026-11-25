import { isArray } from '@/utils/isArray';
import { normalizeLeaderboardVanity } from '@/utils/leveling/leaderboardVanity';

export type XpCurve = 'linear' | 'quadratic';
export type MessageXpMode = 'random' | 'per_word';
export type ReactionXpAwards = 'both' | 'send' | 'receive';
export type LevelUpChannelMode = 'message' | 'specific';
export type NoXpChannelMode = 'blacklist' | 'whitelist';

export interface ILevelRole {
  level: number;
  roleId: string;
}

export interface ILevelingFormula {
  curve: XpCurve;
  multiplier: number;
  maxLevel: number | null;
}

export interface IMessageXpQualitySettings {
  enabled: boolean;
  minCharacters: number;
  minWords: number;
  minUniqueCharacters: number;
  ignoreCommands: boolean;
  ignoreOnlyEmojis: boolean;
  ignoreOnlyAttachments: boolean;
  duplicateWindowSeconds: number;
  maxDuplicateMatches: number;
  burstWindowSeconds: number;
  burstMaxMessages: number;
  maxWordsCounted: number;
}

export const DEFAULT_MESSAGE_XP_QUALITY: IMessageXpQualitySettings = {
  enabled: true,
  minCharacters: 12,
  minWords: 2,
  minUniqueCharacters: 4,
  ignoreCommands: true,
  ignoreOnlyEmojis: true,
  ignoreOnlyAttachments: true,
  duplicateWindowSeconds: 300,
  maxDuplicateMatches: 2,
  burstWindowSeconds: 20,
  burstMaxMessages: 4,
  maxWordsCounted: 25,
};

export interface IMessageXpSettings {
  enabled: boolean;
  mode: MessageXpMode;
  min: number;
  max: number;
  cooldownSeconds: number;
  quality: IMessageXpQualitySettings;
}

export interface IVoiceXpSettings {
  enabled: boolean;
  min: number;
  max: number;
  cooldownSeconds: number;
  minimumMembers: number;
  antiAfk: boolean;
}

export interface IReactionXpSettings {
  enabled: boolean;
  awards: ReactionXpAwards;
  min: number;
  max: number;
  cooldownSeconds: number;
}

export interface ILevelUpMessageSettings {
  enabled: boolean;
  template: string;
  channelMode: LevelUpChannelMode;
  channelId: string | null;
  includeImage: boolean;
}

export interface IRankCardSettings {
  progressColor: string;
  backgroundColor: string;
  fontColor: string;
  opacity: number;
}

export interface ILevelingHighlights {
  weeklyEnabled: boolean;
  weeklyChannelId: string | null;
  monthlyEnabled: boolean;
  monthlyChannelId: string | null;
}

export interface ILevelingRestrictions {
  noXpChannelMode: NoXpChannelMode;
  noXpChannels: string[];
  noXpRoles: string[];
  textInVoiceXp: boolean;
}

export interface ILevelingManagement {
  rankCommandOwnerOnly: boolean;
  resetOwnerOnly: boolean;
  resetOnLeave: boolean;
}

export interface ILeveling {
  enabled: boolean;
  leaderboardVanity: string | null;
  formula: ILevelingFormula;
  messageXp: IMessageXpSettings;
  voiceXp: IVoiceXpSettings;
  reactionXp: IReactionXpSettings;
  levelUp: ILevelUpMessageSettings;
  levelRoles: ILevelRole[];
  stackRewards: boolean;
  firstPlaceRoleId: string | null;
  highlights: ILevelingHighlights;
  rankCard: IRankCardSettings;
  restrictions: ILevelingRestrictions;
  management: ILevelingManagement;
}

export const DEFAULT_LEVELING: ILeveling = {
  enabled: false,
  leaderboardVanity: null,
  formula: { curve: 'quadratic', multiplier: 1, maxLevel: null },
  messageXp: {
    enabled: true,
    mode: 'random',
    min: 15,
    max: 25,
    cooldownSeconds: 60,
    quality: { ...DEFAULT_MESSAGE_XP_QUALITY },
  },
  voiceXp: { enabled: false, min: 15, max: 40, cooldownSeconds: 180, minimumMembers: 2, antiAfk: false },
  reactionXp: { enabled: false, awards: 'both', min: 25, max: 25, cooldownSeconds: 300 },
  levelUp: {
    enabled: true,
    template: '{user.mention} has reached level **{user.level}**. GG!',
    channelMode: 'message',
    channelId: null,
    includeImage: false,
  },
  levelRoles: [],
  stackRewards: true,
  firstPlaceRoleId: null,
  highlights: {
    weeklyEnabled: false,
    weeklyChannelId: null,
    monthlyEnabled: false,
    monthlyChannelId: null,
  },
  rankCard: {
    progressColor: '#6c72f8',
    backgroundColor: '#1a1a2e',
    fontColor: '#ffffff',
    opacity: 100,
  },
  restrictions: {
    noXpChannelMode: 'blacklist',
    noXpChannels: [],
    noXpRoles: [],
    textInVoiceXp: true,
  },
  management: {
    rankCommandOwnerOnly: false,
    resetOwnerOnly: false,
    resetOnLeave: false,
  },
};

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function asStringArray(v: unknown): string[] {
  if (!isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string' && x.length > 0);
}

export function normalizeLevelingSettings(
  raw?: (Partial<ILeveling> & { announceLevelUp?: boolean; levelUpChannelId?: string | null }) | null,
): ILeveling {
  const r = raw ?? {};
  const legacyAnnounce = typeof r.announceLevelUp === 'boolean' ? r.announceLevelUp : undefined;
  const legacyChannelId =
    typeof r.levelUpChannelId === 'string' || r.levelUpChannelId === null ? r.levelUpChannelId : undefined;

  const formula = { ...DEFAULT_LEVELING.formula, ...(r.formula ?? {}) };
  formula.multiplier = clamp(Number(formula.multiplier) || 1, 0.1, 10);
  if (formula.maxLevel !== null && formula.maxLevel !== undefined) {
    const ml = Number(formula.maxLevel);
    formula.maxLevel = Number.isFinite(ml) && ml > 0 ? Math.floor(clamp(ml, 1, 1000)) : null;
  } else {
    formula.maxLevel = null;
  }
  if (formula.curve !== 'linear' && formula.curve !== 'quadratic') formula.curve = 'quadratic';

  const messageXp = { ...DEFAULT_LEVELING.messageXp, ...(r.messageXp ?? {}) };
  messageXp.min = clamp(Math.floor(Number(messageXp.min) || 15), 1, 500);
  messageXp.max = clamp(Math.floor(Number(messageXp.max) || 25), messageXp.min, 500);
  messageXp.cooldownSeconds = clamp(Math.floor(Number(messageXp.cooldownSeconds) || 60), 5, 3600);
  if (messageXp.mode !== 'random' && messageXp.mode !== 'per_word') messageXp.mode = 'random';

  const quality = { ...DEFAULT_MESSAGE_XP_QUALITY, ...(messageXp.quality ?? {}) };
  quality.enabled = quality.enabled !== false;
  quality.minCharacters = clamp(Math.floor(Number(quality.minCharacters) || 12), 0, 500);
  quality.minWords = clamp(Math.floor(Number(quality.minWords) || 2), 0, 50);
  quality.minUniqueCharacters = clamp(Math.floor(Number(quality.minUniqueCharacters) || 4), 1, 50);
  quality.ignoreCommands = quality.ignoreCommands !== false;
  quality.ignoreOnlyEmojis = quality.ignoreOnlyEmojis !== false;
  quality.ignoreOnlyAttachments = quality.ignoreOnlyAttachments !== false;
  quality.duplicateWindowSeconds = clamp(Math.floor(Number(quality.duplicateWindowSeconds) || 300), 30, 3600);
  quality.maxDuplicateMatches = clamp(Math.floor(Number(quality.maxDuplicateMatches) || 2), 1, 20);
  quality.burstWindowSeconds = clamp(Math.floor(Number(quality.burstWindowSeconds) || 20), 5, 120);
  quality.burstMaxMessages = clamp(Math.floor(Number(quality.burstMaxMessages) || 4), 2, 20);
  quality.maxWordsCounted = clamp(Math.floor(Number(quality.maxWordsCounted) || 25), 1, 200);
  messageXp.quality = quality;

  const voiceXp = { ...DEFAULT_LEVELING.voiceXp, ...(r.voiceXp ?? {}) };
  voiceXp.min = clamp(Math.floor(Number(voiceXp.min) || 15), 1, 500);
  voiceXp.max = clamp(Math.floor(Number(voiceXp.max) || 40), voiceXp.min, 500);
  voiceXp.cooldownSeconds = clamp(Math.floor(Number(voiceXp.cooldownSeconds) || 180), 30, 3600);
  voiceXp.minimumMembers = clamp(Math.floor(Number(voiceXp.minimumMembers) || 2), 1, 99);

  const reactionXp = { ...DEFAULT_LEVELING.reactionXp, ...(r.reactionXp ?? {}) };
  reactionXp.min = clamp(Math.floor(Number(reactionXp.min) || 25), 1, 500);
  reactionXp.max = clamp(Math.floor(Number(reactionXp.max) || 25), reactionXp.min, 500);
  reactionXp.cooldownSeconds = clamp(Math.floor(Number(reactionXp.cooldownSeconds) || 300), 5, 3600);
  if (!['both', 'send', 'receive'].includes(reactionXp.awards)) reactionXp.awards = 'both';

  const levelUp = { ...DEFAULT_LEVELING.levelUp, ...(r.levelUp ?? {}) };
  if (legacyAnnounce !== undefined) levelUp.enabled = legacyAnnounce;
  if (legacyChannelId !== undefined) {
    levelUp.channelId = legacyChannelId;
    if (legacyChannelId) levelUp.channelMode = 'specific';
  }
  if (typeof levelUp.template !== 'string' || !levelUp.template.trim()) {
    levelUp.template = DEFAULT_LEVELING.levelUp.template;
  }
  if (levelUp.channelMode !== 'message' && levelUp.channelMode !== 'specific') {
    levelUp.channelMode = levelUp.channelId ? 'specific' : 'message';
  }

  const rankCard = { ...DEFAULT_LEVELING.rankCard, ...(r.rankCard ?? {}) };
  rankCard.opacity = clamp(Math.floor(Number(rankCard.opacity) || 100), 0, 100);
  delete (rankCard as Record<string, unknown>).backgroundImageUrl;

  const highlights = { ...DEFAULT_LEVELING.highlights, ...(r.highlights ?? {}) };
  const restrictions = { ...DEFAULT_LEVELING.restrictions, ...(r.restrictions ?? {}) };
  restrictions.noXpChannels = asStringArray(restrictions.noXpChannels);
  restrictions.noXpRoles = asStringArray(restrictions.noXpRoles);
  if (restrictions.noXpChannelMode !== 'blacklist' && restrictions.noXpChannelMode !== 'whitelist') {
    restrictions.noXpChannelMode = 'blacklist';
  }

  const management = { ...DEFAULT_LEVELING.management, ...(r.management ?? {}) };

  const leaderboardVanity =
    'leaderboardVanity' in r ? normalizeLeaderboardVanity(r.leaderboardVanity) : DEFAULT_LEVELING.leaderboardVanity;

  const levelRoles = isArray(r.levelRoles)
    ? r.levelRoles
        .filter((e) => e && typeof e.roleId === 'string' && typeof e.level === 'number')
        .map((e) => ({
          level: clamp(Math.floor(e.level), 1, 1000),
          roleId: e.roleId,
        }))
        .slice(0, 15)
    : [];

  return {
    enabled: !!r.enabled,
    leaderboardVanity,
    formula,
    messageXp,
    voiceXp,
    reactionXp,
    levelUp,
    levelRoles,
    stackRewards: r.stackRewards !== false,
    firstPlaceRoleId: typeof r.firstPlaceRoleId === 'string' ? r.firstPlaceRoleId : null,
    highlights,
    rankCard,
    restrictions,
    management,
  };
}
