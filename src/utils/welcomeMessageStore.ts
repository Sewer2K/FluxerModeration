import type { Client } from '@fluxerjs/core';
import { Routes } from '@fluxerjs/types';
import WelcomeMessageRecord from '@/models/WelcomeMessageRecord';
import { messageFromError } from './messageFromError';

export async function recordWelcomeMessage(
  guildId: string,
  userId: string,
  channelId: string,
  messageId: string,
): Promise<void> {
  if (!guildId || !userId || !channelId || !messageId) return;

  await WelcomeMessageRecord.findOneAndUpdate(
    { guildId, userId },
    { guildId, userId, channelId, messageId },
    { upsert: true, setDefaultsOnInsert: true },
  ).catch((err) => {
    console.warn(`[welcome] Failed to record welcome message for ${userId} in ${guildId}: ${err.message}`);
  });
}

export async function purgeWelcomeMessage(client: Client, guildId: string, userId: string): Promise<boolean> {
  if (!guildId || !userId) return false;

  const record = await WelcomeMessageRecord.findOneAndDelete({ guildId, userId }).catch(() => null);
  if (!record) return false;

  try {
    await client.rest.delete(Routes.channelMessage(record.channelId, record.messageId));
    return true;
  } catch (err: unknown) {
    if (!(err && typeof err === 'object' && 'status' in err && err.status === 404)) {
      console.warn(
        `[welcome] Failed to delete welcome message ${record.messageId} for ${userId} in ${guildId}: ${messageFromError(err)}`,
      );
    }
    return false;
  }
}
