import os from 'os';
import { statfsSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import mongoose from 'mongoose';
import pidusage from 'pidusage';
import { EmbedBuilder } from '@fluxerjs/core';
import type { BotClient, Command } from '@/types';
import config from '@/config';
import Ticket from '@/models/Ticket';
import activityService from '@/services/ActivityService';
import logBuffer from '@/services/LogBuffer';
import rssPollerService from '@/services/RssPollerService';
import statsService from '@/services/StatsService';
import { getEventLoopMetrics, getGlitchTipErrorCount } from '@/services/RuntimeMetrics';
import { getTicketRuntimeState } from '@/commands/admin/ticket';
import * as autoroleQueue from '@/utils/autoroleQueue';
import * as embedQueue from '@/utils/embedQueue';
import * as messageDeleteQueue from '@/utils/messageDeleteQueue';
import * as moderationQueue from '@/utils/moderationQueue';
import * as roleQueue from '@/utils/roleQueue';
import { getGatewayManager, getGatewayPing, getGatewayShardCount } from '@/utils/gatewayPing';

const REFRESH_INTERVAL_MS = 10_000;
const TOTAL_SNAPSHOTS = 4;
const LOG_SAMPLE_SIZE = 250;

function formatNumber(value: number): string {
  return Math.max(0, Math.round(value)).toLocaleString('en-US');
}

function formatBytes(bytes: number): string {
  const megabytes = bytes / 1024 / 1024;
  if (megabytes < 1024) return `${megabytes.toFixed(1)} MB`;
  return `${(megabytes / 1024).toFixed(2)} GB`;
}

function formatDuration(seconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(seconds));
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const remainingSeconds = totalSeconds % 60;

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m ${remainingSeconds}s`;
  if (minutes > 0) return `${minutes}m ${remainingSeconds}s`;
  return `${remainingSeconds}s`;
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function databaseStatus(): string {
  switch (mongoose.connection.readyState) {
    case 1:
      return 'Connected';
    case 2:
      return 'Connecting';
    case 3:
      return 'Disconnecting';
    default:
      return 'Disconnected';
  }
}

interface DatabaseMetrics {
  status: string;
  latency: string;
  pool: string;
}

async function getDatabaseMetrics(): Promise<DatabaseMetrics> {
  const status = databaseStatus();
  let pool = 'Unavailable';

  try {
    const options = mongoose.connection.getClient().options;
    pool = `${options.minPoolSize ?? '?'} min / ${options.maxPoolSize ?? '?'} max`;
  } catch {}

  if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) {
    return { status, latency: 'Unavailable', pool };
  }

  try {
    const started = performance.now();
    await mongoose.connection.db.command({ ping: 1 });
    return { status, latency: `${Math.round(performance.now() - started)} ms`, pool };
  } catch {
    return { status, latency: 'Failed', pool };
  }
}

interface CommandActivityMetrics {
  lastHour: string;
  lastDay: string;
}

async function getCommandActivityMetrics(): Promise<CommandActivityMetrics> {
  if (mongoose.connection.readyState !== 1) {
    return { lastHour: 'Unavailable', lastDay: 'Unavailable' };
  }

  try {
    const [lastHour, lastDay] = await Promise.all([
      statsService.getCommandCount(1 / 24),
      statsService.getCommandCount(1),
    ]);
    return { lastHour: formatNumber(lastHour), lastDay: formatNumber(lastDay) };
  } catch {
    return { lastHour: 'Unavailable', lastDay: 'Unavailable' };
  }
}

async function getOpenTicketCount(): Promise<string> {
  if (mongoose.connection.readyState !== 1) return 'Unavailable';

  try {
    return formatNumber(await Ticket.countDocuments({ status: 'open' }));
  } catch {
    return 'Unavailable';
  }
}

function getDiskMetrics(): { used: string; total: string; percent: string } {
  try {
    const disk = statfsSync('/');
    const total = Number(disk.blocks) * Number(disk.bsize);
    const free = Number(disk.bavail) * Number(disk.bsize);
    const used = Math.max(0, total - free);
    const percent = total > 0 ? `${((used / total) * 100).toFixed(1)}%` : 'n/a';
    return { used: formatBytes(used), total: formatBytes(total), percent };
  } catch {
    return { used: 'Unavailable', total: 'Unavailable', percent: 'n/a' };
  }
}

function guildShardId(guildId: string, shardCount: number): number | null {
  try {
    return Number((BigInt(guildId) >> 22n) % BigInt(shardCount));
  } catch {
    return null;
  }
}

async function getShardSummary(client: BotClient, memory: NodeJS.MemoryUsage): Promise<string> {
  const gateway = getGatewayManager(client);
  const localShards = gateway?.shards;
  const configuredShardCount = Number(process.env.TOTAL_SHARDS);
  const shardCount =
    localShards?.size ||
    (Number.isInteger(configuredShardCount) && configuredShardCount > 0 ? configuredShardCount : 1);

  if (localShards?.size) {
    const guildCounts = new Map<number, number>();
    for (const guild of client.guilds.values()) {
      const shardId = guildShardId(guild.id, shardCount);
      if (shardId !== null) guildCounts.set(shardId, (guildCounts.get(shardId) ?? 0) + 1);
    }

    const lines = [...localShards.entries()].map(([shardId, shard]) => {
      const status = shard.sessionId ? 'online' : 'connecting';
      const ping = shard.ping ?? shard._ping;
      const pingText = typeof ping === 'number' && ping >= 0 ? `${ping} ms` : 'n/a';
      return `Shard ${shardId}: Status: \`${status}\` | Ping: \`${pingText}\` | Guilds: \`${formatNumber(guildCounts.get(shardId) ?? 0)}\` | Memory: \`${formatBytes(memory.rss)} shared\``;
    });

    if (lines.length > 0) return truncate(lines.join('\n'), 950);
  }

  if (typeof client.fetchAllShardInfo === 'function') {
    try {
      const infos = await client.fetchAllShardInfo();
      if (infos.length > 0) {
        return truncate(
          infos
            .map((info) => {
              const label =
                info.shardIds.length === 1
                  ? `Shard ${info.shardIds[0]}`
                  : `Worker ${info.workerId} [${info.shardIds.join(', ')}]`;
              return `${label}: Status: \`${info.status}\` | Ping: \`${info.ping ?? 'n/a'} ms\` | Guilds: \`${formatNumber(info.guilds)}\` | Memory: \`${info.memory.toFixed(1)} MB\``;
            })
            .join('\n'),
          950,
        );
      }
    } catch {}
  }

  return `Shard 0: Status: \`${client.user && client.readyAt ? 'Online' : 'Offline'}\` | Ping: \`${getGatewayPing(client) ?? 'n/a'} ms\` | Guilds: \`${formatNumber(client.guilds.size)}\` | Memory: \`${formatBytes(memory.rss)}\``;
}

