import { Schema, model, Document, Model } from 'mongoose';
import { randomUUID } from 'crypto';
import type {
  IGuildSettings,
  IKeywordEntry,
  IKeywordWarnings,
  IHoneypotEntry,
  IStickyMessage,
  IWelcomeCard,
  IWelcomeEmbed,
  IWelcomeDM,
  IWelcomeMessage,
  IReactionRolesEntry,
  IReactionRolesRole,
  IModeration,
  IAppeals,
  ICustomCommand,
  IAutomodSpam,
  IAutomodRaid,
  IAutomod,
  IGoodbyeEmbed,
  IGoodbyeMessage,
  ILogChannelOverrides,
  IVerification,
  IStarboardBoard,
  IActivityRole,
  ILeveling,
  ILevelRole,
  ISocialNotification,
  IRssSettings,
  IRssFeed,
} from '@/types';
import {
  RSS_DEFAULT_ITEMS_PER_POLL,
  RSS_DEFAULT_POLL_INTERVAL_MINUTES,
  RSS_MAX_FEEDS_PER_GUILD,
  RSS_MAX_ITEMS_PER_POLL,
  RSS_MIN_POLL_INTERVAL_MINUTES,
} from '@/utils/rssDefaults';
import { isArray } from '@/utils/isArray';

const CUSTOM_COMMAND_MAX_PER_GUILD = 15;
const CUSTOM_COMMAND_PERMISSION_VALUES = [
  'Administrator',
  'ManageGuild',
  'ManageRoles',
  'ManageChannels',
  'ManageMessages',
  'KickMembers',
  'BanMembers',
  'ModerateMembers',
] as const;
const CUSTOM_COMMAND_ACTION_VALUES = ['reply', 'toggleRole', 'addRole', 'removeRole', 'sendDM'] as const;

const keywordEntrySchema = new Schema<IKeywordEntry>(
  {
    pattern: { type: String, required: true },
    isRegex: { type: Boolean, default: false },
    matchType: { type: String, enum: ['any', 'word'], default: 'any' },
    label: { type: String, default: null },
    addedBy: { type: String, default: null },
    action: { type: String, enum: ['inherit', 'delete', 'warn', 'delete+warn', 'mute', 'ban'], default: 'inherit' },
  },
  { _id: false },
);

const keywordWarningsSchema = new Schema<IKeywordWarnings>(
  {
    enabled: { type: Boolean, default: false },
    action: { type: String, enum: ['delete', 'warn', 'delete+warn'], default: 'delete+warn' },
    keywords: { type: [keywordEntrySchema], default: [] },
  },
  { _id: false },
);

const honeypotEntrySchema = new Schema<IHoneypotEntry>(
  {
    channelId: { type: String, required: true },
    action: { type: String, enum: ['ban', 'kick', 'timeout', 'role'], default: 'ban' },
    enabled: { type: Boolean, default: true },
    banDeleteDays: { type: Number, default: 1, min: 0, max: 7 },
    timeoutHours: { type: Number, default: 24, min: 1, max: 672 },
    roleId: { type: String, default: null },
  },
  { _id: false },
);

const STICKY_MESSAGE_MAX_PER_GUILD = 15;

const stickyMessageSchema = new Schema<IStickyMessage>(
  {
    channelId: { type: String, required: true },
    enabled: { type: Boolean, default: true },
    content: { type: String, default: null, maxlength: 2000 },
  },
  { _id: false },
);

const welcomeCardSchema = new Schema<IWelcomeCard>(
  {
    preset: {
      type: String,
      enum: ['default', 'dark', 'light', 'ocean', 'sunset', 'midnight', 'forest'],
      default: null,
    },
    bgColor1: { type: String, default: null },
    bgColor2: { type: String, default: null },
    bgColor3: { type: String, default: null },
    accentColor: { type: String, default: null },
    textColor: { type: String, default: null },
    subtextColor: { type: String, default: null },
    countColor: { type: String, default: null },
    greetingText: { type: String, default: null },
    subtitle: { type: String, default: null },
    showMemberCount: { type: Boolean, default: true },
    bgImageURL: { type: String, default: null },
  },
  { _id: false },
);

