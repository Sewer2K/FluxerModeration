import type { AutomodSettings, IGuildSettings } from '@/types/GuildSettings';
import type { Client, Guild, Message, MessageReaction } from '@fluxerjs/core';

export interface AutomodAntiSpamConfig {
  maxMessages: number;
  timeWindow: number;
  timeoutDuration: number;
  violationThreshold: number;
  violationWindow: number;
}

export interface AutomodSpamViolation {
  count: number;
  shouldTimeout: boolean;
}

export interface AutomodSpamCheckResult {
  isSpam: boolean;
  messageIds: string[] | null;
  count: number;
}

export interface AutomodSpamActionInfo {
  deletedCount: number;
  violation: AutomodSpamViolation;
  config: AutomodAntiSpamConfig;
  timedOut: boolean;
  language: string;
}

export interface IAntiRaidAutomodRaidEntry {
  userId: string;
  messageId: string;
  channelId: string;
  timestamp: number;
}
export interface IAntiRaidAutomodTrackedRaid {
  isRaid: boolean;
  allEntries: IAntiRaidAutomodRaidEntry[];
  newRaid: boolean;
}

export interface AutomodAntiReactionSpamConfig {
  maxReactions: number;
  timeWindow: number;
  timeoutDuration: number;
  violationThreshold: number;
  violationWindow: number;
}

export type AutomodReactionSpamViolation = AutomodSpamViolation;

export interface IAntiReactionSpamAction {
  violation: AutomodSpamViolation;
  config: AutomodAntiReactionSpamConfig;
  timedOut: boolean;
  language: string | null | undefined;
}

export interface IAutomodModule {
  // unused
  name?: string;
  // unused
  description?: string;
}

export interface IAntiLinkAutomodModule extends IAutomodModule {
  check(message: Message, client: Client, settings: IGuildSettings, automodSettings: AutomodSettings): Promise<boolean>;
  execute(
    message: Message,
    client: Client,
    settings: IGuildSettings,
    _automodSettings: AutomodSettings,
    blockedLinks: readonly string[],
  ): Promise<void>;
  logAction(
    message: Message,
    client: Client,
    settings: IGuildSettings,
    blockedLinks: readonly string[],
    logChannelId: string,
  ): Promise<void>;
}

export interface IAntiSpamAutomodModule extends IAutomodModule {
  check(message: Message, client: Client, settings: IGuildSettings, automodSettings: AutomodSettings): Promise<boolean>;
  execute(
    message: Message,
    client: Client,
    settings: IGuildSettings,
    automodSettings: AutomodSettings,
    spamResult: AutomodSpamCheckResult,
    config?: AutomodAntiSpamConfig,
  ): Promise<void>;
  logAction(
    message: Message,
    client: Client,
    guild: Guild | null | undefined,
    logChannelId: string,
    info: AutomodSpamActionInfo,
  ): Promise<void>;
  checkSpam: (
    guildId: string,
    userId: string,
    messageId: string,
    maxMessages: number,
    windowMs: number,
  ) => AutomodSpamCheckResult;
  resetSpamTracker: (guildId: string, userId: string) => void;
  trackViolation: (guildId: string, userId: string, config: AutomodAntiSpamConfig) => AutomodSpamViolation;
  clearViolations: (guildId: string, userId: string) => void;
  defaultConfig: AutomodAntiSpamConfig;
}

export interface IAntiRaidAutomodModule extends IAutomodModule {
  // methods
  check(message: Message, client: Client, settings: IGuildSettings): Promise<boolean>;

  // global functions
  normalizeContent: (content: string) => string;
  trackRaidMessage: (
    guildId: string,
    normalized: string,
    entry: IAntiRaidAutomodRaidEntry,
    windowMs: number,
    threshold: number,
  ) => IAntiRaidAutomodTrackedRaid;
  isActiveRaid: (guildId: string, normalized: string) => boolean;
  clearRaidState: (guildId: string) => void;

  // global constants
  readonly DEFAULT_USER_THRESHOLD: number;
  readonly DEFAULT_TIME_WINDOW: number;
}

export interface IKeywordWarningAutomodModule extends IAutomodModule {
  // methods
  check(message: Message, client: Client, settings: IGuildSettings): Promise<boolean>;
}

export interface IAntiReactionSpamAutomodModule extends IAutomodModule {
  check(
    guild: Guild,
    userId: string,
    reaction: MessageReaction,
    client: Client,
    settings: IGuildSettings,
  ): Promise<boolean>;
  logAction(
    guild: Guild,
    userId: string,
    reaction: MessageReaction,
    client: Client,
    logChannelId: string,
    info: IAntiReactionSpamAction,
  ): Promise<void>;
  checkReactionSpam: (
    guildId: string,
    userId: string,
    maxReactions: number,
    windowMs: number,
  ) => {
    isSpam: boolean;
    count: number;
  };
  resetTracker: (guildId: string, userId: string) => void;
  trackViolation: (guildId: string, userId: string, config: AutomodAntiReactionSpamConfig) => AutomodSpamViolation;
  clearViolations: (guildId: string, userId: string) => void;
  defaultConfig: AutomodAntiReactionSpamConfig;
}
