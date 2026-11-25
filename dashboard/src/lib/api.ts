import { GlitchTip } from './glitchtip';
import { normalizeLeveling } from './levelingSettings';

const API_BASE = '/api';

const responseCache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL = 30_000;

function getCached<T>(key: string): T | undefined {
  const entry = responseCache.get(key);
  if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.data as T;
  if (entry) responseCache.delete(key);
  return undefined;
}

function setCache(key: string, data: unknown): void {
  responseCache.set(key, { data, ts: Date.now() });
  if (responseCache.size > 100) {
    const now = Date.now();
    for (const [k, v] of responseCache) {
      if (now - v.ts > CACHE_TTL) responseCache.delete(k);
    }
  }
}

export function invalidateCache(pathPrefix?: string): void {
  if (!pathPrefix) {
    responseCache.clear();
    return;
  }
  for (const key of responseCache.keys()) {
    if (key.startsWith(pathPrefix)) responseCache.delete(key);
  }
}

export class ApiError extends Error {
  status: number;
  details?: string[];

  constructor(message: string, status: number, details?: string[]) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({ error: res.statusText }))) as {
      error?: string;
      details?: string[];
      [key: string]: unknown;
    };
    const details = Array.isArray(body.details) ? body.details : undefined;
    const error = new ApiError(body.error || `HTTP ${res.status}`, res.status, details);

    if (res.status !== 401 && res.status !== 403) {
      GlitchTip.captureException(error, {
        tags: { api_path: path, status: res.status },
        contexts: { response: { status: res.status, body } },
      });
    }

    throw error;
  }

  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string, { skipCache = false }: { skipCache?: boolean } = {}) => {
    if (!skipCache) {
      const cached = getCached<T>(path);
      if (cached !== undefined) return Promise.resolve(cached);
    }
    return request<T>(path).then((data) => {
      setCache(path, data);
      return data;
    });
  },
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }).then((data) => {
      const base = path.replace(/\/[^/]+$/, '');
      invalidateCache(base);
      return data;
    }),
  delete: <T>(path: string) =>
    request<T>(path, { method: 'DELETE' }).then((data) => {
      const base = path.replace(/\/[^/]+$/, '');
      invalidateCache(base);
      return data;
    }),
};

export interface BotInfo {
  id: string | null;
  username: string | null;
  avatar: string | null;
  guilds: number;
  uptime: number;
  readyAt: string | null;
  online?: boolean;
  memoryMB: number;
}

export interface GuildSummary {
  id: string;
  name: string;
  icon: string | null;
  botPresent?: boolean;
}

export type BugReportStatus = 'open' | 'in_progress' | 'resolved' | 'closed';
export type BugReportReplyDelivery = 'pending' | 'sent' | 'failed';

export interface BugReportReply {
  replyId: string;
  authorId: string;
  message: string;
  deliveryStatus: BugReportReplyDelivery;
  deliveryError: string | null;
  createdAt: string;
  deliveredAt: string | null;
}

export interface BugReport {
  _id: string;
  reporterId: string;
  reporterUsername: string;
  reporterAvatar: string | null;
  guildId: string;
  guildName: string;
  description: string;
  links: string[];
  status: BugReportStatus;
  replies: BugReportReply[];
  createdAt: string;
  updatedAt: string;
}

export interface GuildDetail extends GuildSummary {
  ownerId: string | null;
  channels: Array<{ id: string; name: string; type: number; parent_id: string | null; position: number }>;
  roles: Array<{ id: string; name: string; color: number; position: number }>;
  emojis: Array<{ id: string; name: string; animated: boolean; url?: string | null }>;
}

export interface HealthInfo {
  status: string;
  uptime: number;
  readyAt: string | null;
  online: boolean;
}

/** GET /api/public/status — gateway-aware bot status (no auth). */
export interface PublicStatus {
  status: 'online' | 'degraded';
  online: boolean;
  gateway: string;
  wsPing: number | null;
  readyAt: string | null;
  uptime: number;
  guilds: number;
  timestamp: number;
  dashboard?: 'online' | 'offline';
  botProcess?: 'online' | 'offline';
}