const welcomeEmbedSchema = new Schema<IWelcomeEmbed>(
  {
    enabled: { type: Boolean, default: false },
    title: { type: String, default: null },
    description: { type: String, default: null },
    color: { type: String, default: null },
    footer: { type: String, default: null },
    thumbnail: { type: Boolean, default: false },
  },
  { _id: false },
);

const welcomeDMSchema = new Schema<IWelcomeDM>(
  {
    enabled: { type: Boolean, default: false },
    message: { type: String, default: null },
    imageEnabled: { type: Boolean, default: false },
  },
  { _id: false },
);

const welcomeMessageSchema = new Schema<IWelcomeMessage>(
  {
    enabled: { type: Boolean, default: false },
    type: {
      type: String,
      enum: ['none', 'preset', 'custom'],
      default: 'none',
    },
    channelId: { type: String, default: null },
    message: { type: String, default: null },
    preset: { type: String, default: null },
    imageEnabled: { type: Boolean, default: true },
    card: { type: welcomeCardSchema, default: () => ({}) },
    embed: { type: welcomeEmbedSchema, default: () => ({}) },
    dm: { type: welcomeDMSchema, default: () => ({}) },
    showRole: { type: Boolean, default: false },
    trigger: { type: String, enum: ['join', 'role'], default: 'join' },
    triggerRoleId: { type: String, default: null },
  },
  { _id: false },
);

const reactionRoleEntrySchema = new Schema<IReactionRolesRole>(
  {
    emoji: { type: String, required: true },
    roleId: { type: String, required: true },
    roleIds: { type: [String] },
    removeRoleId: { type: String, default: null },
  },
  { _id: false },
);

const reactionRoleSchema = new Schema<IReactionRolesEntry>(
  {
    messageId: { type: String, required: true },
    channelId: { type: String, required: true },
    title: { type: String, default: null },
    description: { type: String, default: null },
    plainText: { type: Boolean, default: false },
    roles: [reactionRoleEntrySchema],
  },
  { _id: false },
);

const moderationSchema = new Schema<IModeration>(
  {
    muteRoleId: { type: String, default: null },
    logChannelId: { type: String, default: null },
    autoMute: { type: Boolean, default: false },
    autoMuteThreshold: { type: Number, default: 3, min: 1, max: 20 },
    muteMethod: { type: String, enum: ['auto', 'timeout', 'mute_role'], default: 'auto' },
    logStyle: { type: String, enum: ['embed', 'text'], default: 'embed' },
  },
  { _id: false },
);

const appealsSchema = new Schema<IAppeals>(
  {
    enabled: { type: Boolean, default: false },
    channelId: { type: String, default: null },
    cooldownDays: { type: Number, default: 7, min: 0, max: 365 },
    allowTempBans: { type: Boolean, default: false },
    defaultNoAppeal: { type: Boolean, default: false },
  },
  { _id: false },
);

const customCommandSchema = new Schema<ICustomCommand>(
  {
    name: { type: String, required: true },
    response: { type: String, required: true },
    embed: { type: Boolean, default: false },
    color: { type: String, default: null },
    title: { type: String, default: null },
    enabled: { type: Boolean, default: true },
    actionType: {
      type: String,
      enum: CUSTOM_COMMAND_ACTION_VALUES,
      default: 'reply',
    },
    targetRoleId: { type: String, default: null },
    requiredRoleIds: { type: [String], default: [] },
    requiredPermission: {
      type: String,
      enum: CUSTOM_COMMAND_PERMISSION_VALUES,
      default: null,
    },
    allowedChannelIds: { type: [String], default: [] },
    cooldownSeconds: { type: Number, default: 0, min: 0, max: 3600 },
    deleteTrigger: { type: Boolean, default: false },
  },
  { _id: false },
);

const automodSpamSchema = new Schema<IAutomodSpam>(
  {
    maxMessages: { type: Number, default: 5, min: 2, max: 20 },
    timeWindow: { type: Number, default: 5, min: 1, max: 60 },
    timeoutDuration: { type: Number, default: 10, min: 1, max: 1440 },
    violationThreshold: { type: Number, default: 3, min: 1, max: 10 },
  },
  { _id: false },
);

