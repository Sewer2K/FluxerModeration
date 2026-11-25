import { join } from 'path';
import { existsSync } from 'fs';
import { execSync } from 'child_process';
import dotenv from 'dotenv';
import type { BotBrandingConfig, BotConfig } from './types';
import {
  RSS_DEFAULT_POLL_INTERVAL_MINUTES,
  RSS_MAX_FEEDS_PER_GUILD,
  RSS_MIN_POLL_INTERVAL_MINUTES,
} from './utils/rssDefaults';
import appPackage from '@/../package.json';

dotenv.config();
if (existsSync('.env.dev')) {
  dotenv.config({ path: '.env.dev', override: true });
}

const appVersion = appPackage.version;

let gitSha = '';
try {
  gitSha = execSync('git rev-parse --short HEAD', { stdio: ['pipe', 'pipe', 'ignore'] })
    .toString()
    .trim();
} catch {}

class Branding implements BotBrandingConfig {
  publicName: string;
  fullName: string;
  dataName: string;
  rssUserAgentName: string;
  socialsUserAgentName: string;
  docsUrl: string;
  dashboardUrl: string;

  constructor() {
    this.publicName = process.env.BRANDING_PUBLIC_NAME || 'ClaudeCityMod';
    this.fullName = process.env.BRANDING_FULL_NAME || this.publicName;
    this.dataName = process.env.BRANDING_DATA_NAME || 'claudecitymod';

    // user agents appear to support whitespace in names but this can look untidy with the appended "RSS"
    this.rssUserAgentName = process.env.BRANDING_RSS_USER_AGENT_NAME || `${this.publicName.replaceAll(/\s/g, '')}RSS`;
    this.socialsUserAgentName = process.env.BRANDING_SOCIALS_USER_AGENT_NAME || this.publicName.replaceAll(/\s/g, '');
    this.dashboardUrl = process.env.DASHBOARD_URL || `http://localhost:${process.env.API_PORT || '4000'}`;
    this.docsUrl = process.env.BRANDING_DOCS_URL || this.dashboardUrl;
  }
}

const config: BotConfig = {
  token: process.env.TOKEN || '',
  prefix: process.env.PREFIX || '!',
  branding: new Branding(),
  appVersion: (typeof appVersion === 'string' && appVersion ? appVersion : '0.0.0') + (gitSha ? `-${gitSha}` : ''),
  ownerId: process.env.OWNER_ID || null,
  terminationAppealTag: process.env.TERMINATION_APPEAL_TAG || '',
  mongoUri: process.env.MONGO_URI || '',
  access: {
    allowedGuildId: process.env.ALLOWED_GUILD_ID || null,
    dashboardAllowedUserIds: (process.env.DASHBOARD_ALLOWED_USER_IDS || '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
  },
  logLevel: process.env.LOG_LEVEL || 'info',
  cooldown: {
    default: parseInt(process.env.COOLDOWN_DEFAULT || '3000', 10),
  },
  automod: {
    maxMessages: parseInt(process.env.AUTOMOD_MAX_MESSAGES || '5', 10),
    timeWindow: parseInt(process.env.AUTOMOD_TIME_WINDOW || '5', 10),
    muteDuration: parseInt(process.env.AUTOMOD_MUTE_DURATION || '10', 10),
  },
  api: {
    enabled: process.env.API_ENABLED === 'true',
    port: parseInt(process.env.API_PORT || '4000', 10),
    adminToken: process.env.API_ADMIN_TOKEN || null,
    dashboardUrl: process.env.DASHBOARD_URL || null,
    appealSigningSecret: process.env.APPEAL_SIGNING_SECRET || process.env.API_ADMIN_TOKEN || '',
  },
  process: {
    mode: (process.env.CCM_PROCESS || 'all') as 'bot' | 'web' | 'all',
    passiveMode: process.env.CCM_PASSIVE_MODE === '1',
  },
  bot: {
    internalPort: parseInt(process.env.BOT_INTERNAL_PORT || '4001', 10),
    internalUrl: process.env.BOT_INTERNAL_URL || 'http://127.0.0.1:4001',
    internalBind: process.env.BOT_INTERNAL_BIND || '127.0.0.1',
    gatewaySessionPath: process.env.GATEWAY_SESSION_PATH || join(process.cwd(), '.gateway-session.json'),
  },
  fluxerOAuth: {
    clientId: process.env.FLUXER_OAUTH_CLIENT_ID || null,
    clientSecret: process.env.FLUXER_OAUTH_CLIENT_SECRET || null,
    redirectUri: process.env.FLUXER_OAUTH_REDIRECT_URI || null,
  },
  rss: {
    enabled: process.env.RSS_ENABLED !== 'false',
    defaultPollIntervalMinutes: parseInt(
      process.env.RSS_DEFAULT_POLL_INTERVAL_MINUTES || String(RSS_DEFAULT_POLL_INTERVAL_MINUTES),
      10,
    ),
    minPollIntervalMinutes: parseInt(
      process.env.RSS_MIN_POLL_INTERVAL_MINUTES || String(RSS_MIN_POLL_INTERVAL_MINUTES),
      10,
    ),
    maxFeedsPerGuild: parseInt(process.env.RSS_MAX_FEEDS_PER_GUILD || String(RSS_MAX_FEEDS_PER_GUILD), 10),
    fetchTimeoutMs: parseInt(process.env.RSS_FETCH_TIMEOUT_MS || '10000', 10),
    maxBodyBytes: parseInt(process.env.RSS_MAX_BODY_BYTES || String(1024 * 1024), 10),
    maxConcurrentFetches: parseInt(process.env.RSS_MAX_CONCURRENT_FETCHES || '8', 10),
    rsshubBaseUrl: process.env.RSSHUB_BASE_URL || 'https://rsshub.app',
    rsshubAccessKey: process.env.RSSHUB_ACCESS_KEY || null,
  },
  instance: {
    api: process.env.FLUXER_INSTANCE_API || null,
    gateway: process.env.FLUXER_INSTANCE_GATEWAY || null,
    web: process.env.FLUXER_INSTANCE_WEB || null,
    media: process.env.FLUXER_INSTANCE_MEDIA || null,
  },
  glitchtip: {
    dsn: process.env.GLITCHTIP_DSN || null,
    environment: process.env.GLITCHTIP_ENVIRONMENT || process.env.NODE_ENV || 'production',
  },
  validate(): boolean {
    const required: [string, string][] = [
      ['TOKEN', this.token],
      ['MONGO_URI', this.mongoUri],
    ];

    let valid = true;
    for (const [name, value] of required) {
      if (!value) {
        console.error(`Missing required environment variable: ${name}`);
        valid = false;
      }
    }

    return valid;
  },
};

export default config;
