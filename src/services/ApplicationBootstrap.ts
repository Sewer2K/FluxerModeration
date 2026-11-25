import type { Client } from '@fluxerjs/core';
import * as autoroleQueue from '@/utils/autoroleQueue';
import * as embedQueue from '@/utils/embedQueue';
import * as roleQueue from '@/utils/roleQueue';
import * as moderationQueue from '@/utils/moderationQueue';
import * as messageDeleteQueue from '@/utils/messageDeleteQueue';
import settingsCache from '@/utils/settingsCache';
import GuildSettings from '@/models/GuildSettings';
import log from '@/utils/consoleLogger';
import rssPollerService from '@/services/RssPollerService';
import socialPollerService from '@/services/SocialPollerService';
import config from '@/config';
import { messageFromError } from '@/utils/messageFromError';
import statsService from '@/services/StatsService';
import * as memberCounter from '@/utils/memberCounter';
import { restoreVerificationSessions } from '@/commands/admin/verify';
import { restoreRaidInviteLocks } from '@/utils/raidDetector';
import activityService from '@/services/ActivityService';
import { repairTicketCategoryPermissions } from '@/services/TicketPermissionService';

async function warmSettingsCache(client: Client): Promise<void> {
  const guildIds = [...(client.guilds?.keys() || [])];
  if (!guildIds.length) return;

  const start = Date.now();
  const BATCH_SIZE = 100;
  let loaded = 0;

  for (let i = 0; i < guildIds.length; i += BATCH_SIZE) {
    const batch = guildIds.slice(i, i + BATCH_SIZE);
    try {
      const docs = await GuildSettings.find({ guildId: { $in: batch } }).lean();
      for (const doc of docs) {
        settingsCache.set(doc.guildId, doc);
        loaded++;
      }
    } catch (err: unknown) {
      log.warn('Cache', `Warm batch failed: ${messageFromError(err)}`);
    }
    if (i + BATCH_SIZE < guildIds.length) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  log.ok('Cache', `Warmed ${loaded}/${guildIds.length} guild settings (${Date.now() - start}ms)`);
}

const HEARTBEAT_INTERVAL = 5 * 60 * 1000;
const STARTUP_DELAY_MS = 25_000;

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function printStatus(client: Client, startedAt: number): void {
  const memMB = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);
  const uptime = formatUptime(Date.now() - startedAt);
  const guilds = client.guilds?.size || 0;
  const cache = settingsCache.getStats();

  log.box(config.branding.publicName, [
    { label: 'Status', value: 'Online' },
    { label: 'Uptime', value: uptime },
    { label: 'Guilds', value: String(guilds) },
    { label: 'Memory', value: `${memMB} MB` },
    { label: 'Cache', value: `${cache.validEntries}/${guilds} guilds cached` },
  ]);
}

let startupScheduled = false;
let lastSnapshotHour = -1;

function recordSnapshot(client: Client): void {
  const guildCount = client.guilds?.size ?? 0;
  let memberTotal = 0;
  for (const guildId of client.guilds?.keys() ?? []) {
    const count = memberCounter.get(guildId) ?? 0;
    memberTotal += count;
    if (count > 0) {
      statsService.recordGuildMemberSnapshot(guildId, count).catch(() => {});
    }
  }
  statsService.recordGuildSnapshot(guildCount, memberTotal).catch(() => {});
}

export function startApplicationOnce(client: Client): boolean {
  if (startupScheduled) return false;
  startupScheduled = true;

  restoreVerificationSessions(client).catch((err: unknown) => {
    log.warn('Verification', `Failed to restore pending sessions: ${messageFromError(err)}`);
  });
  restoreRaidInviteLocks(client).catch((err: unknown) => {
    log.warn('Raid', `Failed to restore invite lock timers: ${messageFromError(err)}`);
  });

  activityService.start();

  const startedAt = Date.now();
  printStatus(client, startedAt);

  setTimeout(() => {
    autoroleQueue.start(client);
    embedQueue.start(client);
    roleQueue.start(client);
    moderationQueue.start(client);
    messageDeleteQueue.start(client);
    rssPollerService.start(client);
    socialPollerService.start(client);
    void import('./LevelHighlightService').then(({ startLevelHighlightService }) => {
      startLevelHighlightService(client);
    });
    log.ok('Startup', 'Queues started');

    lastSnapshotHour = new Date().getUTCHours();
    recordSnapshot(client);

    warmSettingsCache(client).catch((err: unknown) => {
      log.warn('Cache', `Warm failed: ${messageFromError(err)}`);
    });
    repairTicketCategoryPermissions(client).catch((err: unknown) => {
      log.warn('Tickets', `Category permission repair failed: ${messageFromError(err)}`);
    });
  }, STARTUP_DELAY_MS);

  setInterval(() => {
    printStatus(client, startedAt);

    const currentHour = new Date().getUTCHours();
    if (currentHour !== lastSnapshotHour) {
      lastSnapshotHour = currentHour;
      recordSnapshot(client);
    }
  }, HEARTBEAT_INTERVAL);

  return true;
}