const automodRaidSchema = new Schema<IAutomodRaid>(
  {
    userThreshold: { type: Number, default: 5, min: 2, max: 50 },
    timeWindow: { type: Number, default: 10, min: 1, max: 120 },
    action: { type: String, enum: ['alert', 'kick', 'ban'], default: 'alert' },
    kickBots: { type: Boolean, default: false },
    minAccountAgeDays: { type: Number, default: 0, min: 0, max: 365 },
    accountAgeAction: { type: String, enum: ['alert', 'kick', 'ban'], default: 'kick' },
    autoLockdownInvites: { type: Boolean, default: false },
  },
  { _id: false },
);

const automodSchema = new Schema<IAutomod>(
  {
    level: {
      type: String,
      enum: ['off', 'minimal', 'medium', 'high'],
      default: 'off',
    },
    antiSpam: { type: Boolean, default: false },
    antiLink: { type: Boolean, default: false },
    antiReactionSpam: { type: Boolean, default: false },
    ghostPing: { type: Boolean, default: false },
    maxMentions: { type: Number, default: 5, min: 0, max: 50 },
    maxLines: { type: Number, default: 10, min: 0, max: 100 },
    spam: { type: automodSpamSchema, default: () => ({}) },
    raid: { type: automodRaidSchema, default: () => ({}) },
    allowedDomains: { type: [String], default: [] },
    exemptRoles: { type: [String], default: [] },
    exemptChannels: { type: [String], default: [] },
  },
  { _id: false },
);

const verificationSchema = new Schema<IVerification>(
  {
    enabled: { type: Boolean, default: false },
    categoryId: { type: String, default: null },
    verifiedRoleId: { type: String, default: null },
    panelChannelId: { type: String, default: null },
    panelMessageId: { type: String, default: null },
    logChannelId: { type: String, default: null },
    maxAttempts: { type: Number, default: 2, min: 1, max: 5 },
  },
  { _id: false },
);

const rssFeedSchema = new Schema<IRssFeed>(
  {
    id: { type: String, default: () => randomUUID(), required: true },
    name: { type: String, default: null },
    sourceType: { type: String, enum: ['rss', 'rsshub'], default: 'rss' },
    url: { type: String, default: null },
    route: { type: String, default: null },
    channelId: { type: String, required: true },
    mentionRoleId: { type: String, default: null },
    webhookId: { type: String, default: null },
    webhookToken: { type: String, default: null },
    webhookName: { type: String, default: null },
    enabled: { type: Boolean, default: true },
    maxItemsPerPoll: {
      type: Number,
      default: RSS_DEFAULT_ITEMS_PER_POLL,
      min: 1,
      max: RSS_MAX_ITEMS_PER_POLL,
    },
    includeSummary: { type: Boolean, default: true },
    includeImage: { type: Boolean, default: true },
    format: { type: String, enum: ['embed', 'text'], default: 'embed' },
    sendAs: { type: String, enum: ['webhook', 'bot'], default: 'webhook' },
  },
  { _id: false },
);

const rssSettingsSchema = new Schema<IRssSettings>(
  {
    enabled: { type: Boolean, default: false },
    pollIntervalMinutes: {
      type: Number,
      default: RSS_DEFAULT_POLL_INTERVAL_MINUTES,
      min: RSS_MIN_POLL_INTERVAL_MINUTES,
      max: 1440,
    },
    feeds: {
      type: [rssFeedSchema],
      default: [],
      validate: {
        validator: function (v: IRssFeed[]) {
          return v.length <= RSS_MAX_FEEDS_PER_GUILD;
        },
        message: `Cannot have more than ${RSS_MAX_FEEDS_PER_GUILD} RSS feeds`,
      },
    },
  },
  { _id: false },
);

const socialNotificationSchema = new Schema<ISocialNotification>(
  {
    id: { type: String, required: true, default: () => randomUUID() },
    platform: { type: String, enum: ['youtube', 'tiktok'], required: true },
    channelOrUsername: { type: String, required: true },
    postChannelId: { type: String, required: true },
    message: { type: String, default: null },
    enabled: { type: Boolean, default: true },
  },
  { _id: false },
);

const activityRoleSchema = new Schema<IActivityRole>(
  {
    enabled: { type: Boolean, default: false },
    messageThreshold: { type: Number, default: 100, min: 1, max: 10000 },
    roleId: { type: String, default: null },
  },
  { _id: false },
);

const levelRoleSchema = new Schema<ILevelRole>(
  {
    level: { type: Number, required: true, min: 1, max: 1000 },
    roleId: { type: String, required: true },
  },
  { _id: false },
);

