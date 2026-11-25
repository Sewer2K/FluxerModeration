import fs from 'fs';
import path from 'path';
import type { Client } from '@fluxerjs/core';
import { Routes } from '@fluxerjs/core';
import isNetworkError from './isNetworkError';
import { isArray } from './isArray';
import { messageFromError } from './messageFromError';

const QUEUE_FILE = path.join(__dirname, '../../data/message-delete-queue.json');
const RETRY_INTERVAL = 15_000;
const MAX_AGE = 10 * 60_000;
const MAX_SIZE = 200;

interface DeleteQueueEntry {
  channelId: string;
  messageId: string;
  addedAt: number;
}

let queue: DeleteQueueEntry[] = [];
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
    console.error('[delete-queue] Failed to save queue:', messageFromError(err));
  }
}

export function enqueue(channelId: string, messageId: string): void {
  const exists = queue.some((e) => e.channelId === channelId && e.messageId === messageId);
  if (exists) return;

  if (queue.length >= MAX_SIZE) {
    queue.shift();
    console.warn('[delete-queue] Queue full - oldest entry dropped');
  }

  queue.push({ channelId, messageId, addedAt: Date.now() });
  saveQueue();
  console.log(
    `[delete-queue] Queued delete for message ${messageId} in channel ${channelId} (${queue.length} pending)`,
  );
}

export function getPendingCount(): number {
  return queue.length;
}

async function processQueue(): Promise<void> {
  if (!_client || queue.length === 0) return;

  const remaining: DeleteQueueEntry[] = [];

  for (const entry of queue) {
    if (Date.now() - entry.addedAt > MAX_AGE) {
      console.log(`[delete-queue] Dropping stale delete for message ${entry.messageId}`);
      continue;
    }

    try {
      await _client.rest.delete(Routes.channelMessage(entry.channelId, entry.messageId));
      console.log(`[delete-queue] Deleted message ${entry.messageId} in channel ${entry.channelId}`);
    } catch (err: unknown) {
      if (isNetworkError(err)) {
        remaining.push(entry);
      } else {
        // 404 = already deleted, 403 = no perms
        if (!(err && typeof err === 'object' && 'status' in err && err.status === 404)) {
          console.warn(
            `[delete-queue] Permanent error deleting message ${entry.messageId}, dropping: ${messageFromError(err)}`,
          );
        }
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
    console.log(`[delete-queue] Loaded ${queue.length} pending message delete(s) from disk`);
    setTimeout(processQueue, 10_000);
  }
  setInterval(processQueue, RETRY_INTERVAL);
}
