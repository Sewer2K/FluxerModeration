import {
  RSS_DEFAULT_POLL_INTERVAL_MINUTES,
  RSS_MAX_FEEDS_PER_GUILD,
  RSS_MAX_ITEMS_PER_POLL,
  RSS_MIN_POLL_INTERVAL_MINUTES,
} from '@/utils/rssDefaults';
import { validateLeaderboardVanityFormat } from '@/utils/leveling/leaderboardVanity';
import { KEYWORD_MAX_PER_GUILD } from '@/utils/keywordDefaults';
import { t } from '@/i18n';
import { isArray } from '@/utils/isArray';

const SNOWFLAKE_RE = /^\d{17,20}$/;
const MAX_STRING_LENGTH = 2000;
const MAX_ARRAY_LENGTH = 100;
const MAX_OBJECT_DEPTH = 5;
const CUSTOM_COMMAND_MAX_PER_GUILD = 15;
const CUSTOM_COMMAND_NAME_RE = /^[a-z0-9_-]{1,32}$/;
const CUSTOM_COMMAND_COLOR_RE = /^#?[0-9a-fA-F]{6}$/;
const WELCOME_CARD_COLOR_RE = /^#?(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const CUSTOM_COMMAND_PERMISSION_VALUES = new Set([
  'Administrator',
  'ManageGuild',
  'ManageRoles',
  'ManageChannels',
  'ManageMessages',
  'KickMembers',
  'BanMembers',
  'ModerateMembers',
]);
const CUSTOM_COMMAND_ACTION_VALUES = new Set(['reply', 'toggleRole', 'addRole', 'removeRole', 'sendDM']);
const WELCOME_MESSAGE_TYPES = new Set(['none', 'preset', 'custom']);
const WELCOME_TRIGGERS = new Set(['join', 'role']);
const WELCOME_CARD_PRESETS = new Set(['default', 'dark', 'light', 'ocean', 'sunset', 'midnight', 'forest']);

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function validatorT(key: string, vars?: Record<string, string | number>): string {
  return t('en', `auditCatalog.api.middleware.settingsValidator.${key}`, vars);
}

const validation = {
  mustBeObject: (field: string) => validatorT('mustBeObject', { field }),
  mustBeBoolean: (field: string) => validatorT('mustBeBoolean', { field }),
  mustBeArray: (field: string) => validatorT('mustBeArray', { field }),
  mustBeString: (field: string) => validatorT('mustBeString', { field }),
  mustBeValidLocaleCode: (field: string) => validatorT('mustBeValidLocaleCode', { field }),
  mustBeValidChannelId: (field: string) => validatorT('mustBeValidChannelId', { field }),
  mustBeValidRoleId: (field: string) => validatorT('mustBeValidRoleId', { field }),
  mustBeValidWebhookId: (field: string) => validatorT('mustBeValidWebhookId', { field }),
  mustBeValidMessageId: (field: string) => validatorT('mustBeValidMessageId', { field }),
  mustBeValidId: (field: string) => validatorT('mustBeValidId', { field }),
  maxAllowed: (label: string, max: number) => validatorT('maxAllowed', { label, max }),
  customCommandsMaxAllowed: (max: number) => validatorT('customCommandsMaxAllowed', { max }),
  eachStringLengthRange: (label: string, min: number, max: number) =>
    validatorT('eachStringLengthRange', { label, min, max }),
  mustBeRange: (field: string, min: number, max: number) => validatorT('mustBeRange', { field, min, max }),
  mustBeUnderCharacters: (field: string, max: number) => validatorT('mustBeUnderCharacters', { field, max }),
  mustBeArrayOfUpTo: (field: string, max: number, itemType: string) =>
    validatorT('mustBeArrayOfUpTo', { field, max, itemType }),
  mustBeOneOf: (field: string, options: string) => validatorT('mustBeOneOf', { field, options }),
  mustBeHttpUrl: (field: string) => validatorT('mustBeHttpUrl', { field }),
  mustStartWithSlash: (field: string, context: string) => validatorT('mustStartWithSlash', { field, context }),
  eachItemMustBeObject: (label: string) => validatorT('eachItemMustBeObject', { label }),
  eachItemUnderCharacters: (label: string, max: number) => validatorT('eachItemUnderCharacters', { label, max }),
  mustBeNonEmptyString: (field: string) => validatorT('mustBeNonEmptyString', { field }),
  mustBeNonEmptyStringUnder: (field: string, max: number) => validatorT('mustBeNonEmptyStringUnder', { field, max }),
  mustBeValidHexColor: (field: string) => validatorT('mustBeValidHexColor', { field }),
  mustBeUnique: (field: string) => validatorT('mustBeUnique', { field }),
  customCommandNamesMustBeUnique: () => validatorT('customCommandNamesMustBeUnique'),
  isInvalid: (field: string) => validatorT('isInvalid', { field }),
  isRequiredForAction: (field: string, action: string) => validatorT('isRequiredForAction', { field, action }),
  canContainAtMost: (field: string, max: number, itemType: string) =>
    validatorT('canContainAtMost', { field, max, itemType }),
  keyTooLong: (field: string) => validatorT('keyTooLong', { field }),
  customCommandNameInvalid: () => validatorT('customCommandNameInvalid'),
};

function deepSanitize(value: unknown, depth = 0): unknown {
  if (depth > MAX_OBJECT_DEPTH) return undefined;

  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    if (value.length > MAX_STRING_LENGTH) return value.slice(0, MAX_STRING_LENGTH);
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') return value;

  if (isArray(value)) {
    if (value.length > MAX_ARRAY_LENGTH) {
      value = value.slice(0, MAX_ARRAY_LENGTH);
    }
    return (value as unknown[])
      .map((item: unknown) => deepSanitize(item, depth + 1))
      .filter((v: unknown) => v !== undefined);
  }

  if (typeof value === 'object') {
    const clean: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>)) {
      if (DANGEROUS_KEYS.has(key)) continue;
      if (key.startsWith('$')) continue;

      const sanitized = deepSanitize((value as Record<string, unknown>)[key], depth + 1);
      if (sanitized !== undefined) {
        clean[key] = sanitized;
      }
    }
    return clean;
  }

  return undefined;
}

function isSnowflake(v: unknown): v is string {
  return typeof v === 'string' && SNOWFLAKE_RE.test(v);
}

function isSnowflakeOrNull(v: unknown): boolean {
  return v === null || v === '' || isSnowflake(v);
}

function isSnowflakeArray(v: unknown, maxLen = 50): boolean {
  if (!isArray(v)) return false;
  if (v.length > maxLen) return false;
  return v.every(isSnowflake);
}

function isBoundedString(v: unknown, maxLen = 200): v is string {
  return typeof v === 'string' && v.length <= maxLen;
}

function isBoundedInt(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
}

