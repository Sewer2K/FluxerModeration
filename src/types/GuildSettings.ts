import type { ILeveling } from './Leveling';
export type { ILeveling, ILevelRole } from './Leveling';

export const VALID_AUTOMOD_LEVELS = ['off', 'minimal', 'medium', 'high'] as const;

export const KEYWORD_ACTIONS = ['delete', 'warn', 'delete+warn', 'mute', 'ban'] as const;
export type KeywordAction = (typeof KEYWORD_ACTIONS)[number];
export type KeywordEntryAction = KeywordAction | 'inherit';

export interface IKeywordEntry {
  pattern: string;
  isRegex: boolean;
  matchType: 'any' | 'word';
  label: string | null;
  addedBy: string | null;
  action?: KeywordEntryAction;
}

export interface IKeywordWarnings {
  enabled: boolean;
  action: 'delete' | 'warn' | 'delete+warn';
  keywords: IKeywordEntry[];
}

export const HONEYPOT_ACTIONS = ['ban', 'kick', 'timeout', 'role'] as const;
export type HoneypotAction = (typeof HONEYPOT_ACTIONS)[number];

export interface IHoneypotEntry {
  channelId: string;
  action: HoneypotAction;
  enabled: boolean;
  banDeleteDays?: number;
  timeoutHours?: number;
  roleId: string | null;
}

export interface IStickyMessage {
  channelId: string;
  enabled: boolean;
  content: string | null;
}

export interface IWelcomeCard {
  preset: 'default' | 'dark' | 'light' | 'ocean' | 'sunset' | 'midnight' | 'forest' | null;
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

export interface IWelcomeEmbed {
  enabled: boolean;
  title: string | null;
  description: string | null;
  color: string | null;
  footer: string | null;
  thumbnail: boolean;
}

export interface IWelcomeDM {
  enabled: boolean;
  message: string | null;
  imageEnabled: boolean;
}

export interface IWelcomeMessage {
  enabled: boolean;
  type: 'none' | 'preset' | 'custom';
  channelId: string | null;
  message: string | null;
  preset: string | null;
  imageEnabled: boolean;
  card: IWelcomeCard;
  embed: IWelcomeEmbed;
  dm: IWelcomeDM;
  showRole: boolean;
  trigger: 'join' | 'role';
  triggerRoleId: string | null;
}

export interface IReactionRolesRole {
  emoji: string;
  roleId: string;
  roleIds?: string[];
  removeRoleId: string | null;
}

export interface IReactionRolesEntry {
  messageId: string;
  channelId: string;
  title?: string | null;
  description?: string | null;
  plainText?: boolean;
  roles: IReactionRolesRole[];
}

export interface IModeration {
  muteRoleId: string | null;
  logChannelId: string | null;
  autoMute: boolean;
  autoMuteThreshold: number;
  muteMethod: 'auto' | 'timeout' | 'mute_role';
  logStyle: 'embed' | 'text';
}

export interface IAppeals {
  enabled: boolean;
  channelId: string | null;
  cooldownDays: number;
  allowTempBans: boolean;
  defaultNoAppeal: boolean;
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

export type CustomCommandActionType = 'reply' | 'toggleRole' | 'addRole' | 'removeRole' | 'sendDM';

export interface ICustomCommand {
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

export interface IAutomodSpam {
  maxMessages: number;
  timeWindow: number;
  timeoutDuration: number;
  violationThreshold: number;
}

export interface IAutomodRaid {
  userThreshold: number;
  timeWindow: number;
  action: 'alert' | 'kick' | 'ban';
  kickBots: boolean;
  minAccountAgeDays: number;
  accountAgeAction: 'alert' | 'kick' | 'ban';
  autoLockdownInvites: boolean;
}

export type AutomodLevel = (typeof VALID_AUTOMOD_LEVELS)[number];

export interface AutomodSettingsPreset {
  antiSpam: boolean;
  antiLink: boolean;
  antiReactionSpam: boolean;
  maxMentions: number;
  maxLines: number;
}

export interface AutomodSettings extends AutomodSettingsPreset {
  level: AutomodLevel;
  enabled: boolean;
}

export interface IAutomod extends AutomodSettingsPreset {
  level: AutomodLevel;
  antiSpam: boolean;
  antiLink: boolean;
  antiReactionSpam: boolean;
  ghostPing: boolean;
  maxMentions: number;
  maxLines: number;
  spam: IAutomodSpam;
  raid: IAutomodRaid;
  allowedDomains: string[];
  exemptRoles: string[];
  exemptChannels: string[];
}

export interface IGoodbyeEmbed {
  enabled: boolean;
  title: string | null;
  description: string | null;
  color: string | null;
  footer: string | null;
}

export interface IGoodbyeMessage {
  enabled: boolean;
  channelId: string | null;
  message: string | null;
  embed: IGoodbyeEmbed;
}

export interface ILogChannelOverrides {
  member: string | null;
  voice: string | null;
  message: string | null;
  role: string | null;
  channel: string | null;
  reaction: string | null;
  server: string | null;
}

export interface IStarboardBoard {
  enabled: boolean;
  channelId: string | null;
  threshold: number;
  emoji: string;
  selfStarEnabled: boolean;
  ignoreBots: boolean;
  ignoredChannels: string[];
  ignoredRoles: string[];
}

export interface IVerification {
  enabled: boolean;
  categoryId: string | null;
  verifiedRoleId: string | null;
  panelChannelId: string | null;
  panelMessageId: string | null;
  logChannelId: string | null;
  maxAttempts: number;
}

export interface IActivityRole {
  enabled: boolean;
  messageThreshold: number;
  roleId: string | null;
}

export type SocialPlatform = 'youtube' | 'tiktok';

export interface ISocialNotification {
  id: string;
  platform: SocialPlatform;
  channelOrUsername: string;
  postChannelId: string;
  message: string | null;
  enabled: boolean;
}

export type RssSourceType = 'rss' | 'rsshub';

export interface IRssFeed {
  id: string;
  name: string | null;
  sourceType: RssSourceType;
  url: string | null;
  route: string | null;
  channelId: string;
  mentionRoleId: string | null;
  webhookId?: string | null;
  webhookToken?: string | null;
  webhookName?: string | null;
  enabled: boolean;
  maxItemsPerPoll: number;
  includeSummary: boolean;
  includeImage: boolean;
  format: 'embed' | 'text';
  sendAs: 'webhook' | 'bot';
}

export interface IRssSettings {
  enabled: boolean;
  pollIntervalMinutes: number;
  feeds: IRssFeed[];
}

export interface IGuildSettings {
  guildId: string;
  prefixes: string[];
  language: string;
  welcomeMessage: IWelcomeMessage;
  reactionRoles: IReactionRolesEntry[];
  moderation: IModeration;
  appeals: IAppeals;
  automod: IAutomod;