export interface ProcessInfo {
  cpu: number;
  memoryMB: number;
  memoryTotalMB: number;
  rssMB: number;
  uptime: number;
  pid: number;
  nodeVersion: string;
}

export interface UserInfo {
  id: string;
  username: string;
  avatar: string | null;
  isOwner: boolean;
}

export interface LogEntry {
  level: string;
  tag: string;
  message: string;
  timestamp: number;
}

export interface LogsResponse {
  entries: LogEntry[];
  total: number;
}

export interface KeywordEntry {
  pattern: string;
  isRegex: boolean;
  matchType: 'any' | 'word';
  label: string | null;
  addedBy: string | null;
  action?: 'inherit' | 'delete' | 'warn' | 'delete+warn' | 'mute' | 'ban';
}

export const KEYWORD_MAX_PER_GUILD = 100;

export interface KeywordWarnings {
  enabled: boolean;
  action: 'delete' | 'warn' | 'delete+warn';
  keywords: KeywordEntry[];
}

export interface HoneypotEntry {
  channelId: string;
  action: 'ban' | 'kick' | 'timeout' | 'role';
  enabled: boolean;
  banDeleteDays: number;
  timeoutHours: number;
  roleId: string | null;
}

export interface StickyMessage {
  channelId: string;
  enabled: boolean;
  content: string | null;
}

export const STICKY_MESSAGE_MAX_PER_GUILD = 15;

export interface WelcomeCard {
  preset: string | null;
  bgColor1: string | null;
  bgColor2: string | null;
  bgColor3: string | null;
  accentColor: string | null;
  textColor: string | null;
  subtextColor: string | null;
  countColor: string | null;
  greetingText: string | null;
  subtitle: string | null;
  showMemberCount: boolean;
  bgImageURL: string | null;
}

export interface WelcomeEmbed {
  enabled: boolean;
  title: string | null;
  description: string | null;
  color: string | null;
  footer: string | null;
  thumbnail: boolean;
}

export interface WelcomeDM {
  enabled: boolean;
  message: string | null;
  imageEnabled: boolean;
}

export interface WelcomeMessage {
  enabled: boolean;
  type: 'none' | 'preset' | 'custom';
  channelId: string | null;
  message: string | null;
  preset: string | null;
  imageEnabled: boolean;
  card: WelcomeCard;
  embed: WelcomeEmbed;
  dm: WelcomeDM;
  showRole: boolean;
  trigger: 'join' | 'role';
  triggerRoleId: string | null;
}

const WELCOME_CARD_PRESETS = new Set(['default', 'dark', 'light', 'ocean', 'sunset', 'midnight', 'forest']);

function emptyStringToNull(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  return typeof value === 'string' ? value : null;
}

function normalizeWelcomeCardPreset(value: unknown): WelcomeCard['preset'] {
  if (value === null || value === undefined || value === '') return null;
  return typeof value === 'string' && WELCOME_CARD_PRESETS.has(value) ? (value as WelcomeCard['preset']) : null;
}

function normalizeWelcomeHexColor(value: unknown): string | null {
  const raw = emptyStringToNull(value);
  if (raw === null) return null;
  return /^#?[0-9a-fA-F]{6}$/.test(raw) ? (raw.startsWith('#') ? raw : `#${raw}`) : null;
}

function normalizeWelcomeCardHexColor(value: unknown): string | null {
  const raw = emptyStringToNull(value);
  if (raw === null) return null;
  return /^#?(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(raw) ? (raw.startsWith('#') ? raw : `#${raw}`) : null;
}

function normalizeWelcomeBgImageUrl(value: unknown): string | null {
  const raw = emptyStringToNull(value);
  if (raw === null || raw.startsWith('data:')) return null;
  if (raw.startsWith('/uploads/') || /^https?:\/\//i.test(raw)) return raw;
  return null;
}

function normalizeWelcomeEmbed(raw: Partial<WelcomeEmbed> | boolean | null | undefined): WelcomeEmbed {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      enabled: false,
      title: null,
      description: null,
      color: null,
      footer: null,
      thumbnail: false,
    };
  }

  return {
    enabled: raw.enabled ?? false,
    title: emptyStringToNull(raw.title),
    description: emptyStringToNull(raw.description),
    color: normalizeWelcomeHexColor(raw.color),
    footer: emptyStringToNull(raw.footer),
    thumbnail: raw.thumbnail ?? false,
  };
}

