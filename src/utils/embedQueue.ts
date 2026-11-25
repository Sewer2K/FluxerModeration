import fs from 'fs';
import path from 'path';
import type { Channel, Client } from '@fluxerjs/core';
import type { RESTPostAPIEmbed } from '@fluxerjs/types';
import isNetworkError from './isNetworkError';
import { isArray } from './isArray';
import { isTextChannel } from './isTextChannel';
import { messageFromError } from './messageFromError';

const QUEUE_FILE = path.join(__dirname, '../../data/embed-queue.json');
const RETRY_INTERVAL = 30_000;
const MAX_AGE = 60 * 60_000;
const MAX_SIZE = 500;

interface EmbedQueueEntry {
  guildId: string;
  channelId: string;
  embed: RESTPostAPIEmbed;
  addedAt: number;
}

let queue: EmbedQueueEntry[] = [];
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
    console.error('[embed-queue] Failed to save queue:', messageFromError(err));
  }
}

export function enqueue(guildId: string, channelId: string, embed: RESTPostAPIEmbed): void {
  if (queue.length >= MAX_SIZE) {
    queue.shift();
    console.warn('[embed-queue] Queue full - oldest entry dropped');
  }
  queue.push({ guildId, channelId, embed, addedAt: Date.now() });
  saveQueue();
  console.log(`[embed-queue] Queued embed for channel ${channelId} in guild ${guildId} (${queue.length} pending)`);
}

export function getPendingCount(): number {
  return queue.length;
}

async function processQueue(): Promise<void> {
  if (!_client || queue.length === 0) return;

  const remaining: EmbedQueueEntry[] = [];

  for (const entry of queue) {
    if (Date.now() - entry.addedAt > MAX_AGE) {
      console.log(`[embed-queue] Dropping stale embed for channel ${entry.channelId}`);
      continue;
    }

    try {
      const guild = _client.guilds.get(entry.guildId);
      if (!guild) {
        remaining.push(entry);
        continue;
      }

      let channel: Channel | null = guild.channels?.get(entry.channelId) ?? null;
      if (!channel) {
        try {
          channel = await _client.channels.fetch(entry.channelId);
        } catch {}
      }
      if (!channel || !isTextChannel(channel)) {
        remaining.push(entry);
        continue;
      }

      await channel.send({ embeds: [entry.embed] });
      console.log(`[embed-queue] Sent queued embed to channel ${entry.channelId}`);
    } catch (err) {
      if (isNetworkError(err)) {
        remaining.push(entry);
      } else {
        console.warn(
          `[embed-queue] Permanent error for ${entry.channelId}, dropping: ${err && typeof err === 'object' && 'code' in err ? err.code : messageFromError(err)}`,
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
    console.log(`[embed-queue] Loaded ${queue.length} pending embed(s) from disk`);
    setTimeout(processQueue, 10_000);
  }
  setInterval(processQueue, RETRY_INTERVAL);
}
