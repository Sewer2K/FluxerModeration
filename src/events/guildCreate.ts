import type { BotEvent } from '@/types';
import GuildSettings from '@/models/GuildSettings';
import * as memberCounter from '@/utils/memberCounter';
import log from '@/utils/consoleLogger';
import { seedGuildRoleCache } from '@/utils/roleUpdateCache';
import type { Client, Guild } from '@fluxerjs/core';
import { messageFromError } from '@/utils/messageFromError';
import statsService from '@/services/StatsService';
import { rejectGuildIfUnauthorized } from '@/utils/accessControl';

interface InitQueueEntry {
  guild: Guild;
  client: Client;
}
const initQueue: InitQueueEntry[] = [];
const initializedGuilds = new Set<string>();
const GUILD_INIT_INTERVAL_MS = 750;
let initTimer: ReturnType<typeof setInterval> | null = null;
let initInFlight = false;

function processNextGuildInit(): void {
  if (initQueue.length === 0 || initInFlight) return;
  initInFlight = true;
  const { guild, client } = initQueue.shift()!;
  (async () => {
    try {
      const count = await memberCounter.fetchAndSetMemberCount(guild.id, client);
      if (count === null) {
        log.warn('Guild', `Member count init failed for ${guild.name || guild.id} (will show 1 on first join)`);
      }

      await GuildSettings.getOrCreate(guild.id);
    } catch (error: unknown) {
      log.error('Guild', `Init failed for ${guild.name || guild.id}: ${messageFromError(error)}`);
    } finally {
      initInFlight = false;
      if (initQueue.length === 0 && initTimer) {
        clearInterval(initTimer);
        initTimer = null;
      }
    }
  })();
}

function scheduleGuildInit(guild: Guild, client: Client): void {
  initQueue.push({ guild, client });
  if (!initTimer) {
    initTimer = setInterval(() => {
      processNextGuildInit();
      if (initQueue.length === 0 && initTimer) {
        clearInterval(initTimer);
        initTimer = null;
      }
    }, GUILD_INIT_INTERVAL_MS);
  }
}

export function initializeGuild(guild: Guild, client: Client): void {
  seedGuildRoleCache(guild);
  if (initializedGuilds.has(guild.id)) return;
  initializedGuilds.add(guild.id);
  scheduleGuildInit(guild, client);
}

export function forgetInitializedGuild(guildId: string): void {
  initializedGuilds.delete(guildId);
}

const event: BotEvent = {
  name: 'guildCreate',

  async execute(guild: Guild, client) {
    await Promise.resolve();
    if (await rejectGuildIfUnauthorized(client, guild)) return;
    log.ok('Guild', `Joined new guild: ${guild.name} (${guild.id})`);
    initializeGuild(guild, client);
    statsService.recordGuildJoin(guild.id, guild.name || guild.id).catch(() => {});
  },
};

export default event;
