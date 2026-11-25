import fs from 'fs';
import path from 'path';
import type { Client } from '@fluxerjs/core';
import isNetworkError from './isNetworkError';
import { purgeWelcomeMessage } from './welcomeMessageStore';
import { isArray } from './isArray';
import { messageFromError } from './messageFromError';
import { recordBanAppeal } from '@/utils/banAppeals';

const QUEUE_FILE = path.join(__dirname, '../../data/moderation-queue.json');
const RETRY_INTERVAL = 30_000;
const MAX_AGE = 24 * 60 * 60 * 1000;
const MAX_SIZE = 200;

interface ModQueueParams {
  reason?: string;
  deleteDays?: number;
  durationMs?: number;
}

interface ModQueueEntry {
  guildId: string;
  targetId: string;
  action: 'ban' | 'kick' | 'timeout';
  params: ModQueueParams;
  addedAt: number;
}

let queue: ModQueueEntry[] = [];
let _client: Client | null = null;

function loadQueue(): void {
  try {
    if (fs.existsSync(QUEUE_FILE)) {
      queue = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
      if (!isArray(queue)) queue = [];
    }
  } catch {
    queue = [];
  }
}

function saveQueue(): void {
  try {
    fs.mkdirSync(path.dirname(QUEUE_FILE), { recursive: true });
    fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2));
  } catch (err: unknown) {
    console.error('[mod-queue] Failed to save queue:', messageFromError(err));
  }
}

export function enqueue(
  guildId: string,
  targetId: string,
  action: 'ban' | 'kick' | 'timeout',
  params: ModQueueParams = {},
): void {
  const exists = queue.some((e) => e.guildId === guildId && e.targetId === targetId && e.action === action);
  if (exists) return;

  if (queue.length >= MAX_SIZE) {
    queue.shift();
    console.warn('[mod-queue] Queue full - oldest entry dropped');
  }

  queue.push({ guildId, targetId, action, params, addedAt: Date.now() });
  saveQueue();
  console.log(`[mod-queue] Queued ${action} for user ${targetId} in guild ${guildId} (${queue.length} pending)`);
}

export function getPendingCount(): number {
  return queue.length;
}

async function processQueue(): Promise<void> {
  if (!_client || queue.length === 0) return;

  const remaining: ModQueueEntry[] = [];

  for (const entry of queue) {
    if (Date.now() - entry.addedAt > MAX_AGE) {
      console.log(`[mod-queue] Dropping stale ${entry.action} for user ${entry.targetId} in guild ${entry.guildId}`);
      continue;
    }

    try {
      const guild = _client.guilds.get(entry.guildId);
      if (!guild) {
        remaining.push(entry);
        continue;
      }

      if (entry.action === 'ban') {
        await guild.ban(entry.targetId, {
          reason: entry.params.reason || 'Queued moderation action',
          deleteMessageDays: entry.params.deleteDays ?? 1,
        });
        await purgeWelcomeMessage(_client, entry.guildId, entry.targetId);
        await recordBanAppeal(_client, {
          guildId: entry.guildId,
          userId: entry.targetId,
          source: 'automod',
          banReason: entry.params.reason || 'Queued moderation action',
          moderatorId: 'automod',
          permanent: entry.params.durationMs === undefined,
          guildName: guild.name,
        }).catch(() => {});
        console.log(`[mod-queue] Banned ${entry.targetId} in ${guild.name}`);
      } else if (entry.action === 'kick') {
        await guild.kick(entry.targetId);
        console.log(`[mod-queue] Kicked ${entry.targetId} in ${guild.name}`);
      } else if (entry.action === 'timeout') {
        let member = guild.members?.get(entry.targetId);
        if (!member) {
          try {
            member = await guild.fetchMember(entry.targetId);
          } catch {
            console.log(`[mod-queue] User ${entry.targetId} no longer in ${guild.name}, dropping timeout`);
            continue;
          }
        }
        if (!member) continue;

        const durationMs = entry.params.durationMs || 600_000;
        const until = new Date(Date.now() + durationMs).toISOString();
        await member.edit({
          communicationDisabledUntil: until,
          timeoutReason: entry.params.reason || 'Queued moderation action',
        });
        console.log(`[mod-queue] Timed out ${entry.targetId} in ${guild.name}`);
      } else {
        console.warn(`[mod-queue] Unknown action "${entry.action}", dropping`);
        continue;
      }
    } catch (err) {
      if (isNetworkError(err)) {
        remaining.push(entry);
      } else {
        console.warn(
          `[mod-queue] Permanent error for ${entry.action} on ${entry.targetId} in guild ${entry.guildId}, dropping: ${(err as Error).message}`,
        );
      }
    }
  }

  queue = remaining;
  saveQueue();
}

export function start(clientInstance: Client): void {
  _client = clientInstance;
  loadQueue();

  if (queue.length > 0) {
    console.log(`[mod-queue] Loaded ${queue.length} pending moderation action(s) from disk`);
    setTimeout(processQueue, 10_000);
  }

  setInterval(processQueue, RETRY_INTERVAL);
}