function normalizeWelcomeDm(raw: Partial<WelcomeDM> | boolean | null | undefined): WelcomeDM {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      enabled: false,
      message: null,
      imageEnabled: false,
    };
  }

  return {
    enabled: raw.enabled ?? false,
    message: emptyStringToNull(raw.message),
    imageEnabled: raw.imageEnabled ?? false,
  };
}

export function normalizeWelcomeMessage(raw: Partial<WelcomeMessage> & Record<string, unknown> = {}): WelcomeMessage {
  const card = (raw.card ?? {}) as Partial<WelcomeCard>;
  const legacyDmEnabled = typeof raw.dmEnabled === 'boolean' ? raw.dmEnabled : undefined;
  const legacyDmMessage = emptyStringToNull(raw.dmMessage);
  const dm = normalizeWelcomeDm(raw.dm);
  if (legacyDmEnabled !== undefined && raw.dm?.enabled === undefined) dm.enabled = legacyDmEnabled;
  if (legacyDmMessage !== null && dm.message === null) dm.message = legacyDmMessage;

  return {
    enabled: raw.enabled ?? false,
    type: raw.type === 'preset' || raw.type === 'custom' ? raw.type : 'none',
    channelId: emptyStringToNull(raw.channelId),
    message: emptyStringToNull(raw.message),
    preset: emptyStringToNull(raw.preset),
    imageEnabled: raw.imageEnabled ?? false,
    showRole: raw.showRole ?? false,
    trigger: raw.trigger === 'role' ? 'role' : 'join',
    triggerRoleId: emptyStringToNull(raw.triggerRoleId),
    card: {
      preset: normalizeWelcomeCardPreset(card.preset),
      bgColor1: normalizeWelcomeCardHexColor(card.bgColor1),
      bgColor2: normalizeWelcomeCardHexColor(card.bgColor2),
      bgColor3: normalizeWelcomeCardHexColor(card.bgColor3),
      accentColor: normalizeWelcomeCardHexColor(card.accentColor),
      textColor: normalizeWelcomeCardHexColor(card.textColor),
      subtextColor: normalizeWelcomeCardHexColor(card.subtextColor),
      countColor: normalizeWelcomeCardHexColor(card.countColor),
      greetingText: emptyStringToNull(card.greetingText),
      subtitle: emptyStringToNull(card.subtitle),
      showMemberCount: card.showMemberCount ?? true,
      bgImageURL: normalizeWelcomeBgImageUrl(card.bgImageURL),
    },
    embed: normalizeWelcomeEmbed(raw.embed),
    dm,
  };
}

export interface ReactionRoleEntry {
  emoji: string;
  roleId: string;
  removeRoleId?: string | null;
}

export interface ReactionRole {
  messageId: string;
  channelId: string;
  title?: string | null;
  description?: string | null;
  plainText?: boolean;
  roles: ReactionRoleEntry[];
}

export interface Moderation {
  muteRoleId: string | null;
  logChannelId: string | null;
  autoMute: boolean;
  autoMuteThreshold: number;
  muteMethod: 'auto' | 'timeout' | 'mute_role';
}

export type CustomCommandPermission =
  | 'Administrator'
  | 'ManageGuild'
  | 'ManageRoles'
  | 'ManageChannels'
  | 'ManageMessages'
  | 'KickMembers'
  | 'BanMembers'
  | 'ModerateMembers';

export type CustomCommandActionType = 'reply' | 'toggleRole';

export interface CustomCommand {
  name: string;
  response: string;
  embed: boolean;
  color: string | null;
  title: string | null;
  enabled: boolean;
  actionType: CustomCommandActionType;
  targetRoleId: string | null;
  requiredRoleIds: string[];
  requiredPermission: CustomCommandPermission | null;
  allowedChannelIds: string[];
  cooldownSeconds: number;
  deleteTrigger: boolean;
}

export interface AutomodSpam {
  maxMessages: number;
  timeWindow: number;
  timeoutDuration: number;
  violationThreshold: number;
}