const levelingSchema = new Schema<ILeveling>(
  {
    enabled: { type: Boolean, default: false },
    leaderboardVanity: { type: String },
    formula: {
      curve: { type: String, enum: ['linear', 'quadratic'], default: 'quadratic' },
      multiplier: { type: Number, default: 1, min: 0.1, max: 10 },
      maxLevel: { type: Number, default: null, min: 1, max: 1000 },
    },
    messageXp: {
      enabled: { type: Boolean, default: true },
      mode: { type: String, enum: ['random', 'per_word'], default: 'random' },
      min: { type: Number, default: 15, min: 1, max: 500 },
      max: { type: Number, default: 25, min: 1, max: 500 },
      cooldownSeconds: { type: Number, default: 60, min: 5, max: 3600 },
      quality: {
        enabled: { type: Boolean, default: true },
        minCharacters: { type: Number, default: 12, min: 0, max: 500 },
        minWords: { type: Number, default: 2, min: 0, max: 50 },
        minUniqueCharacters: { type: Number, default: 4, min: 1, max: 50 },
        ignoreCommands: { type: Boolean, default: true },
        ignoreOnlyEmojis: { type: Boolean, default: true },
        ignoreOnlyAttachments: { type: Boolean, default: true },
        duplicateWindowSeconds: { type: Number, default: 300, min: 30, max: 3600 },
        maxDuplicateMatches: { type: Number, default: 2, min: 1, max: 20 },
        burstWindowSeconds: { type: Number, default: 20, min: 5, max: 120 },
        burstMaxMessages: { type: Number, default: 4, min: 2, max: 20 },
        maxWordsCounted: { type: Number, default: 25, min: 1, max: 200 },
      },
    },
    voiceXp: {
      enabled: { type: Boolean, default: false },
      min: { type: Number, default: 15, min: 1, max: 500 },
      max: { type: Number, default: 40, min: 1, max: 500 },
      cooldownSeconds: { type: Number, default: 180, min: 30, max: 3600 },
      minimumMembers: { type: Number, default: 2, min: 1, max: 99 },
      antiAfk: { type: Boolean, default: false },
    },
    reactionXp: {
      enabled: { type: Boolean, default: false },
      awards: { type: String, enum: ['both', 'send', 'receive'], default: 'both' },
      min: { type: Number, default: 25, min: 1, max: 500 },
      max: { type: Number, default: 25, min: 1, max: 500 },
      cooldownSeconds: { type: Number, default: 300, min: 5, max: 3600 },
    },
    levelUp: {
      enabled: { type: Boolean, default: true },
      template: {
        type: String,
        default: '{user.mention} has reached level **{user.level}**. GG!',
      },
      channelMode: { type: String, enum: ['message', 'specific'], default: 'message' },
      channelId: { type: String, default: null },
      includeImage: { type: Boolean, default: false },
    },
    levelRoles: { type: [levelRoleSchema], default: [] },
    stackRewards: { type: Boolean, default: true },
    firstPlaceRoleId: { type: String, default: null },
    highlights: {
      weeklyEnabled: { type: Boolean, default: false },
      weeklyChannelId: { type: String, default: null },
      monthlyEnabled: { type: Boolean, default: false },
      monthlyChannelId: { type: String, default: null },
    },
    rankCard: {
      progressColor: { type: String, default: '#6c72f8' },
      backgroundColor: { type: String, default: '#1a1a2e' },
      fontColor: { type: String, default: '#ffffff' },
      opacity: { type: Number, default: 100, min: 0, max: 100 },
    },
    restrictions: {
      noXpChannelMode: { type: String, enum: ['blacklist', 'whitelist'], default: 'blacklist' },
      noXpChannels: { type: [String], default: [] },
      noXpRoles: { type: [String], default: [] },
      textInVoiceXp: { type: Boolean, default: true },
    },
    management: {
      rankCommandOwnerOnly: { type: Boolean, default: false },
      resetOwnerOnly: { type: Boolean, default: false },
      resetOnLeave: { type: Boolean, default: false },
    },
  },
  { _id: false },
);

const starboardSchema = new Schema<IStarboardBoard>(
  {
    enabled: { type: Boolean, default: false },
    channelId: { type: String, default: null },
    threshold: { type: Number, default: 3, min: 1, max: 100 },
    emoji: { type: String, default: '⭐' },
    selfStarEnabled: { type: Boolean, default: false },
    ignoreBots: { type: Boolean, default: true },
    ignoredChannels: { type: [String], default: [] },
    ignoredRoles: { type: [String], default: [] },
  },
  { _id: false },
);

