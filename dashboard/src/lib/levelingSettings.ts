import type { LevelingSettings, MessageXpQualitySettings } from './api';

export const DEFAULT_MESSAGE_XP_QUALITY: MessageXpQualitySettings = {
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

export const MESSAGE_XP_QUALITY_PRESETS: Record<'relaxed' | 'balanced' | 'strict', MessageXpQualitySettings> = {
  relaxed: {
    ...DEFAULT_MESSAGE_XP_QUALITY,
    minCharacters: 5,
    minWords: 1,
    minUniqueCharacters: 3,
    maxDuplicateMatches: 3,
    burstMaxMessages: 6,
  },
  balanced: { ...DEFAULT_MESSAGE_XP_QUALITY },
  strict: {
    ...DEFAULT_MESSAGE_XP_QUALITY,
    minCharacters: 20,
    minWords: 3,
    minUniqueCharacters: 6,
    maxDuplicateMatches: 1,
    burstWindowSeconds: 30,
    burstMaxMessages: 3,
  },
};

export const DEFAULT_LEVELING: LevelingSettings = {
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

export function normalizeLeveling(raw?: Partial<LevelingSettings> | null): LevelingSettings {
  const r = raw ?? {};
  const merged = {
    ...DEFAULT_LEVELING,
    ...r,
    formula: { ...DEFAULT_LEVELING.formula, ...(r.formula ?? {}) },
    messageXp: {
      ...DEFAULT_LEVELING.messageXp,
      ...(r.messageXp ?? {}),
      quality: { ...DEFAULT_MESSAGE_XP_QUALITY, ...(r.messageXp?.quality ?? {}) },
    },
    voiceXp: { ...DEFAULT_LEVELING.voiceXp, ...(r.voiceXp ?? {}) },
    reactionXp: { ...DEFAULT_LEVELING.reactionXp, ...(r.reactionXp ?? {}) },
    levelUp: { ...DEFAULT_LEVELING.levelUp, ...(r.levelUp ?? {}) },
    highlights: { ...DEFAULT_LEVELING.highlights, ...(r.highlights ?? {}) },
    rankCard: (() => {
      const merged = { ...DEFAULT_LEVELING.rankCard, ...(r.rankCard ?? {}) } as Record<string, unknown>;
      delete merged.backgroundImageUrl;
      return merged as LevelingSettings['rankCard'];
    })(),
    restrictions: { ...DEFAULT_LEVELING.restrictions, ...(r.restrictions ?? {}) },
    management: { ...DEFAULT_LEVELING.management, ...(r.management ?? {}) },
    levelRoles: Array.isArray(r.levelRoles) ? r.levelRoles : [],
  };

  merged.messageXp.min = Math.min(merged.messageXp.min, merged.messageXp.max);
  merged.voiceXp.min = Math.min(merged.voiceXp.min, merged.voiceXp.max);
  merged.reactionXp.min = Math.min(merged.reactionXp.min, merged.reactionXp.max);

  return merged;
}

export function buildLevelingSavePayload(leveling: LevelingSettings): { leveling: LevelingSettings } {
  const lv = normalizeLeveling(leveling);
  lv.levelRoles = lv.levelRoles
    .filter((e) => e.roleId && e.level >= 1)
    .map((e) => ({ level: Math.min(1000, Math.max(1, Math.floor(e.level))), roleId: e.roleId }))
    .slice(0, 15);
  lv.restrictions.noXpChannels = lv.restrictions.noXpChannels.filter(Boolean).slice(0, 50);
  lv.restrictions.noXpRoles = lv.restrictions.noXpRoles.filter(Boolean).slice(0, 25);
  return { leveling: lv };
}