export interface AutomodRaid {
  userThreshold: number;
  timeWindow: number;
}

export type AutomodLevel = 'off' | 'minimal' | 'medium' | 'high';

export interface Automod {
  level: AutomodLevel;
  antiSpam: boolean;
  antiLink: boolean;
  antiReactionSpam: boolean;
  ghostPing: boolean;
  maxMentions: number;
  maxLines: number;
  spam: AutomodSpam;
  raid: AutomodRaid;
  allowedDomains: string[];
  exemptRoles: string[];
  exemptChannels: string[];
}

export interface GoodbyeEmbed {
  enabled: boolean;
  title: string | null;
  description: string | null;
  color: string | null;
  footer: string | null;
}

export interface GoodbyeMessage {
  enabled: boolean;
  channelId: string | null;
  message: string | null;
  embed: GoodbyeEmbed;
}

export interface LogChannelOverrides {
  member: string | null;
  voice: string | null;
  message: string | null;
  role: string | null;
  channel: string | null;
  reaction: string | null;
  server: string | null;
}

export interface Verification {
  enabled: boolean;
  categoryId: string | null;
  verifiedRoleId: string | null;
  panelChannelId: string | null;
  panelMessageId: string | null;
  logChannelId: string | null;
  maxAttempts: number;
}

export type RssSourceType = 'rss' | 'rsshub';

export interface RssFeed {
  id: string;
  name: string | null;
  sourceType: RssSourceType;
  url: string | null;
  route: string | null;
  channelId: string;
  mentionRoleId: string | null;
  webhookId: string | null;
  webhookToken: string | null;
  webhookName: string | null;
  enabled: boolean;
  maxItemsPerPoll: number;
  includeSummary: boolean;
  includeImage: boolean;
  format: 'embed' | 'text';
}

export interface RssSettings {
  enabled: boolean;
  pollIntervalMinutes: number;
  feeds: RssFeed[];
}

export interface Starboard {
  enabled: boolean;
  channelId: string | null;
  threshold: number;
  emoji: string;
  selfStarEnabled: boolean;
  ignoreBots: boolean;
  ignoredChannels: string[];
  ignoredRoles: string[];
}

export type XpCurve = 'linear' | 'quadratic';
export type MessageXpMode = 'random' | 'per_word';
export type ReactionXpAwards = 'both' | 'send' | 'receive';
export type LevelUpChannelMode = 'message' | 'specific';
export type NoXpChannelMode = 'blacklist' | 'whitelist';

export interface LevelRole {
  level: number;
  roleId: string;
}