export interface GuildSettingsDocument extends IGuildSettings, Document {}

export interface GuildSettingsModel extends Model<GuildSettingsDocument> {
  getOrCreate(guildId: string): Promise<GuildSettingsDocument>;
  updateSetting(guildId: string, key: string, value: unknown): Promise<GuildSettingsDocument | null>;
  addReactionRole(guildId: string, reactionRole: IReactionRolesEntry): Promise<GuildSettingsDocument | null>;
  removeReactionRole(guildId: string, messageId: string): Promise<GuildSettingsDocument | null>;
  addPrefix(guildId: string, prefix: string): Promise<GuildSettingsDocument | null>;
  removePrefix(guildId: string, prefix: string): Promise<GuildSettingsDocument | null>;
}

const settingsSchema = new Schema<GuildSettingsDocument, GuildSettingsModel>(
  {
    guildId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    prefixes: {
      type: [String],
      default: () => [process.env.PREFIX || '!'],
      validate: {
        validator: function (v: string[]) {
          return v.length <= 15;
        },
        message: 'Cannot have more than 15 prefixes',
      },
    },

    language: { type: String, default: 'en' },

    welcomeMessage: { type: welcomeMessageSchema, default: () => ({}) },

    reactionRoles: { type: [reactionRoleSchema], default: [] },

    moderation: { type: moderationSchema, default: () => ({}) },

    appeals: { type: appealsSchema, default: () => ({}) },

    automod: { type: automodSchema, default: () => ({}) },

    // "legacy" kept for servers taht been wit me since the beginign do not remove or we will have a bad time
    automodEnabled: { type: Boolean, default: false },
    antiLink: { type: Boolean, default: false },
    antiSpam: { type: Boolean, default: false },
    antiGhostPing: { type: Boolean, default: false },

    logChannelId: { type: String, default: null },

    muteRoleId: { type: String, default: null },

    prefix: { type: String, default: null },

    reactionRoleDMEnabled: { type: Boolean, default: false },

    autoroleId: { type: String, default: null },
    raidDisableAutorole: { type: Boolean, default: false },
    raidInvitesWereDisabled: { type: Boolean, default: false },
    raidInviteUnlockAt: { type: Date, default: null },

    staffChannelId: { type: String, default: null },
    staffRoleId: { type: String, default: null },
    staffInboxChannelId: { type: String, default: null },

    keywordWarnings: { type: keywordWarningsSchema, default: () => ({}) },

    honeypotChannels: { type: [honeypotEntrySchema], default: [] },
    honeypotAlertRoleId: { type: String, default: null },
    stickyMessages: {
      type: [stickyMessageSchema],
      default: [],
      validate: {
        validator: function (v: IStickyMessage[]) {
          return v.length <= STICKY_MESSAGE_MAX_PER_GUILD;
        },
        message: `Cannot have more than ${STICKY_MESSAGE_MAX_PER_GUILD} sticky messages`,
      },
    },

    serverLogChannelId: { type: String, default: null },

    logChannelOverrides: {
      type: new Schema<ILogChannelOverrides>(
        {
          member: { type: String, default: null },
          voice: { type: String, default: null },
          message: { type: String, default: null },
          role: { type: String, default: null },
          channel: { type: String, default: null },
          reaction: { type: String, default: null },
          server: { type: String, default: null },
        },
        { _id: false },
      ),
      default: () => ({}),
    },

    disabledLogEvents: { type: [String], default: [] },
    messageLogIncludeLinks: { type: Boolean, default: true },

    blacklistedChannels: { type: [String], default: [] },

    ticketCategoryId: { type: String, default: null },
    ticketSupportRoleId: { type: String, default: null },
    ticketSupportRoleIds: { type: [String], default: [] },
    ticketLogChannelId: { type: String, default: null },
    ticketMaxOpen: { type: Number, default: 3, min: 1, max: 10 },
    ticketOpenMessage: { type: String, default: null },
    ticketSetupChannelId: { type: String, default: null },
    ticketSetupMessageId: { type: String, default: null },
    ticketEmoji: { type: String, default: '🎫' },

    customCommands: {
      type: [customCommandSchema],
      default: [],
      validate: {
        validator: function (v: ICustomCommand[]) {
          return v.length <= CUSTOM_COMMAND_MAX_PER_GUILD;
        },
        message: `Cannot have more than ${CUSTOM_COMMAND_MAX_PER_GUILD} custom commands`,
      },
    },

    goodbyeMessage: {
      type: new Schema<IGoodbyeMessage>(
        {
          enabled: { type: Boolean, default: false },
          channelId: { type: String, default: null },
          message: { type: String, default: null },
          embed: {
            type: new Schema<IGoodbyeEmbed>(
              {
                enabled: { type: Boolean, default: false },
                title: { type: String, default: null },
                description: { type: String, default: null },
                color: { type: String, default: null },
                footer: { type: String, default: null },
              },
              { _id: false },
            ),
            default: () => ({}),
          },
        },
        { _id: false },
      ),
      default: () => ({}),
    },

    lockdownRoles: { type: [String], default: [] },
    lockdownAllowedRoles: { type: [String], default: [] },
    lockdownAllowedUsers: { type: [String], default: [] },

    slowmodeAllowedRoles: { type: [String], default: [] },
    commandAllowedRoles: { type: [String], default: [] },

    globalBanEnabled: { type: Boolean, default: false },
    globalBanAutoApply: { type: Boolean, default: false },

    disabledCommands: { type: [String], default: [] },

    verification: { type: verificationSchema, default: () => ({}) },

    rss: { type: rssSettingsSchema, default: () => ({}) },
    activityRole: { type: activityRoleSchema, default: () => ({}) },
    leveling: { type: levelingSchema, default: () => ({}) },
    socialNotifications: { type: [socialNotificationSchema], default: [] },

    starboards: {
      type: [starboardSchema],
      default: [],
      validate: {
        validator: function (v: IStarboardBoard[]) {
          return v.length <= 3;
        },
        message: 'Cannot have more than 3 starboards',
      },
    },

    starboard: { type: starboardSchema, default: () => ({}) },

    onboardingComplete: { type: Boolean, default: false },
    onboardingStep: { type: Number, default: 0, min: 0 },
  },
  {
    timestamps: true,
  },
);