function isHttpUrl(v: unknown): v is string {
  if (typeof v !== 'string' || v.trim().length === 0) return false;
  try {
    const parsed = new URL(v.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !isArray(v);
}

function emptyToNull(v: unknown): unknown {
  return v === '' ? null : v;
}

function normalizeHexColor(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'string' || !CUSTOM_COMMAND_COLOR_RE.test(v)) return null;
  return v.startsWith('#') ? v : `#${v}`;
}

function normalizeWelcomeCardHexColor(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'string' || !WELCOME_CARD_COLOR_RE.test(v)) return null;
  return v.startsWith('#') ? v : `#${v}`;
}

function normalizeWelcomeCardPreset(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'string' || !WELCOME_CARD_PRESETS.has(v)) return null;
  return v;
}

function normalizeWelcomeBgImageUrl(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  if (!trimmed || trimmed.startsWith('data:')) return null;
  if (trimmed.startsWith('/uploads/'))
    return trimmed.length <= MAX_STRING_LENGTH ? trimmed : trimmed.slice(0, MAX_STRING_LENGTH);
  return isHttpUrl(trimmed) ? trimmed : null;
}

function sanitizeWelcomeCard(card: Record<string, unknown>): true | string {
  card.preset = normalizeWelcomeCardPreset(card.preset);
  card.bgColor1 = normalizeWelcomeCardHexColor(card.bgColor1);
  card.bgColor2 = normalizeWelcomeCardHexColor(card.bgColor2);
  card.bgColor3 = normalizeWelcomeCardHexColor(card.bgColor3);
  card.accentColor = normalizeWelcomeCardHexColor(card.accentColor);
  card.textColor = normalizeWelcomeCardHexColor(card.textColor);
  card.subtextColor = normalizeWelcomeCardHexColor(card.subtextColor);
  card.countColor = normalizeWelcomeCardHexColor(card.countColor);

  if (card.greetingText !== undefined) {
    card.greetingText = emptyToNull(card.greetingText);
    if (card.greetingText !== null && !isBoundedString(card.greetingText, 30)) {
      return validation.mustBeUnderCharacters('welcomeMessage.card.greetingText', 30);
    }
  }

  if (card.subtitle !== undefined) {
    card.subtitle = emptyToNull(card.subtitle);
    if (card.subtitle !== null && !isBoundedString(card.subtitle, 50)) {
      return validation.mustBeUnderCharacters('welcomeMessage.card.subtitle', 50);
    }
  }

  if (card.showMemberCount !== undefined && typeof card.showMemberCount !== 'boolean') {
    return validation.mustBeBoolean('welcomeMessage.card.showMemberCount');
  }

  if (card.bgImageURL !== undefined) {
    card.bgImageURL = normalizeWelcomeBgImageUrl(card.bgImageURL);
  }

  return true;
}

function sanitizeWelcomeEmbed(embed: Record<string, unknown>): true | string {
  if (embed.enabled !== undefined && typeof embed.enabled !== 'boolean') {
    return validation.mustBeBoolean('welcomeMessage.embed.enabled');
  }

  for (const field of ['title', 'description', 'footer'] as const) {
    if (embed[field] === undefined) continue;
    embed[field] = emptyToNull(embed[field]);
    if (embed[field] !== null && !isBoundedString(embed[field], 256)) {
      return validation.mustBeUnderCharacters(`welcomeMessage.embed.${field}`, 256);
    }
  }

  if (embed.color !== undefined) {
    embed.color = normalizeHexColor(embed.color);
  }

  if (embed.thumbnail !== undefined && typeof embed.thumbnail !== 'boolean') {
    return validation.mustBeBoolean('welcomeMessage.embed.thumbnail');
  }

  return true;
}

function sanitizeWelcomeDm(dm: Record<string, unknown>): true | string {
  if (dm.enabled !== undefined && typeof dm.enabled !== 'boolean') {
    return validation.mustBeBoolean('welcomeMessage.dm.enabled');
  }
  if (dm.imageEnabled !== undefined && typeof dm.imageEnabled !== 'boolean') {
    return validation.mustBeBoolean('welcomeMessage.dm.imageEnabled');
  }
  if (dm.message !== undefined) {
    dm.message = emptyToNull(dm.message);
    if (dm.message !== null && !isBoundedString(dm.message, 2000)) {
      return validation.mustBeUnderCharacters('welcomeMessage.dm.message', 2000);
    }
  }
  return true;
}

function validateStarboardEntry(value: unknown): true | string {
  if (typeof value !== 'object' || value === null || isArray(value)) return validation.mustBeObject('starboard');
  const sb = value as Record<string, unknown>;
  if (sb.enabled !== undefined && typeof sb.enabled !== 'boolean') return validation.mustBeBoolean('starboard.enabled');
  if (sb.channelId !== undefined && !isSnowflakeOrNull(sb.channelId))
    return validation.mustBeValidChannelId('starboard.channelId');
  if (sb.threshold !== undefined && !isBoundedInt(sb.threshold, 1, 100))
    return validation.mustBeRange('starboard.threshold', 1, 100);
  if (sb.emoji !== undefined && !isBoundedString(sb.emoji, 64))
    return validation.mustBeUnderCharacters('starboard.emoji', 64);
  if (sb.selfStarEnabled !== undefined && typeof sb.selfStarEnabled !== 'boolean')
    return validation.mustBeBoolean('starboard.selfStarEnabled');
  if (sb.ignoreBots !== undefined && typeof sb.ignoreBots !== 'boolean')
    return validation.mustBeBoolean('starboard.ignoreBots');
  if (sb.ignoredChannels !== undefined && !isSnowflakeArray(sb.ignoredChannels, 50))
    return validation.mustBeArrayOfUpTo('starboard.ignoredChannels', 50, 'channel IDs');
  if (sb.ignoredRoles !== undefined && !isSnowflakeArray(sb.ignoredRoles, 50))
    return validation.mustBeArrayOfUpTo('starboard.ignoredRoles', 50, 'role IDs');
  return true;
}