function getRecentErrorText(): string {
  const errors = logBuffer
    .getRecent(LOG_SAMPLE_SIZE)
    .filter((entry) => entry.level === 'error' || entry.level === 'fatal')
    .slice(-3)
    .map((entry) => `[${entry.tag || 'app'}] ${entry.message}`);

  return truncate(errors.length > 0 ? errors.join('\n') : 'None recorded', 950);
}

async function buildStatsEmbed(client: BotClient, snapshotNumber: number): Promise<EmbedBuilder> {
  let processCpu = 'Unavailable';
  try {
    const usage = await pidusage(process.pid);
    processCpu = `${usage.cpu.toFixed(1)}%`;
  } catch {}

  const memory = process.memoryUsage();
  const [database, commandActivity, openTickets, shardSummary] = await Promise.all([
    getDatabaseMetrics(),
    getCommandActivityMetrics(),
    getOpenTicketCount(),
    getShardSummary(client, memory),
  ]);
  const eventLoop = getEventLoopMetrics();
  const disk = getDiskMetrics();
  const guilds = client.guilds.size;
  let knownMembers = 0;
  let cachedMembers = 0;
  let channels = 0;
  let textChannels = 0;
  let voiceChannels = 0;
  let categories = 0;
  let roles = 0;
  let emojis = 0;
  let stickers = 0;

  for (const guild of client.guilds.values()) {
    knownMembers += guild.memberCount ?? guild.members?.size ?? 0;
    cachedMembers += guild.members?.size ?? 0;
    roles += guild.roles?.size ?? 0;
    emojis += guild.emojis?.size ?? 0;
    stickers += guild.stickers?.size ?? 0;

    for (const channel of guild.channels?.values() ?? []) {
      channels += 1;
      if (channel.type === 4) categories += 1;
      else if (channel.type === 2) voiceChannels += 1;
      else textChannels += 1;
    }
  }

  const recentLogs = logBuffer.getRecent(LOG_SAMPLE_SIZE);
  const errors = recentLogs.filter((entry) => entry.level === 'error' || entry.level === 'fatal').length;
  const warnings = recentLogs.filter((entry) => entry.level === 'warn').length;
  const hostTotalMemory = os.totalmem();
  const hostFreeMemory = os.freemem();
  const gatewayPing = getGatewayPing(client);
  const online = Boolean(client.user && client.readyAt);
  const shardCount =
    getGatewayShardCount(client) || (process.env.TOTAL_SHARDS ? Number(process.env.TOTAL_SHARDS) || 1 : 1);
  const ticketRuntime = getTicketRuntimeState();
  const rssRuntime = rssPollerService.getRuntimeState();
  const backgroundQueueCounts = {
    role: roleQueue.getPendingCount(),
    autorole: autoroleQueue.getPendingCount(),
    embed: embedQueue.getPendingCount(),
    moderation: moderationQueue.getPendingCount(),
    messageDelete: messageDeleteQueue.getPendingCount(),
  };
  const backgroundQueueTotal = Object.values(backgroundQueueCounts).reduce((sum, count) => sum + count, 0);
  const processStatus = online ? 'Online' : 'Offline';
  const healthColor = online && database.status === 'Connected' && eventLoop.status === 'Healthy' ? 0x57f287 : 0xfee75c;

  return new EmbedBuilder()
    .setTitle(`${config.branding.publicName} Stats Snapshot`)
    .setColor(healthColor)
    .addFields(
      {
        name: 'Status',
        value: [
          `Status: \`${processStatus}\``,
          `Gateway: \`${gatewayPing === null ? 'Unavailable' : `${gatewayPing} ms`}\``,
          `Uptime: \`${formatDuration(process.uptime())}\``,
          `Version: \`${config.appVersion}\``,
          `Node: \`${process.version}\``,
          `PID: \`${process.pid}\``,
          `Shards: \`${shardCount}\``,
        ].join('\n'),
        inline: false,
      },
      {
        name: 'Overview',
        value: [
          `Servers: \`${formatNumber(guilds)}\` | Known members: \`${formatNumber(knownMembers)}\` | Cached members: \`${formatNumber(cachedMembers)}\``,
          `Cached users: \`${formatNumber(client.users.size)}\` | Cached channels: \`${formatNumber(client.channels.size)}\``,
          `Channels: \`${formatNumber(channels)}\` | Text: \`${formatNumber(textChannels)}\` | Voice: \`${formatNumber(voiceChannels)}\``,
          `Categories: \`${formatNumber(categories)}\` | Roles: \`${formatNumber(roles)}\``,
          `Emojis: \`${formatNumber(emojis)}\` | Stickers: \`${formatNumber(stickers)}\``,
        ].join('\n'),
        inline: false,
      },
      {
        name: 'Performance',
        value: [
          `CPU: \`${processCpu}\` | Heap: \`${formatBytes(memory.heapUsed)} / ${formatBytes(memory.heapTotal)}\``,
          `RSS: \`${formatBytes(memory.rss)}\``,
          `Host memory: \`${formatBytes(hostTotalMemory - hostFreeMemory)} / ${formatBytes(hostTotalMemory)}\``,
          `Disk: \`${disk.used} / ${disk.total} (${disk.percent})\``,
          `Load: \`${os.loadavg()[0]?.toFixed(2) ?? 'n/a'}\` | Cores: \`${os.cpus().length}\``,
        ].join('\n'),
        inline: false,
      },
      {
        name: 'Event loop',
        value: [
          `Health: \`${eventLoop.status}\``,
          `p95 lag: \`${eventLoop.p95Ms.toFixed(1)} ms\``,
          `Max lag: \`${eventLoop.maxMs.toFixed(1)} ms\``,
        ].join('\n'),
        inline: true,
      },
      {
        name: 'Database',
        value: [`Status: \`${database.status}\``, `Ping: \`${database.latency}\``, `Pool: \`${database.pool}\``].join(
          '\n',
        ),
        inline: true,
      },
      {
        name: 'Commands',
        value: [`Last hour: \`${commandActivity.lastHour}\``, `Last 24 hours: \`${commandActivity.lastDay}\``].join(
          '\n',
        ),
        inline: true,
      },
      {
        name: 'Gateway',
        value: shardSummary,
        inline: false,
      },
      {
        name: 'Queues',
        value: [
          `Open tickets: \`${openTickets}\` | Cooldowns: \`${formatNumber(ticketRuntime.cooldowns)}\``,
          `RSS: \`${rssRuntime.running ? 'Polling' : rssRuntime.started ? 'Idle' : 'Not started'}\` | Pending: \`${formatNumber(rssRuntime.pending)}\``,
          `Analytics pending: \`${formatNumber(activityService.getPendingBucketCount())}\``,
          `Background total: \`${formatNumber(backgroundQueueTotal)}\``,
          `Roles: \`${formatNumber(backgroundQueueCounts.role)}\` | Autoroles: \`${formatNumber(backgroundQueueCounts.autorole)}\``,
          `Embeds: \`${formatNumber(backgroundQueueCounts.embed)}\` | Moderation: \`${formatNumber(backgroundQueueCounts.moderation)}\``,
          `Message deletes: \`${formatNumber(backgroundQueueCounts.messageDelete)}\``,
        ].join('\n'),
        inline: false,
      },
      {
        name: 'Logs',
        value: [
          `Errors/fatals: \`${formatNumber(errors)}\` | Warnings: \`${formatNumber(warnings)}\``,
          `Buffer: \`${formatNumber(logBuffer.size)} / 500 entries\``,
          `GlitchTip: \`${config.glitchtip.dsn ? `${formatNumber(getGlitchTipErrorCount())} errors this process` : 'Disabled'}\``,
          `Sample: \`last ${formatNumber(LOG_SAMPLE_SIZE)} entries\``,
        ].join('\n'),
        inline: false,
      },
      {
        name: 'Recent errors',
        value: getRecentErrorText(),
        inline: false,
      },
    )
    .setFooter({ text: `Snapshot ${snapshotNumber}/${TOTAL_SNAPSHOTS} | local cache and host metrics` })
    .setTimestamp(new Date());
}

function scheduleRefresh(
  message: { edit: (payload: { embeds: EmbedBuilder[] }) => Promise<unknown> },
  client: BotClient,
  nextSnapshot: number,
): void {
  if (nextSnapshot > TOTAL_SNAPSHOTS) return;

  const timer = setTimeout(async () => {
    try {
      await message.edit({ embeds: [await buildStatsEmbed(client, nextSnapshot)] });
    } catch (error) {
      console.warn('[STATS] Could not refresh stats message:', error);
      return;
    }

    scheduleRefresh(message, client, nextSnapshot + 1);
  }, REFRESH_INTERVAL_MS);

  timer.unref?.();
}

const command: Command = {
  name: 'stats',
  description: 'Shows a live bot and VPS stats snapshot (owner only)',
  usage: '',
  category: 'owner',
  ownerOnly: true,
  allowDM: true,
  cooldown: 0,

  async execute(message, _args, client) {
    try {
      const reply = await message.reply({ embeds: [await buildStatsEmbed(client, 1)] });
      scheduleRefresh(reply, client, 2);
    } catch (error) {
      console.error('[STATS] Failed to send stats snapshot:', error);
    }
  },
};

export default command;
