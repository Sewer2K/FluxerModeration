export interface BotBrandingConfig {
  publicName: string;
  fullName: string;
  dataName: string;
  rssUserAgentName: string;
  socialsUserAgentName: string;
  docsUrl: string;
  dashboardUrl: string;
}

export interface BotConfig {
  token: string;
  prefix: string;
  appVersion: string;
  ownerId: string | null;
  terminationAppealTag: string;
  mongoUri: string;
  access: {
    /** When set, the bot leaves every other guild and refuses commands there. */
    allowedGuildId: string | null;
    /** Extra Fluxer user IDs allowed into the dashboard, on top of the owner. */
    dashboardAllowedUserIds: string[];
  };
  logLevel: string;
  branding: BotBrandingConfig;
  cooldown: {
    default: number;
  };
  automod: {
    maxMessages: number;
    timeWindow: number;
    muteDuration: number;
  };
  api: {
    enabled: boolean;
    port: number;
    adminToken: string | null;
    dashboardUrl: string | null;
    appealSigningSecret: string;
  };
  process: {
    mode: 'bot' | 'web' | 'all';
    passiveMode: boolean;
  };
  bot: {
    internalPort: number;
    internalUrl: string;
    internalBind: string;
    gatewaySessionPath: string;
  };
  fluxerOAuth: {
    clientId: string | null;
    clientSecret: string | null;
    redirectUri: string | null;
  };
  rss: {
    enabled: boolean;
    defaultPollIntervalMinutes: number;
    minPollIntervalMinutes: number;
    maxFeedsPerGuild: number;
    fetchTimeoutMs: number;
    maxBodyBytes: number;
    maxConcurrentFetches: number;
    rsshubBaseUrl: string;
    rsshubAccessKey: string | null;
  };
  instance: {
    api: string | null;
    gateway: string | null;
    web: string | null;
    media: string | null;
  };
  glitchtip: {
    dsn: string | null;
    environment: string;
  };
  validate(): boolean;
}