  // legacy fields
  automodEnabled: boolean;
  antiLink: boolean;
  antiSpam: boolean;
  antiGhostPing: boolean;

  logChannelId: string | null;
  muteRoleId: string | null;
  prefix: string | null;
  reactionRoleDMEnabled: boolean;
  autoroleId: string | null;
  raidDisableAutorole: boolean;
  raidInvitesWereDisabled?: boolean;
  raidInviteUnlockAt?: Date | null;

  staffChannelId: string | null;
  staffRoleId: string | null;
  staffInboxChannelId: string | null;

  keywordWarnings: IKeywordWarnings;
  honeypotChannels: IHoneypotEntry[];
  honeypotAlertRoleId: string | null;
  stickyMessages: IStickyMessage[];

  serverLogChannelId: string | null;
  logChannelOverrides: ILogChannelOverrides;
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

  customCommands: ICustomCommand[];

  goodbyeMessage: IGoodbyeMessage;

  lockdownRoles: string[];
  lockdownAllowedRoles: string[];
  lockdownAllowedUsers: string[];

  slowmodeAllowedRoles: string[];
  commandAllowedRoles: string[];

  globalBanEnabled: boolean;
  globalBanAutoApply: boolean;

  disabledCommands: string[];

  verification: IVerification;

  rss: IRssSettings;

  activityRole: IActivityRole;
  leveling: ILeveling;
  socialNotifications: ISocialNotification[];

  starboards: IStarboardBoard[];
  starboard?: IStarboardBoard;

  onboardingComplete: boolean;
  onboardingStep: number;

  // timestamps
  createdAt: Date;
  updatedAt: Date;
}

export interface IModerationLogMetadata {
  roleId?: string;
  roleName?: string;
  messageCount?: number;
  channelId?: string;
  channelName?: string;
  slowmodeSeconds?: number;
  oldNickname?: string;
  newNickname?: string;
  warningId?: string;
  caseNumber?: number;
  honeypotChannelId?: string;
  warningCount?: number;
  keyword?: string;
}

export const MODERATION_ACTIONS = [
  'ban',
  'unban',
  'kick',
  'mute',
  'unmute',
  'warn',
  'unwarn',
  'clearwarn',
  'slowmode',
  'unlock',
  'purge',
  'softban',
  'tempban',
  'tempmute',
  'timeout',
  'nickname',
  'role',
  'role_add',
  'role_remove',
  'other',
] as const;
export type ModerationAction = (typeof MODERATION_ACTIONS)[number];

export interface IModerationLog {
  guildId: string;
  userId: string;
  targetId: string;
  action: ModerationAction;
  reason: string;
  duration: number | null;
  metadata: IModerationLogMetadata;
  timestamp: Date;
  viaDashboard: boolean;
}

export interface IWarningEntry {
  modId: string;
  reason: string;
  date: Date;
  active: boolean;
}

export interface IWarning {
  userId: string;
  guildId: string;
  warnings: IWarningEntry[];
}

export interface INoteEntry {
  modId: string;
  content: string;
  date: Date;
}

export interface INote {
  userId: string;
  guildId: string;
  notes: INoteEntry[];
}

export interface ITranscriptAttachment {
  url: string;
  name: string;
}

export interface ITranscriptMessage {
  authorId: string;
  authorName: string;
  avatarURL: string | null;
  content: string;
  attachments: ITranscriptAttachment[];
  timestamp: Date;
}

export interface ITicket {
  guildId: string;
  channelId: string;
  openedBy: string;
  ticketNumber: number;
  subject: string | null;
  status: 'open' | 'closed';
  claimedBy: string | null;
  claimedAt: Date | null;
  closedBy: string | null;
  closedAt: Date | null;
  participants: string[];
  transcript: ITranscriptMessage[];

  // timestamps
  createdAt: Date;
  updatedAt: Date;
}

export interface IChannelOverwriteSnapshot {
  channelId: string;
  roleId: string | null;
  previousAllow: string;
  previousDeny: string;
  hadOverwrite: boolean;
}

export interface ILockdownState {
  guildId: string;
  active: boolean;
  phase?: 'idle' | 'locking' | 'active' | 'unlocking';
  lockedBy: string | null;
  lockedAt: Date | null;
  channelSnapshots: IChannelOverwriteSnapshot[];
  invitesWereDisabled: boolean;

  // timestamps
  createdAt: Date;
  updatedAt: Date;
}