function validateRssFeedEntry(value: unknown): true | string {
  if (typeof value !== 'object' || value === null || isArray(value)) {
    return validation.eachItemMustBeObject('rss.feeds entries');
  }

  const feed = value as Record<string, unknown>;

  if (feed.id !== undefined && !isBoundedString(feed.id, 128)) {
    return validation.mustBeUnderCharacters('rss.feeds[].id', 128);
  }

  if (feed.name !== undefined && feed.name !== null && !isBoundedString(feed.name, 120)) {
    return validation.mustBeUnderCharacters('rss.feeds[].name', 120);
  }

  if (feed.sourceType !== undefined && feed.sourceType !== 'rss' && feed.sourceType !== 'rsshub') {
    return validation.mustBeOneOf('rss.feeds[].sourceType', 'rss or rsshub');
  }

  const sourceType = (feed.sourceType === 'rsshub' ? 'rsshub' : 'rss') as 'rss' | 'rsshub';
  if (sourceType === 'rss') {
    if (!isHttpUrl(feed.url)) {
      return validation.mustBeHttpUrl('rss.feeds[].url');
    }
  } else {
    if (!isBoundedString(feed.route, 500) || !(feed.route as string).startsWith('/')) {
      return validation.mustStartWithSlash('rss.feeds[].route', 'rsshub sources');
    }
  }

  if (!isSnowflake(feed.channelId)) {
    return validation.mustBeValidChannelId('rss.feeds[].channelId');
  }

  if (feed.mentionRoleId !== undefined && !isSnowflakeOrNull(feed.mentionRoleId)) {
    return validation.mustBeValidRoleId('rss.feeds[].mentionRoleId');
  }

  if (feed.webhookId !== undefined && !isSnowflakeOrNull(feed.webhookId)) {
    return validation.mustBeValidWebhookId('rss.feeds[].webhookId');
  }

  if (feed.webhookToken !== undefined && feed.webhookToken !== null && !isBoundedString(feed.webhookToken, 300)) {
    return validation.mustBeUnderCharacters('rss.feeds[].webhookToken', 300);
  }

  if (feed.webhookName !== undefined && feed.webhookName !== null && !isBoundedString(feed.webhookName, 80)) {
    return validation.mustBeUnderCharacters('rss.feeds[].webhookName', 80);
  }

  if (feed.enabled !== undefined && typeof feed.enabled !== 'boolean') {
    return validation.mustBeBoolean('rss.feeds[].enabled');
  }

  if (feed.maxItemsPerPoll !== undefined && !isBoundedInt(feed.maxItemsPerPoll, 1, RSS_MAX_ITEMS_PER_POLL)) {
    return validation.mustBeRange('rss.feeds[].maxItemsPerPoll', 1, RSS_MAX_ITEMS_PER_POLL);
  }

  if (feed.includeSummary !== undefined && typeof feed.includeSummary !== 'boolean') {
    return validation.mustBeBoolean('rss.feeds[].includeSummary');
  }

  if (feed.includeImage !== undefined && typeof feed.includeImage !== 'boolean') {
    return validation.mustBeBoolean('rss.feeds[].includeImage');
  }

  if (feed.format !== undefined && feed.format !== 'embed' && feed.format !== 'text') {
    return validation.mustBeOneOf('rss.feeds[].format', 'embed or text');
  }

  return true;
}

function validateHoneypotEntry(value: unknown): true | string {
  if (!isPlainObject(value)) return validation.eachItemMustBeObject('honeypot channel');
  const entry = value;
  const actions = new Set(['ban', 'kick', 'timeout', 'role']);

  if (!isSnowflake(entry.channelId)) return validation.mustBeValidChannelId('honeypotChannels[].channelId');
  if (entry.action !== undefined && (typeof entry.action !== 'string' || !actions.has(entry.action))) {
    return validation.mustBeOneOf('honeypotChannels[].action', 'ban, kick, timeout, or role');
  }
  if (entry.enabled !== undefined && typeof entry.enabled !== 'boolean') {
    return validation.mustBeBoolean('honeypotChannels[].enabled');
  }
  if (entry.banDeleteDays !== undefined && !isBoundedInt(entry.banDeleteDays, 0, 7)) {
    return validation.mustBeRange('honeypotChannels[].banDeleteDays', 0, 7);
  }
  if (entry.timeoutHours !== undefined && !isBoundedInt(entry.timeoutHours, 1, 672)) {
    return validation.mustBeRange('honeypotChannels[].timeoutHours', 1, 672);
  }
  if (entry.roleId !== undefined && !isSnowflakeOrNull(entry.roleId)) {
    return validation.mustBeValidRoleId('honeypotChannels[].roleId');
  }

  return true;
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
  sanitized: Record<string, unknown>;
}

