import type { Channel, Client, Guild, Message, TextBasedChannel } from '@fluxerjs/core';
import { refreshSendContext } from './channelSend';
import { isArray } from './isArray';
import type { IGuildSettings, IStickyMessage } from '@/types';
import { isGuildTextChannel } from './isGuildTextChannel';
import { isTextChannel } from './isTextChannel';
import { messageFromError } from './messageFromError';

export const STICKY_MESSAGE_MAX_PER_GUILD = 15;

const lastStickyIds = new Map<string, string>();

function cacheKey(guildId: string, channelId: string): string {
  return `${guildId}:${channelId}`;
}

export function clearStickyCache(guildId: string, channelId: string): void {
  lastStickyIds.delete(cacheKey(guildId, channelId));
}

async function deleteStickyMessage(channel: TextBasedChannel, messageId: string | undefined): Promise<void> {
  if (!messageId) return;
  try {
    const msg = await channel.messages?.fetch?.(messageId);
    if (msg && typeof msg.delete === 'function') {
      await msg.delete();
    }
  } catch {
    /* already gone */
  }
}

export async function postStickyMessage(
  guild: Guild,
  channel: TextBasedChannel,
  channelId: string,
  content: string,
  client?: Client,
): Promise<string | null> {
  const guildId = guild?.id;
  if (!guildId || !content.trim()) return null;

  const key = cacheKey(guildId, channelId);
  const prevId = lastStickyIds.get(key);
  await deleteStickyMessage(channel, prevId);

  const payload = { content: content.trim() };
  let sent: Message | undefined = undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      sent = await channel.send(payload);
      break;
    } catch (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      err: any
    ) {
      const isPermError = err?.code === 'MISSING_PERMISSIONS' || err?.statusCode === 403;
      if (attempt === 0 && isPermError && client) {
        const refreshed = await refreshSendContext(guild, channelId, client);
        if (refreshed && isTextChannel(refreshed)) {
          channel = refreshed;
          continue;
        }
      }
      throw err;
    }
  }

  if (sent?.id) lastStickyIds.set(key, String(sent.id));
  return sent?.id ? String(sent.id) : null;
}

export async function handleStickyOnMessage(
  message: Message,
  client: Client,
  settings: IGuildSettings | null,
): Promise<void> {
  const guildId = message.guildId || message.guild?.id;
  const channelId = message.channelId || message.channel?.id;
  if (!guildId || !channelId) return;

  const stickies = isArray(settings?.stickyMessages) ? settings.stickyMessages : [];
  const sticky = stickies.find(
    (entry): entry is IStickyMessage & { content: string } =>
      entry?.enabled &&
      entry.channelId === channelId &&
      typeof entry.content === 'string' &&
      entry.content.trim().length > 0,
  );
  if (!sticky) return;

  const key = cacheKey(guildId, channelId);
  if (message.id && lastStickyIds.get(key) === message.id) return;

  let channel: Channel | null = message.channel;
  if (!channel) {
    try {
      channel = await client.channels.fetch(channelId);
    } catch {
      return;
    }
  }

  const guild = message.guild || client.guilds?.get(guildId);
  if (!guild || !isGuildTextChannel(channel)) return;

  try {
    await postStickyMessage(guild, channel, channelId, sticky.content, client);
  } catch (err: unknown) {
    console.warn(`[sticky] Failed in ${guild.name || guildId} #${channelId}: ${messageFromError(err)}`);
  }
}
