import type { Client, MessageSendOptions } from '@fluxerjs/core';
import { messageFromError } from './messageFromError';
import { sendMessage } from '@/utils/sendMessage';

async function resolveUser(client: Client, userId: string) {
  return client.users.get(userId) ?? (await client.users.fetch(userId));
}

export async function sendUserDm(
  client: Client,
  userId: string,
  options: string | MessageSendOptions,
): Promise<boolean> {
  try {
    const user = await resolveUser(client, userId);
    if (!user) return false;
    await sendMessage(user, typeof options === 'string' ? { content: options } : options);
    return true;
  } catch (error: unknown) {
    console.warn(`[sendUserDm] Failed for ${userId}: ${messageFromError(error)}`);
    return false;
  }
}
