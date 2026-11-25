import type { Channel, Client, Guild, MessageSendOptions, TextBasedChannel } from '@fluxerjs/core';
import { cacheMessageForDeleteLog } from './messageLogContent';
import { isGuildTextChannel } from './isGuildTextChannel';
import { isGuildChannel } from './isGuildChannel';
import { isTextChannel } from './isTextChannel';

export async function resolveGuildChannel(guild: Guild, channelId: string, client?: Client) {
  const channels = guild.channels;
  let channel: Channel | null = channels.get(channelId) ?? null;
  if (!channel && client) {
    try {
      channel = await client.channels.fetch(channelId);
    } catch {}
  }

  return channel && isGuildTextChannel(channel) ? channel : null;
}

export async function refreshSendContext(guild: Guild, channelId: string, client?: Client) {
  if (!client) return resolveGuildChannel(guild, channelId, client);

  try {
    if (typeof guild.members?.fetchMe === 'function') {
      await guild.members.fetchMe();
    }
  } catch {}

  try {
    const channel = await client.channels.fetch(channelId);
    if (channel && isGuildChannel(channel)) {
      const cachedGuild = client.guilds.get(String(channel.guildId));
      const guildChannels = cachedGuild?.channels;
      if (guildChannels?.set) {
        guildChannels.set(channelId, channel);
      }
    }
    return channel;
  } catch {
    return resolveGuildChannel(guild, channelId, client);
  }
}

export async function sendWithPermRefresh(
  guild: Guild,
  channelId: string,
  channel: TextBasedChannel,
  payload: MessageSendOptions,
  client?: Client,
): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const sent = await channel.send(payload);
      if (sent?.guildId) cacheMessageForDeleteLog(sent);
      return;
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
}