const fieldValidators: Record<string, (value: unknown) => true | string> = {
  language(v) {
    if (typeof v !== 'string') return validation.mustBeString('language');
    const code = v.trim();
    if (!/^[a-z]{2,3}(-[a-z0-9]{2,8})?$/i.test(code) || code.length > 20)
      return validation.mustBeValidLocaleCode('language');
    return true;
  },

  prefixes(v) {
    if (!isArray(v)) return validation.mustBeArray('prefixes');
    if (v.length > 10) return validation.maxAllowed('prefixes', 10);
    if (!v.every((p) => typeof p === 'string' && p.length > 0 && p.length <= 10)) {
      return validation.eachStringLengthRange('prefix', 1, 10);
    }
    return true;
  },

  prefix(v) {
    if (typeof v !== 'string') return validation.mustBeString('prefix');
    if (v.length < 1 || v.length > 10) return validation.mustBeRange('prefix length', 1, 10);
    return true;
  },

  logChannelId(v) {
    if (!isSnowflakeOrNull(v)) return validation.mustBeValidChannelId('logChannelId');
    return true;
  },

  serverLogChannelId(v) {
    if (!isSnowflakeOrNull(v)) return validation.mustBeValidChannelId('serverLogChannelId');
    return true;
  },

  muteRoleId(v) {
    if (!isSnowflakeOrNull(v)) return validation.mustBeValidRoleId('muteRoleId');
    return true;
  },

  autoroleId(v) {
    if (!isSnowflakeOrNull(v)) return validation.mustBeValidRoleId('autoroleId');
    return true;
  },

  staffChannelId(v) {
    if (!isSnowflakeOrNull(v)) return validation.mustBeValidChannelId('staffChannelId');
    return true;
  },

  staffRoleId(v) {
    if (!isSnowflakeOrNull(v)) return validation.mustBeValidRoleId('staffRoleId');
    return true;
  },

  staffInboxChannelId(v) {
    if (!isSnowflakeOrNull(v)) return validation.mustBeValidChannelId('staffInboxChannelId');
    return true;
  },

  honeypotAlertRoleId(v) {
    if (!isSnowflakeOrNull(v)) return validation.mustBeValidRoleId('honeypotAlertRoleId');
    return true;
  },

  ticketCategoryId(v) {
    if (!isSnowflakeOrNull(v)) return validation.mustBeValidId('ticketCategoryId');
    return true;
  },

  ticketSupportRoleId(v) {
    if (!isSnowflakeOrNull(v)) return validation.mustBeValidRoleId('ticketSupportRoleId');
    return true;
  },

  ticketLogChannelId(v) {
    if (!isSnowflakeOrNull(v)) return validation.mustBeValidChannelId('ticketLogChannelId');
    return true;
  },

  ticketSetupChannelId(v) {
    if (!isSnowflakeOrNull(v)) return validation.mustBeValidChannelId('ticketSetupChannelId');
    return true;
  },

  ticketSetupMessageId(v) {
    if (!isSnowflakeOrNull(v)) return validation.mustBeValidMessageId('ticketSetupMessageId');
    return true;
  },

  ticketMaxOpen(v) {
    if (!isBoundedInt(v, 1, 50)) return validation.mustBeRange('ticketMaxOpen', 1, 50);
    return true;
  },

  ticketOpenMessage(v) {
    if (v !== null && !isBoundedString(v, 1000)) return validation.mustBeUnderCharacters('ticketOpenMessage', 1000);
    return true;
  },

  ticketEmoji(v) {
    if (!isBoundedString(v, 64)) return validation.mustBeUnderCharacters('ticketEmoji', 64);
    return true;
  },

  ticketSupportRoleIds(v) {
    if (!isSnowflakeArray(v, 25)) return validation.mustBeArrayOfUpTo('ticketSupportRoleIds', 25, 'role IDs');
    return true;
  },

  blacklistedChannels(v) {
    if (!isSnowflakeArray(v, 50)) return validation.mustBeArrayOfUpTo('blacklistedChannels', 50, 'channel IDs');
    return true;
  },

  honeypotChannels(v) {
    if (!isArray(v)) return validation.mustBeArray('honeypotChannels');
    if (v.length > 20) return validation.maxAllowed('honeypot channels', 20);
    for (const entry of v) {
      const result = validateHoneypotEntry(entry);
      if (result !== true) return result;
    }
    return true;
  },

  lockdownRoles(v) {
    if (!isSnowflakeArray(v, 50)) return validation.mustBeArrayOfUpTo('lockdownRoles', 50, 'role IDs');
    return true;
  },

  lockdownAllowedRoles(v) {
    if (!isSnowflakeArray(v, 50)) return validation.mustBeArrayOfUpTo('lockdownAllowedRoles', 50, 'role IDs');
    return true;
  },

  lockdownAllowedUsers(v) {
    if (!isSnowflakeArray(v, 50)) return validation.mustBeArrayOfUpTo('lockdownAllowedUsers', 50, 'user IDs');
    return true;
  },

  slowmodeAllowedRoles(v) {
    if (!isSnowflakeArray(v, 50)) return validation.mustBeArrayOfUpTo('slowmodeAllowedRoles', 50, 'role IDs');
    return true;
  },

  commandAllowedRoles(v) {
    if (!isSnowflakeArray(v, 50)) return validation.mustBeArrayOfUpTo('commandAllowedRoles', 50, 'role IDs');
    return true;
  },

  disabledCommands(v) {
    if (!isArray(v)) return validation.mustBeArray('disabledCommands');
    if (v.length > 100) return validation.maxAllowed('disabled commands', 100);
    if (!v.every((c) => typeof c === 'string' && c.length <= 50)) {
      return validation.eachItemUnderCharacters('command name', 50);
    }
    return true;
  },

  globalBanEnabled(v) {
    if (typeof v !== 'boolean') return validation.mustBeBoolean('globalBanEnabled');
    return true;
  },

  globalBanAutoApply(v) {
    if (typeof v !== 'boolean') return validation.mustBeBoolean('globalBanAutoApply');
    return true;
  },

  automodEnabled(v) {
    if (typeof v !== 'boolean') return validation.mustBeBoolean('automodEnabled');
    return true;
  },

  raidDisableAutorole(v) {
    if (typeof v !== 'boolean') return validation.mustBeBoolean('raidDisableAutorole');
    return true;
  },

  reactionRoleDMEnabled(v) {
    if (typeof v !== 'boolean') return validation.mustBeBoolean('reactionRoleDMEnabled');
    return true;
  },

  onboardingComplete(v) {
    if (typeof v !== 'boolean') return validation.mustBeBoolean('onboardingComplete');
    return true;
  },

  onboardingStep(v) {
    if (!isBoundedInt(v, 0, 20)) return validation.mustBeRange('onboardingStep', 0, 20);
    return true;
  },

  starboard(v) {
    return validateStarboardEntry(v);
  },

  starboards(v) {
    if (!isArray(v)) return validation.mustBeArray('starboards');
    if (v.length > 3) return validation.maxAllowed('starboards', 3);
    for (const entry of v) {
      const res = validateStarboardEntry(entry);
      if (res !== true) return res;
    }
    return true;
  },

  leveling(v) {
    if (typeof v !== 'object' || v === null || isArray(v)) return validation.mustBeObject('leveling');
    const lv = v as Record<string, unknown>;
    if (lv.enabled !== undefined && typeof lv.enabled !== 'boolean')
      return validation.mustBeBoolean('leveling.enabled');
    if (lv.leaderboardVanity !== undefined) {
      if (lv.leaderboardVanity !== null && lv.leaderboardVanity !== '') {
        const vanityRes = validateLeaderboardVanityFormat(lv.leaderboardVanity);
        if (vanityRes !== true) return vanityRes;
      }
    }
    if (lv.stackRewards !== undefined && typeof lv.stackRewards !== 'boolean')
      return validation.mustBeBoolean('leveling.stackRewards');
    if (lv.firstPlaceRoleId !== undefined && !isSnowflakeOrNull(lv.firstPlaceRoleId))
      return validation.mustBeValidRoleId('leveling.firstPlaceRoleId');

    const validateXpRange = (prefix: string, block: unknown, requireMode = false) => {
      if (block === undefined) return true;
      if (typeof block !== 'object' || block === null || isArray(block)) return validation.mustBeObject(prefix);
      const b = block as Record<string, unknown>;
      if (b.enabled !== undefined && typeof b.enabled !== 'boolean')
        return validation.mustBeBoolean(`${prefix}.enabled`);
      if (requireMode && b.mode !== undefined && b.mode !== 'random' && b.mode !== 'per_word')
        return validation.mustBeOneOf(`${prefix}.mode`, 'random, per_word');
      if (b.awards !== undefined && !['both', 'send', 'receive'].includes(String(b.awards)))
        return validation.mustBeOneOf(`${prefix}.awards`, 'both, send, receive');
      if (b.min !== undefined && !isBoundedInt(b.min, 1, 500)) return validation.mustBeRange(`${prefix}.min`, 1, 500);
      if (b.max !== undefined && !isBoundedInt(b.max, 1, 500)) return validation.mustBeRange(`${prefix}.max`, 1, 500);
      if (b.cooldownSeconds !== undefined && !isBoundedInt(b.cooldownSeconds, 5, 3600))
        return validation.mustBeRange(`${prefix}.cooldownSeconds`, 5, 3600);
      if (b.minimumMembers !== undefined && !isBoundedInt(b.minimumMembers, 1, 99))
        return validation.mustBeRange(`${prefix}.minimumMembers`, 1, 99);
      if (b.antiAfk !== undefined && typeof b.antiAfk !== 'boolean')
        return validation.mustBeBoolean(`${prefix}.antiAfk`);
      return true;
    };

    if (lv.formula !== undefined) {
      if (typeof lv.formula !== 'object' || lv.formula === null) return validation.mustBeObject('leveling.formula');
      const f = lv.formula as Record<string, unknown>;
      if (f.curve !== undefined && f.curve !== 'linear' && f.curve !== 'quadratic')
        return validation.mustBeOneOf('leveling.formula.curve', 'linear, quadratic');
      if (f.multiplier !== undefined && (typeof f.multiplier !== 'number' || f.multiplier < 0.1 || f.multiplier > 10))
        return validation.mustBeRange('leveling.formula.multiplier', 0.1, 10);
      if (f.maxLevel !== undefined && f.maxLevel !== null && !isBoundedInt(f.maxLevel, 1, 1000))
        return validation.mustBeRange('leveling.formula.maxLevel', 1, 1000);
    }

    let res = validateXpRange('leveling.messageXp', lv.messageXp, true);
    if (res !== true) return res;
    if (lv.messageXp !== undefined && typeof lv.messageXp === 'object' && lv.messageXp !== null) {
      const mx = lv.messageXp as Record<string, unknown>;
      if (mx.quality !== undefined) {
        if (typeof mx.quality !== 'object' || mx.quality === null)
          return validation.mustBeObject('leveling.messageXp.quality');
        const q = mx.quality as Record<string, unknown>;
        if (q.enabled !== undefined && typeof q.enabled !== 'boolean')
          return validation.mustBeBoolean('leveling.messageXp.quality.enabled');
        if (q.minCharacters !== undefined && !isBoundedInt(q.minCharacters, 0, 500))
          return validation.mustBeRange('leveling.messageXp.quality.minCharacters', 0, 500);
        if (q.minWords !== undefined && !isBoundedInt(q.minWords, 0, 50))
          return validation.mustBeRange('leveling.messageXp.quality.minWords', 0, 50);
        if (q.minUniqueCharacters !== undefined && !isBoundedInt(q.minUniqueCharacters, 1, 50))
          return validation.mustBeRange('leveling.messageXp.quality.minUniqueCharacters', 1, 50);
        if (q.ignoreCommands !== undefined && typeof q.ignoreCommands !== 'boolean')
          return validation.mustBeBoolean('leveling.messageXp.quality.ignoreCommands');
        if (q.ignoreOnlyEmojis !== undefined && typeof q.ignoreOnlyEmojis !== 'boolean')
          return validation.mustBeBoolean('leveling.messageXp.quality.ignoreOnlyEmojis');
        if (q.ignoreOnlyAttachments !== undefined && typeof q.ignoreOnlyAttachments !== 'boolean')
          return validation.mustBeBoolean('leveling.messageXp.quality.ignoreOnlyAttachments');
        if (q.duplicateWindowSeconds !== undefined && !isBoundedInt(q.duplicateWindowSeconds, 30, 3600))
          return validation.mustBeRange('leveling.messageXp.quality.duplicateWindowSeconds', 30, 3600);
        if (q.maxDuplicateMatches !== undefined && !isBoundedInt(q.maxDuplicateMatches, 1, 20))
          return validation.mustBeRange('leveling.messageXp.quality.maxDuplicateMatches', 1, 20);
        if (q.burstWindowSeconds !== undefined && !isBoundedInt(q.burstWindowSeconds, 5, 120))
          return validation.mustBeRange('leveling.messageXp.quality.burstWindowSeconds', 5, 120);
        if (q.burstMaxMessages !== undefined && !isBoundedInt(q.burstMaxMessages, 2, 20))
          return validation.mustBeRange('leveling.messageXp.quality.burstMaxMessages', 2, 20);
        if (q.maxWordsCounted !== undefined && !isBoundedInt(q.maxWordsCounted, 1, 200))
          return validation.mustBeRange('leveling.messageXp.quality.maxWordsCounted', 1, 200);
      }
    }
    res = validateXpRange('leveling.voiceXp', lv.voiceXp);
    if (res !== true) return res;
    res = validateXpRange('leveling.reactionXp', lv.reactionXp);
    if (res !== true) return res;

    if (lv.levelUp !== undefined) {
      if (typeof lv.levelUp !== 'object' || lv.levelUp === null) return validation.mustBeObject('leveling.levelUp');
      const lu = lv.levelUp as Record<string, unknown>;
      if (lu.enabled !== undefined && typeof lu.enabled !== 'boolean')
        return validation.mustBeBoolean('leveling.levelUp.enabled');
      if (lu.includeImage !== undefined && typeof lu.includeImage !== 'boolean')
        return validation.mustBeBoolean('leveling.levelUp.includeImage');
      if (lu.channelMode !== undefined && lu.channelMode !== 'message' && lu.channelMode !== 'specific')
        return validation.mustBeOneOf('leveling.levelUp.channelMode', 'message, specific');
      if (lu.channelId !== undefined && !isSnowflakeOrNull(lu.channelId))
        return validation.mustBeValidChannelId('leveling.levelUp.channelId');
      if (lu.template !== undefined && lu.template !== null && !isBoundedString(lu.template, 2000))
        return validation.mustBeUnderCharacters('leveling.levelUp.template', 2000);
    }

    if (lv.rankCard !== undefined) {
      if (typeof lv.rankCard !== 'object' || lv.rankCard === null) return validation.mustBeObject('leveling.rankCard');
      const rc = lv.rankCard as Record<string, unknown>;
      if (rc.opacity !== undefined && !isBoundedInt(rc.opacity, 0, 100))
        return validation.mustBeRange('leveling.rankCard.opacity', 0, 100);
      if (rc.backgroundImageUrl !== undefined && rc.backgroundImageUrl !== null) {
        return 'Custom rank card backgrounds are not supported';
      }
    }

    const validateChannelList = (prefix: string, ids: unknown, max: number) => {
      if (ids === undefined) return true;
      if (!isArray(ids)) return validation.mustBeArray(prefix);
      if (ids.length > max) return validation.maxAllowed(prefix, max);
      for (const id of ids) {
        if (typeof id !== 'string' || !isSnowflakeOrNull(id) || id === null)
          return validation.mustBeValidChannelId(`${prefix}[]`);
      }
      return true;
    };

    if (lv.highlights !== undefined) {
      if (typeof lv.highlights !== 'object' || lv.highlights === null)
        return validation.mustBeObject('leveling.highlights');
      const h = lv.highlights as Record<string, unknown>;
      if (h.weeklyEnabled !== undefined && typeof h.weeklyEnabled !== 'boolean')
        return validation.mustBeBoolean('leveling.highlights.weeklyEnabled');
      if (h.monthlyEnabled !== undefined && typeof h.monthlyEnabled !== 'boolean')
        return validation.mustBeBoolean('leveling.highlights.monthlyEnabled');
      if (h.weeklyChannelId !== undefined && !isSnowflakeOrNull(h.weeklyChannelId))
        return validation.mustBeValidChannelId('leveling.highlights.weeklyChannelId');
      if (h.monthlyChannelId !== undefined && !isSnowflakeOrNull(h.monthlyChannelId))
        return validation.mustBeValidChannelId('leveling.highlights.monthlyChannelId');
    }

    if (lv.restrictions !== undefined) {
      if (typeof lv.restrictions !== 'object' || lv.restrictions === null)
        return validation.mustBeObject('leveling.restrictions');
      const r = lv.restrictions as Record<string, unknown>;
      if (r.noXpChannelMode !== undefined && r.noXpChannelMode !== 'blacklist' && r.noXpChannelMode !== 'whitelist')
        return validation.mustBeOneOf('leveling.restrictions.noXpChannelMode', 'blacklist, whitelist');
      res = validateChannelList('leveling.restrictions.noXpChannels', r.noXpChannels, 50);
      if (res !== true) return res;
      if (r.noXpRoles !== undefined) {
        if (!isArray(r.noXpRoles)) return validation.mustBeArray('leveling.restrictions.noXpRoles');
        if (r.noXpRoles.length > 25) return validation.maxAllowed('leveling.restrictions.noXpRoles', 25);
        for (const id of r.noXpRoles) {
          if (typeof id !== 'string' || !isSnowflakeOrNull(id) || id === null)
            return validation.mustBeValidRoleId('leveling.restrictions.noXpRoles[]');
        }
      }
      if (r.textInVoiceXp !== undefined && typeof r.textInVoiceXp !== 'boolean')
        return validation.mustBeBoolean('leveling.restrictions.textInVoiceXp');
    }

    if (lv.management !== undefined) {
      if (typeof lv.management !== 'object' || lv.management === null)
        return validation.mustBeObject('leveling.management');
      const m = lv.management as Record<string, unknown>;
      for (const key of ['rankCommandOwnerOnly', 'resetOwnerOnly', 'resetOnLeave'] as const) {
        if (m[key] !== undefined && typeof m[key] !== 'boolean')
          return validation.mustBeBoolean(`leveling.management.${key}`);
      }
    }

    if (lv.levelRoles !== undefined) {
      if (!isArray(lv.levelRoles)) return validation.mustBeArray('leveling.levelRoles');
      if (lv.levelRoles.length > 15) return validation.maxAllowed('leveling.levelRoles', 15);
      for (const entry of lv.levelRoles) {
        if (typeof entry !== 'object' || entry === null) return validation.eachItemMustBeObject('level role');
        const e = entry as Record<string, unknown>;
        if (!isBoundedInt(e.level, 1, 1000)) return validation.mustBeRange('leveling.levelRoles[].level', 1, 1000);
        if (typeof e.roleId !== 'string' || !isSnowflakeOrNull(e.roleId) || e.roleId === null)
          return validation.mustBeValidRoleId('leveling.levelRoles[].roleId');
      }
    }
    return true;
  },

  welcomeMessage(v) {
    if (!isPlainObject(v)) return validation.mustBeObject('welcomeMessage');
    const wm = v;

    if (wm.enabled !== undefined && typeof wm.enabled !== 'boolean') {
      return validation.mustBeBoolean('welcomeMessage.enabled');
    }
    if (wm.imageEnabled !== undefined && typeof wm.imageEnabled !== 'boolean') {
      return validation.mustBeBoolean('welcomeMessage.imageEnabled');
    }
    if (wm.showRole !== undefined && typeof wm.showRole !== 'boolean') {
      return validation.mustBeBoolean('welcomeMessage.showRole');
    }

    if (wm.type !== undefined) {
      if (typeof wm.type !== 'string' || !WELCOME_MESSAGE_TYPES.has(wm.type)) {
        return validation.mustBeOneOf('welcomeMessage.type', 'none, preset, custom');
      }
    }

    if (wm.trigger !== undefined) {
      if (typeof wm.trigger !== 'string' || !WELCOME_TRIGGERS.has(wm.trigger)) {
        return validation.mustBeOneOf('welcomeMessage.trigger', 'join, role');
      }
    }

    if (wm.channelId !== undefined) {
      wm.channelId = emptyToNull(wm.channelId);
      if (!isSnowflakeOrNull(wm.channelId)) return validation.mustBeValidChannelId('welcomeMessage.channelId');
    }

    if (wm.triggerRoleId !== undefined) {
      wm.triggerRoleId = emptyToNull(wm.triggerRoleId);
      if (!isSnowflakeOrNull(wm.triggerRoleId)) return validation.mustBeValidRoleId('welcomeMessage.triggerRoleId');
    }

    if (wm.message !== undefined) {
      wm.message = emptyToNull(wm.message);
      if (wm.message !== null && !isBoundedString(wm.message, 2000)) {
        return validation.mustBeUnderCharacters('welcomeMessage.message', 2000);
      }
    }

    if (wm.preset !== undefined) {
      wm.preset = emptyToNull(wm.preset);
      if (wm.preset !== null && !isBoundedString(wm.preset, 64)) {
        return validation.mustBeUnderCharacters('welcomeMessage.preset', 64);
      }
    }

    if (wm.card !== undefined) {
      if (!isPlainObject(wm.card)) return validation.mustBeObject('welcomeMessage.card');
      const cardResult = sanitizeWelcomeCard(wm.card);
      if (cardResult !== true) return cardResult;
    }

    if (wm.embed !== undefined) {
      if (!isPlainObject(wm.embed)) return validation.mustBeObject('welcomeMessage.embed');
      const embedResult = sanitizeWelcomeEmbed(wm.embed);
      if (embedResult !== true) return embedResult;
    }

    if (wm.dm !== undefined) {
      if (!isPlainObject(wm.dm)) return validation.mustBeObject('welcomeMessage.dm');
      const dmResult = sanitizeWelcomeDm(wm.dm);
      if (dmResult !== true) return dmResult;
    }

    if (wm.dmEnabled !== undefined) {
      if (typeof wm.dmEnabled !== 'boolean') return validation.mustBeBoolean('welcomeMessage.dmEnabled');
      const dm = isPlainObject(wm.dm) ? wm.dm : {};
      if (dm.enabled === undefined) dm.enabled = wm.dmEnabled;
      wm.dm = dm;
      delete wm.dmEnabled;
    }

    if (wm.dmMessage !== undefined) {
      if (wm.dmMessage !== null && !isBoundedString(wm.dmMessage, 2000)) {
        return validation.mustBeUnderCharacters('welcomeMessage.dmMessage', 2000);
      }
      const dm = isPlainObject(wm.dm) ? wm.dm : {};
      dm.message = emptyToNull(wm.dmMessage);
      wm.dm = dm;
      delete wm.dmMessage;
    }

    return true;
  },

  goodbyeMessage(v) {
    if (typeof v !== 'object' || v === null || isArray(v)) return validation.mustBeObject('goodbyeMessage');
    const gm = v as Record<string, unknown>;
    if (gm.enabled !== undefined && typeof gm.enabled !== 'boolean')
      return validation.mustBeBoolean('goodbyeMessage.enabled');
    if (gm.channelId !== undefined && !isSnowflakeOrNull(gm.channelId))
      return validation.mustBeValidChannelId('goodbyeMessage.channelId');
    if (gm.message !== undefined && !isBoundedString(gm.message, 2000))
      return validation.mustBeUnderCharacters('goodbyeMessage.message', 2000);
    if (gm.embed !== undefined && typeof gm.embed !== 'object') return validation.mustBeObject('goodbyeMessage.embed');
    return true;
  },

  stickyMessages(v) {
    if (!isArray(v)) return validation.mustBeArray('stickyMessages');
    if (v.length > 15) return validation.maxAllowed('sticky messages', 15);

    const channelIds = new Set<string>();
    for (const entry of v) {
      if (typeof entry !== 'object' || entry === null) return validation.eachItemMustBeObject('sticky message');
      const row = entry as Record<string, unknown>;
      if (!isSnowflake(row.channelId)) return validation.mustBeValidChannelId('stickyMessages[].channelId');
      const channelId = String(row.channelId);
      if (channelIds.has(channelId)) return validation.mustBeUnique('stickyMessages[].channelId');
      channelIds.add(channelId);
      if (row.enabled !== undefined && typeof row.enabled !== 'boolean') {
        return validation.mustBeBoolean('stickyMessages[].enabled');
      }
      if (row.content !== undefined && row.content !== null && !isBoundedString(row.content, 2000)) {
        return validation.mustBeUnderCharacters('stickyMessages[].content', 2000);
      }
    }
    return true;
  },

  moderation(v) {
    if (typeof v !== 'object' || v === null || isArray(v)) return validation.mustBeObject('moderation');
    return true; // deep-sanitized, Mongoose schema validates shape
  },

  appeals(v) {
    if (typeof v !== 'object' || v === null || isArray(v)) return validation.mustBeObject('appeals');
    const appeals = v as Record<string, unknown>;
    if (appeals.enabled !== undefined && typeof appeals.enabled !== 'boolean') {
      return validation.mustBeBoolean('appeals.enabled');
    }
    if (appeals.channelId !== undefined) {
      appeals.channelId = emptyToNull(appeals.channelId);
      if (!isSnowflakeOrNull(appeals.channelId)) return validation.mustBeValidChannelId('appeals.channelId');
    }
    if (appeals.cooldownDays !== undefined && !isBoundedInt(appeals.cooldownDays, 0, 365)) {
      return validation.mustBeRange('appeals.cooldownDays', 0, 365);
    }
    if (appeals.allowTempBans !== undefined && typeof appeals.allowTempBans !== 'boolean') {
      return validation.mustBeBoolean('appeals.allowTempBans');
    }
    if (appeals.defaultNoAppeal !== undefined && typeof appeals.defaultNoAppeal !== 'boolean') {
      return validation.mustBeBoolean('appeals.defaultNoAppeal');
    }
    return true;
  },

  automod(v) {
    if (typeof v !== 'object' || v === null || isArray(v)) return validation.mustBeObject('automod');
    return true;
  },

  antiLink(v) {
    if (typeof v !== 'object' || v === null || isArray(v)) return validation.mustBeObject('antiLink');
    return true;
  },

  antiSpam(v) {
    if (typeof v !== 'object' || v === null || isArray(v)) return validation.mustBeObject('antiSpam');
    return true;
  },

  antiGhostPing(v) {
    if (typeof v !== 'object' || v === null || isArray(v)) return validation.mustBeObject('antiGhostPing');
    return true;
  },

  verification(v) {
    if (typeof v !== 'object' || v === null || isArray(v)) return validation.mustBeObject('verification');
    return true;
  },

  rss(v) {
    if (typeof v !== 'object' || v === null || isArray(v)) return validation.mustBeObject('rss');
    const rss = v as Record<string, unknown>;

    if (rss.enabled !== undefined && typeof rss.enabled !== 'boolean') {
      return validation.mustBeBoolean('rss.enabled');
    }

    if (
      rss.pollIntervalMinutes !== undefined &&
      !isBoundedInt(rss.pollIntervalMinutes, RSS_MIN_POLL_INTERVAL_MINUTES, 1440)
    ) {
      return validation.mustBeRange('rss.pollIntervalMinutes', RSS_MIN_POLL_INTERVAL_MINUTES, 1440);
    }

    if (rss.feeds !== undefined) {
      if (!isArray(rss.feeds)) return validation.mustBeArray('rss.feeds');
      if (rss.feeds.length > RSS_MAX_FEEDS_PER_GUILD) {
        return validation.canContainAtMost('rss.feeds', RSS_MAX_FEEDS_PER_GUILD, 'feeds');
      }

      for (const entry of rss.feeds) {
        const feedRes = validateRssFeedEntry(entry);
        if (feedRes !== true) return feedRes;
      }
    }

    if (rss.pollIntervalMinutes === undefined && rss.feeds !== undefined && rss.enabled === true) {
      if (!isBoundedInt(RSS_DEFAULT_POLL_INTERVAL_MINUTES, RSS_MIN_POLL_INTERVAL_MINUTES, 1440)) {
        return validation.isInvalid('rss.pollIntervalMinutes default');
      }
    }

    return true;
  },

  reactionRoles(v) {
    if (!isArray(v)) return validation.mustBeArray('reactionRoles');
    if (v.length > 50) return validation.maxAllowed('reaction role panels', 50);
    return true;
  },

  customCommands(v) {
    if (!isArray(v)) return validation.mustBeArray('customCommands');
    if (v.length > CUSTOM_COMMAND_MAX_PER_GUILD) {
      return validation.customCommandsMaxAllowed(CUSTOM_COMMAND_MAX_PER_GUILD);
    }

    const names = new Set<string>();

    for (const cmd of v) {
      if (typeof cmd !== 'object' || cmd === null) return validation.eachItemMustBeObject('custom command');
      const c = cmd as Record<string, unknown>;

      if (typeof c.name !== 'string' || !CUSTOM_COMMAND_NAME_RE.test(c.name.trim().toLowerCase())) {
        return validation.customCommandNameInvalid();
      }

      const normalizedName = c.name.trim().toLowerCase();
      if (names.has(normalizedName)) {
        return validation.customCommandNamesMustBeUnique();
      }
      names.add(normalizedName);

      if (typeof c.response !== 'string' || c.response.trim().length === 0) {
        return validation.mustBeNonEmptyString('customCommands[].response');
      }

      if (c.response.length > 2000) return validation.mustBeUnderCharacters('customCommands[].response', 2000);

      if (c.embed !== undefined && typeof c.embed !== 'boolean') {
        return validation.mustBeBoolean('customCommands[].embed');
      }

      if (c.color !== undefined && c.color !== null) {
        if (typeof c.color !== 'string' || !CUSTOM_COMMAND_COLOR_RE.test(c.color)) {
          return validation.mustBeValidHexColor('customCommands[].color');
        }
      }

      if (c.title !== undefined && c.title !== null && !isBoundedString(c.title, 256)) {
        return validation.mustBeUnderCharacters('customCommands[].title', 256);
      }

      if (c.enabled !== undefined && typeof c.enabled !== 'boolean') {
        return validation.mustBeBoolean('customCommands[].enabled');
      }

      const actionType = typeof c.actionType === 'string' ? c.actionType : 'reply';
      if (c.actionType !== undefined && !CUSTOM_COMMAND_ACTION_VALUES.has(actionType)) {
        return validation.mustBeOneOf(
          'customCommands[].actionType',
          'reply, toggleRole, addRole, removeRole, or sendDM',
        );
      }

      if (c.targetRoleId !== undefined && !isSnowflakeOrNull(c.targetRoleId)) {
        return validation.mustBeValidRoleId('customCommands[].targetRoleId');
      }

      if (['toggleRole', 'addRole', 'removeRole'].includes(actionType) && !isSnowflake(c.targetRoleId)) {
        return validation.isRequiredForAction('customCommands[].targetRoleId', actionType);
      }

      if (c.requiredRoleIds !== undefined && !isSnowflakeArray(c.requiredRoleIds, 10)) {
        return validation.mustBeArrayOfUpTo('customCommands[].requiredRoleIds', 10, 'role IDs');
      }

      if (c.allowedChannelIds !== undefined && !isSnowflakeArray(c.allowedChannelIds, 25)) {
        return validation.mustBeArrayOfUpTo('customCommands[].allowedChannelIds', 25, 'channel IDs');
      }

      if (c.requiredPermission !== undefined && c.requiredPermission !== null) {
        if (typeof c.requiredPermission !== 'string' || !CUSTOM_COMMAND_PERMISSION_VALUES.has(c.requiredPermission)) {
          return validation.isInvalid('customCommands[].requiredPermission');
        }
      }

      if (c.cooldownSeconds !== undefined && !isBoundedInt(c.cooldownSeconds, 0, 3600)) {
        return validation.mustBeRange('customCommands[].cooldownSeconds', 0, 3600);
      }

      if (c.deleteTrigger !== undefined && typeof c.deleteTrigger !== 'boolean') {
        return validation.mustBeBoolean('customCommands[].deleteTrigger');
      }
    }
    return true;
  },

  keywordWarnings(v) {
    if (typeof v !== 'object' || v === null || isArray(v)) {
      return validation.mustBeObject('keywordWarnings');
    }

    const kw = v as Record<string, unknown>;

    if (kw.enabled !== undefined && typeof kw.enabled !== 'boolean') {
      return validation.mustBeBoolean('keywordWarnings.enabled');
    }

    if (kw.action !== undefined && kw.action !== 'delete' && kw.action !== 'warn' && kw.action !== 'delete+warn') {
      return validation.mustBeOneOf('keywordWarnings.action', 'delete, warn, or delete+warn');
    }

    if (kw.keywords !== undefined) {
      if (!isArray(kw.keywords)) return validation.mustBeArray('keywordWarnings.keywords');
      if (kw.keywords.length > KEYWORD_MAX_PER_GUILD) {
        return validation.maxAllowed('keyword warnings', KEYWORD_MAX_PER_GUILD);
      }

      for (const entry of kw.keywords) {
        if (typeof entry !== 'object' || entry === null || isArray(entry)) {
          return validation.eachItemMustBeObject('keyword warning');
        }

        const keyword = entry as Record<string, unknown>;

        if (!isBoundedString(keyword.pattern, 200) || (keyword.pattern as string).trim().length === 0) {
          return validation.mustBeNonEmptyStringUnder('keywordWarnings.keywords[].pattern', 200);
        }

        if (keyword.isRegex !== undefined && typeof keyword.isRegex !== 'boolean') {
          return validation.mustBeBoolean('keywordWarnings.keywords[].isRegex');
        }

        if (keyword.matchType !== undefined && keyword.matchType !== 'any' && keyword.matchType !== 'word') {
          return validation.mustBeOneOf('keywordWarnings.keywords[].matchType', 'any, word');
        }

        if (keyword.matchType === undefined) {
          keyword.matchType = 'any';
        }

        if (
          keyword.action !== undefined &&
          keyword.action !== 'inherit' &&
          keyword.action !== 'delete' &&
          keyword.action !== 'warn' &&
          keyword.action !== 'delete+warn' &&
          keyword.action !== 'mute' &&
          keyword.action !== 'ban'
        ) {
          return validation.mustBeOneOf(
            'keywordWarnings.keywords[].action',
            'inherit, delete, warn, delete+warn, mute, or ban',
          );
        }

        if (keyword.action === undefined) {
          keyword.action = 'inherit';
        }

        if (keyword.label !== undefined && keyword.label !== null && !isBoundedString(keyword.label, 100)) {
          return validation.mustBeUnderCharacters('keywordWarnings.keywords[].label', 100);
        }

        if (keyword.addedBy !== undefined && keyword.addedBy !== null && !isBoundedString(keyword.addedBy, 64)) {
          return validation.mustBeUnderCharacters('keywordWarnings.keywords[].addedBy', 64);
        }
      }
    }

    return true;
  },

  logChannelOverrides(v) {
    if (typeof v !== 'object' || v === null || isArray(v)) return validation.mustBeObject('logChannelOverrides');
    const overrides = v as Record<string, unknown>;
    for (const [key, val] of Object.entries(overrides)) {
      if (key.length > 50) return validation.keyTooLong('logChannelOverrides');
      if (!isSnowflakeOrNull(val)) return validation.mustBeValidChannelId(`logChannelOverrides.${key}`);
    }
    return true;
  },

  disabledLogEvents(v) {
    if (!isArray(v)) return validation.mustBeArray('disabledLogEvents');
    if (v.length > 50) return validation.maxAllowed('disabled log events', 50);
    if (!v.every((e) => typeof e === 'string' && e.length <= 50))
      return validation.eachItemUnderCharacters('event name', 50);
    return true;
  },

  messageLogIncludeLinks(v) {
    if (typeof v !== 'boolean') return validation.mustBeBoolean('messageLogIncludeLinks');
    return true;
  },
};

export function validateSettingsUpdate(raw: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];
  const sanitized: Record<string, unknown> = {};

  for (const [key, rawValue] of Object.entries(raw)) {
    const value = deepSanitize(rawValue);

    const validator = fieldValidators[key];
    if (validator) {
      const result = validator(value);
      if (result !== true) {
        errors.push(result);
        continue;
      }
    }

    sanitized[key] = value;
  }

  return {
    valid: errors.length === 0,
    errors,
    sanitized,
  };
}
