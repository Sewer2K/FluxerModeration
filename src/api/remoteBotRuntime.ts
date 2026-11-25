/* eslint-disable @typescript-eslint/no-explicit-any */
import { Client } from '@fluxerjs/core';
import config from '@/config';
import { fluxerClientInstanceOptions } from '@/utils/fluxerUrls';
import type { BotRuntime } from './botRuntime';
import type { BotStatusSnapshot, PublicStatusPayload } from './botStatus';
import { snapshotToPublicStatus } from './botStatus';

const POLL_MS = 5000;
const STATUS_STALE_MS = 30_000;

async function fetchBotStatus(): Promise<BotStatusSnapshot | null> {
  const token = config.api.adminToken;
  const base = config.bot.internalUrl.replace(/\/$/, '');
  if (!token) return null;

  try {
    const res = await fetch(`${base}/internal/status`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    return (await res.json()) as BotStatusSnapshot;
  } catch {
    return null;
  }
}

async function fetchBotGuildIds(): Promise<Set<string>> {
  const token = config.api.adminToken;
  const base = config.bot.internalUrl.replace(/\/$/, '');
  if (!token) return new Set();

  try {
    const res = await fetch(`${base}/internal/guild-ids`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return new Set();
    const data = (await res.json()) as { guildIds?: string[] };
    return new Set(data.guildIds ?? []);
  } catch {
    return new Set();
  }
}

type RemoteGuildSummary = { id: string; name: string; icon: string | null; memberCount?: number };

async function fetchBotGuilds(): Promise<RemoteGuildSummary[]> {
  const token = config.api.adminToken;
  const base = config.bot.internalUrl.replace(/\/$/, '');
  if (!token) return [];

  try {
    const res = await fetch(`${base}/internal/guilds`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { guilds?: RemoteGuildSummary[] };
    return data.guilds ?? [];
  } catch {
    return [];
  }
}

function syncGuildCache(client: Client, guilds: RemoteGuildSummary[]): void {
  for (const guild of guilds) {
    const existing = client.guilds.get(guild.id);
    if (existing) {
      existing.name = guild.name;
      if (guild.icon !== undefined) existing.icon = guild.icon;
      continue;
    }
  }
}

export function createRemoteBotRuntime(): BotRuntime {
  const client = new Client({ ...fluxerClientInstanceOptions() });
  client.rest.setToken(config.token);

  let snapshot: BotStatusSnapshot | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let guildIdCache = new Set<string>();
  let guildMemberCounts = new Map<string, number>();
  let lastStatusAt = 0;

  const applySnapshot = (next: BotStatusSnapshot | null) => {
    snapshot = next;
    if (next?.userId) {
      (client as any).user = {
        id: next.userId,
        username: next.username,
        avatar: next.avatar,
      };
      client.readyAt = next.readyAt ? new Date(next.readyAt) : null;
    } else {
      client.user = null;
      client.readyAt = null;
    }

    (client as any)._ws = {
      ping: next?.wsPing ?? -1,
      shards: new Map([[0, { sessionId: next?.online ? 'remote' : null }]]),
    };
  };

  (client as any).fetchAllGuildIds = async () => {
    if (guildIdCache.size > 0) return guildIdCache;
    guildIdCache = await fetchBotGuildIds();
    return guildIdCache;
  };

  (client as any).fetchTotalGuildCount = async () => {
    if (snapshot?.guilds) return snapshot.guilds;
    const ids = await (client as any).fetchAllGuildIds();
    return ids.size;
  };

  return {
    client,
    commandHandler: null,
    isBotOnline() {
      return snapshot?.online ?? false;
    },
    getBotSnapshot() {
      return snapshot;
    },
    async getPublicStatus(): Promise<PublicStatusPayload> {
      return snapshotToPublicStatus(snapshot);
    },
    async refreshBotStatus() {
      const next = await fetchBotStatus();
      if (next) {
        applySnapshot(next);
        lastStatusAt = Date.now();
      } else if (snapshot && Date.now() - lastStatusAt > STATUS_STALE_MS) {
        snapshot = null;
      }

      if (next?.online) {
        const guilds = await fetchBotGuilds();
        if (guilds.length > 0) {
          syncGuildCache(client, guilds);
          guildIdCache = new Set(guilds.map((guild) => guild.id));
          guildMemberCounts = new Map(
            guilds
              .filter((guild) => typeof guild.memberCount === 'number' && guild.memberCount > 0)
              .map((guild) => [guild.id, guild.memberCount as number]),
          );
        } else {
          guildIdCache = await fetchBotGuildIds();
        }
      }
    },
    getGuildMemberCount(guildId: string) {
      return guildMemberCounts.get(guildId) ?? null;
    },
    async start() {
      await this.refreshBotStatus();
      pollTimer = setInterval(() => {
        void this.refreshBotStatus();
      }, POLL_MS);
    },
    async stop() {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    },
  };
}