settingsSchema.pre('validate', function () {
  if (isArray(this.customCommands) && this.customCommands.length > CUSTOM_COMMAND_MAX_PER_GUILD) {
    this.customCommands = this.customCommands.slice(0, CUSTOM_COMMAND_MAX_PER_GUILD);
  }
});

settingsSchema.statics.getOrCreate = async function (guildId: string) {
  let settings = await this.findOne({ guildId });
  if (!settings) {
    settings = await this.create({ guildId });
  }
  return settings;
};

settingsSchema.statics.updateSetting = async function (guildId: string, key: string, value: unknown) {
  return this.findOneAndUpdate({ guildId }, { [key]: value }, { returnDocument: 'after', upsert: true });
};

settingsSchema.statics.addReactionRole = async function (guildId: string, reactionRole: IReactionRolesEntry) {
  return this.findOneAndUpdate(
    { guildId },
    { $push: { reactionRoles: reactionRole } },
    { returnDocument: 'after', upsert: true },
  );
};

settingsSchema.statics.removeReactionRole = async function (guildId: string, messageId: string) {
  return this.findOneAndUpdate({ guildId }, { $pull: { reactionRoles: { messageId } } }, { returnDocument: 'after' });
};

settingsSchema.statics.addPrefix = async function (guildId: string, prefix: string) {
  const settings = await this.findOne({ guildId });
  if (settings && settings.prefixes.length >= 15) {
    return null;
  }
  return this.findOneAndUpdate(
    { guildId },
    { $addToSet: { prefixes: prefix } },
    { returnDocument: 'after', upsert: true },
  );
};

settingsSchema.statics.removePrefix = async function (guildId: string, prefix: string) {
  return this.findOneAndUpdate({ guildId }, { $pull: { prefixes: prefix } }, { returnDocument: 'after' });
};

settingsSchema.index(
  { 'leveling.leaderboardVanity': 1 },
  { unique: true, sparse: true, name: 'leveling.leaderboardVanity_1' },
);

export default model<GuildSettingsDocument, GuildSettingsModel>('GuildSettings', settingsSchema);