export interface MessageXpQualitySettings {
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

export interface LevelingSettings {
  enabled: boolean;
  leaderboardVanity: string | null;
  formula: { curve: XpCurve; multiplier: number; maxLevel: number | null };
  messageXp: {
    enabled: boolean;
    mode: MessageXpMode;
    min: number;
    max: number;
    cooldownSeconds: number;
    quality: MessageXpQualitySettings;
  };
  voiceXp: {
    enabled: boolean;
    min: number;
    max: number;
    cooldownSeconds: number;
    minimumMembers: number;
    antiAfk: boolean;
  };
  reactionXp: {
    enabled: boolean;
    awards: ReactionXpAwards;
    min: number;
    max: number;
    cooldownSeconds: number;
  };
  levelUp: {
    enabled: boolean;
    template: string;
    channelMode: LevelUpChannelMode;
    channelId: string | null;
    includeImage: boolean;
  };
  levelRoles: LevelRole[];
  stackRewards: boolean;
  firstPlaceRoleId: string | null;
  highlights: {
    weeklyEnabled: boolean;
    weeklyChannelId: string | null;
    monthlyEnabled: boolean;
    monthlyChannelId: string | null;
  };
  rankCard: {
    progressColor: string;
    backgroundColor: string;
    fontColor: string;
    opacity: number;
  };
  restrictions: {
    noXpChannelMode: NoXpChannelMode;
    noXpChannels: string[];
    noXpRoles: string[];
    textInVoiceXp: boolean;
  };
  management: {
    rankCommandOwnerOnly: boolean;
    resetOwnerOnly: boolean;
    resetOnLeave: boolean;
  };
}

export interface GuildSettings {
  guildId: string;
  prefixes: string[];
  welcomeMessage: WelcomeMessage;
  reactionRoles: ReactionRole[];
  moderation: Moderation;
  appeals: Appeals;
  automod: Automod;
  logChannelId: string | null;
  muteRoleId: string | null;
  prefix: string | null;
  autoroleId: string | null;
  raidDisableAutorole: boolean;
  staffChannelId: string | null;
  staffRoleId: string | null;
  staffInboxChannelId: string | null;
  keywordWarnings: KeywordWarnings;
  honeypotChannels: HoneypotEntry[];
  honeypotAlertRoleId: string | null;
  stickyMessages: StickyMessage[];
  serverLogChannelId: string | null;
  logChannelOverrides: LogChannelOverrides;
  disabledLogEvents: string[];
  messageLogIncludeLinks: boolean;
  blacklistedChannels: string[];
  ticketCategoryId: string | null;
  ticketSupportRoleId: string | null;
  ticketSupportRoleIds: string[];
  ticketLogChannelId: string | null;
  ticketMaxOpen: number;
  ticketOpenMessage: string | null;
  ticketSetupChannelId: string | null;
  ticketSetupMessageId: string | null;
  ticketEmoji: string;
  customCommands: CustomCommand[];
  reactionRoleDMEnabled: boolean;
  goodbyeMessage: GoodbyeMessage;
  lockdownRoles: string[];
  lockdownAllowedRoles: string[];
  lockdownAllowedUsers: string[];
  slowmodeAllowedRoles: string[];
  commandAllowedRoles: string[];
  disabledCommands: string[];
  verification: Verification;
  rss: RssSettings;
  starboards: Starboard[];
  starboard: Starboard;
  leveling: LevelingSettings;
}

export interface Appeals {
  enabled: boolean;
  channelId: string | null;
  cooldownDays: number;
  allowTempBans: boolean;
  defaultNoAppeal: boolean;
}

export function normalizeSettings(s: Partial<GuildSettings> & { guildId: string }): GuildSettings {
  const wm = (s.welcomeMessage ?? {}) as Partial<WelcomeMessage>;
  const am = (s.automod ?? {}) as Partial<Automod>;
  const mod = (s.moderation ?? {}) as Partial<Moderation>;
  const appeals = (s.appeals ?? {}) as Partial<Appeals>;
  const kw = (s.keywordWarnings ?? {}) as Partial<KeywordWarnings>;
  const gm = (s.goodbyeMessage ?? {}) as Partial<GoodbyeMessage>;
  const rss = ((s as any).rss ?? {}) as Partial<RssSettings>;
  const normalizeBoard = (raw: any): Starboard => ({
    enabled: !!raw?.enabled,
    channelId: raw?.channelId ?? null,
    threshold: typeof raw?.threshold === 'number' ? raw.threshold : 3,
    emoji: typeof raw?.emoji === 'string' ? raw.emoji : '⭐',
    selfStarEnabled: !!raw?.selfStarEnabled,
    ignoreBots: raw?.ignoreBots === false ? false : true,
    ignoredChannels: Array.isArray(raw?.ignoredChannels) ? raw.ignoredChannels : [],
    ignoredRoles: Array.isArray(raw?.ignoredRoles) ? raw.ignoredRoles : [],
  });

  const rawBoards = Array.isArray((s as any).starboards) ? (s as any).starboards : [];
  const boards = rawBoards.map(normalizeBoard).slice(0, 3);
  const primaryBoard = boards[0] ?? normalizeBoard((s as any).starboard ?? {});
  const starboards = boards.length > 0 ? boards : [primaryBoard];
  const rssFeeds = Array.isArray(rss.feeds) ? rss.feeds : [];
  const rawCustomCommands = Array.isArray(s.customCommands) ? s.customCommands : [];

  const normalizedRssFeeds: RssFeed[] = rssFeeds.slice(0, 5).map((feed: any, idx: number) => ({
    id: typeof feed?.id === 'string' && feed.id.trim().length > 0 ? feed.id : `feed-${idx + 1}`,
    name: typeof feed?.name === 'string' && feed.name.trim().length > 0 ? feed.name.trim() : null,
    sourceType: feed?.sourceType === 'rsshub' ? 'rsshub' : 'rss',
    url: typeof feed?.url === 'string' ? feed.url : null,
    route: typeof feed?.route === 'string' ? feed.route : null,
    channelId: typeof feed?.channelId === 'string' ? feed.channelId : '',
    mentionRoleId: typeof feed?.mentionRoleId === 'string' ? feed.mentionRoleId : null,
    webhookId: typeof feed?.webhookId === 'string' ? feed.webhookId : null,
    webhookToken: typeof feed?.webhookToken === 'string' ? feed.webhookToken : null,
    webhookName: typeof feed?.webhookName === 'string' ? feed.webhookName : null,
    enabled: feed?.enabled !== false,
    maxItemsPerPoll:
      typeof feed?.maxItemsPerPoll === 'number' ? Math.max(1, Math.min(10, Math.floor(feed.maxItemsPerPoll))) : 3,
    includeSummary: feed?.includeSummary !== false,
    includeImage: feed?.includeImage !== false,
    format: feed?.format === 'text' ? 'text' : 'embed',
  }));

  const normalizedCustomCommands: CustomCommand[] = rawCustomCommands.slice(0, 5).map((cmd: any) => ({
    name: typeof cmd?.name === 'string' ? cmd.name.trim().toLowerCase() : '',
    response: typeof cmd?.response === 'string' ? cmd.response : '',
    embed: !!cmd?.embed,
    color: typeof cmd?.color === 'string' ? cmd.color : null,
    title: typeof cmd?.title === 'string' ? cmd.title : null,
    enabled: cmd?.enabled !== false,
    actionType: cmd?.actionType === 'toggleRole' ? 'toggleRole' : 'reply',
    targetRoleId: typeof cmd?.targetRoleId === 'string' ? cmd.targetRoleId : null,
    requiredRoleIds: Array.isArray(cmd?.requiredRoleIds)
      ? cmd.requiredRoleIds.filter((id: unknown) => typeof id === 'string')
      : [],
    requiredPermission: typeof cmd?.requiredPermission === 'string' ? cmd.requiredPermission : null,
    allowedChannelIds: Array.isArray(cmd?.allowedChannelIds)
      ? cmd.allowedChannelIds.filter((id: unknown) => typeof id === 'string')
      : [],
    cooldownSeconds:
      typeof cmd?.cooldownSeconds === 'number' ? Math.max(0, Math.min(3600, Math.floor(cmd.cooldownSeconds))) : 0,
    deleteTrigger: !!cmd?.deleteTrigger,
  }));

  return {
    guildId: s.guildId,
    prefixes: s.prefixes ?? [],
    prefix: s.prefix ?? null,
    logChannelId: s.logChannelId ?? null,
    muteRoleId: s.muteRoleId ?? null,
    autoroleId: s.autoroleId ?? null,
    raidDisableAutorole: s.raidDisableAutorole ?? false,
    staffChannelId: s.staffChannelId ?? null,
    staffRoleId: s.staffRoleId ?? null,
    staffInboxChannelId: s.staffInboxChannelId ?? null,
    serverLogChannelId: s.serverLogChannelId ?? null,
    logChannelOverrides: {
      member: (s as any).logChannelOverrides?.member ?? null,
      voice: (s as any).logChannelOverrides?.voice ?? null,
      message: (s as any).logChannelOverrides?.message ?? null,
      role: (s as any).logChannelOverrides?.role ?? null,
      channel: (s as any).logChannelOverrides?.channel ?? null,
      reaction: (s as any).logChannelOverrides?.reaction ?? null,
      server: (s as any).logChannelOverrides?.server ?? null,
    },
    disabledLogEvents: s.disabledLogEvents ?? [],
    messageLogIncludeLinks: s.messageLogIncludeLinks !== false,
    blacklistedChannels: s.blacklistedChannels ?? [],
    honeypotChannels: s.honeypotChannels ?? [],
    honeypotAlertRoleId: s.honeypotAlertRoleId ?? null,
    stickyMessages: Array.isArray((s as any).stickyMessages)
      ? (s as any).stickyMessages.map((entry: Partial<StickyMessage>) => ({
          channelId: entry.channelId ?? '',
          enabled: entry.enabled !== false,
          content: entry.content ?? null,
        }))
      : [],
    reactionRoles: s.reactionRoles ?? [],
    reactionRoleDMEnabled: s.reactionRoleDMEnabled ?? false,
    customCommands: normalizedCustomCommands,
    goodbyeMessage: {
      enabled: gm.enabled ?? false,
      channelId: gm.channelId ?? null,
      message: gm.message ?? null,
      embed: {
        enabled: gm.embed?.enabled ?? false,
        title: gm.embed?.title ?? null,
        description: gm.embed?.description ?? null,
        color: gm.embed?.color ?? null,
        footer: gm.embed?.footer ?? null,
      },
    },

    lockdownRoles: s.lockdownRoles ?? [],
    lockdownAllowedRoles: s.lockdownAllowedRoles ?? [],
    lockdownAllowedUsers: s.lockdownAllowedUsers ?? [],
    slowmodeAllowedRoles: s.slowmodeAllowedRoles ?? [],
    commandAllowedRoles: s.commandAllowedRoles ?? [],
    disabledCommands: (s as any).disabledCommands ?? [],
    ticketCategoryId: s.ticketCategoryId ?? null,
    ticketSupportRoleId: s.ticketSupportRoleId ?? null,
    ticketSupportRoleIds: s.ticketSupportRoleIds ?? [],
    ticketLogChannelId: s.ticketLogChannelId ?? null,
    ticketMaxOpen: s.ticketMaxOpen ?? 3,
    ticketOpenMessage: s.ticketOpenMessage ?? null,
    ticketSetupChannelId: s.ticketSetupChannelId ?? null,
    ticketSetupMessageId: s.ticketSetupMessageId ?? null,
    ticketEmoji: s.ticketEmoji ?? '🎫',

    welcomeMessage: normalizeWelcomeMessage(wm as Partial<WelcomeMessage> & Record<string, unknown>),

    automod: {
      level: am.level ?? 'off',
      antiSpam: am.antiSpam ?? false,
      antiLink: am.antiLink ?? false,
      antiReactionSpam: am.antiReactionSpam ?? false,
      ghostPing: am.ghostPing ?? false,
      maxMentions: am.maxMentions ?? 0,
      maxLines: am.maxLines ?? 0,
      allowedDomains: am.allowedDomains ?? [],
      exemptRoles: am.exemptRoles ?? [],
      exemptChannels: am.exemptChannels ?? [],
      spam: {
        maxMessages: am.spam?.maxMessages ?? 5,
        timeWindow: am.spam?.timeWindow ?? 5,
        timeoutDuration: am.spam?.timeoutDuration ?? 10,
        violationThreshold: am.spam?.violationThreshold ?? 3,
      },
      raid: {
        userThreshold: (am as any).raid?.userThreshold ?? 5,
        timeWindow: (am as any).raid?.timeWindow ?? 10,
      },
    },

    moderation: {
      muteRoleId: mod.muteRoleId ?? null,
      logChannelId: mod.logChannelId ?? null,
      autoMute: mod.autoMute ?? false,
      autoMuteThreshold: mod.autoMuteThreshold ?? 3,
      muteMethod: (mod.muteMethod as any) ?? 'auto',
    },

    appeals: {
      enabled: appeals.enabled ?? false,
      channelId: appeals.channelId ?? null,
      cooldownDays: appeals.cooldownDays ?? 7,
      allowTempBans: appeals.allowTempBans ?? false,
      defaultNoAppeal: appeals.defaultNoAppeal ?? false,
    },

    keywordWarnings: {
      enabled: kw.enabled ?? false,
      action: kw.action ?? 'delete',
      keywords: (kw.keywords ?? []).map((entry) => ({
        pattern: entry.pattern,
        isRegex: entry.isRegex ?? false,
        matchType: entry.matchType === 'word' ? 'word' : 'any',
        label: entry.label ?? null,
        addedBy: entry.addedBy ?? null,
        action:
          entry.action === 'delete' ||
          entry.action === 'warn' ||
          entry.action === 'delete+warn' ||
          entry.action === 'mute' ||
          entry.action === 'ban'
            ? entry.action
            : 'inherit',
      })),
    },

    verification: {
      enabled: (s as any).verification?.enabled ?? false,
      categoryId: (s as any).verification?.categoryId ?? null,
      verifiedRoleId: (s as any).verification?.verifiedRoleId ?? null,
      panelChannelId: (s as any).verification?.panelChannelId ?? null,
      panelMessageId: (s as any).verification?.panelMessageId ?? null,
      logChannelId: (s as any).verification?.logChannelId ?? null,
      maxAttempts: (s as any).verification?.maxAttempts ?? 2,
    },

    rss: {
      enabled: rss.enabled ?? false,
      pollIntervalMinutes:
        typeof rss.pollIntervalMinutes === 'number'
          ? Math.max(10, Math.min(1440, Math.floor(rss.pollIntervalMinutes)))
          : 15,
      feeds: normalizedRssFeeds,
    },

    starboards,
    starboard: primaryBoard,
    leveling: normalizeLeveling((s as any).leveling),
  };
}

export interface DailyStat {
  date: string;
  count: number;
}

export interface TopCommand {
  command: string;
  count: number;
}

export interface TopGuild {
  guildId: string;
  name: string;
  count: number;
}

export interface StatsTotals {
  totalCommands: number;
  totalModActions: number;
  totalGuilds: number;
  totalMembers: number;
}

export interface GrowthPoint {
  date: string;
  guilds: number;
  members: number;
}

export interface DailyGuildEvent {
  date: string;
  joins: number;
  leaves: number;
}

export interface GuildGrowthResponse {
  daily: DailyGuildEvent[];
  totals: { joins: number; leaves: number };
}

export interface LargestGuild {
  guildId: string;
  name: string;
  members: number;
}

export interface ModerationLogEntry {
  _id: string;
  guildId: string;
  userId: string;
  targetId: string;
  action: string;
  reason: string;
  duration: number | null;
  metadata: Record<string, unknown>;
  timestamp: string;
  caseNumber?: number;
}

export interface ModerationLogsResponse {
  logs: ModerationLogEntry[];
  total: number;
}

// ---------- per-guild analytics ----------

export interface GuildAnalyticsSummary {
  guildName: string;
  members: number;
  totalCommands: number;
  totalModActions: number;
  levelingProfiles: number;
  levelingMessages: number;
  avgLevel: number;
}

export interface GuildActivityDaily {
  date: string;
  messages: number;
  commands: number;
  activeMembers: number;
  joins: number;
  leaves: number;
  voiceJoins: number;
  voiceMinutes: number;
  moderationActions: number;
  automodActions: number;
  tickets: number;
  reports: number;
}

export interface GuildActivityDailyResponse {
  daily: GuildActivityDaily[];
  lastUpdated: string | null;
}

export interface GuildActivitySummary {
  messages: number;
  commands: number;
  activeMembers: number;
  joins: number;
  leaves: number;
  voiceJoins: number;
  voiceMinutes: number;
  moderationActions: number;
  automodActions: number;
  tickets: number;
  reports: number;
  lastUpdated: string | null;
}

export interface GuildActivityChannel {
  channelId: string;
  channelName: string | null;
  count: number;
}

export interface GuildActivityHeatmapCell {
  weekday: number;
  hour: number;
  count: number;
}

export interface GuildActivityHeatmapResponse {
  cells: GuildActivityHeatmapCell[];
  lastUpdated: string | null;
}

export interface GuildDailyStat {
  date: string;
  count: number;
}

export interface GuildTopCommand {
  command: string;
  count: number;
}

export interface GuildModDaily {
  date: string;
  total: number;
  [action: string]: string | number; // action counts + date/total
}

export interface GuildModBreakdown {
  total: number;
  byAction: Record<string, number>;
}

export interface GuildMemberTrend {
  date: string;
  members: number;
}

export interface GuildLevelingEntry {
  userId: string;
  username?: string;
  xp: number;
  level: number;
  messages: number;
}
