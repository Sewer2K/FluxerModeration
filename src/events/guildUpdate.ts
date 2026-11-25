import { getChannelGuildId } from '@/utils/getGuildChannel';
import type { BotEvent } from '@/types';
import type { Channel, Client, Guild } from '@fluxerjs/core';
import type { Collection } from '@fluxerjs/collection';

function restoreCollectionIfEmpty<T>(
  target: Collection<string, T>,
  source: Iterable<[string, T]> | null | undefined,
): void {
  if (!target || typeof target.set !== 'function' || typeof target.size !== 'number' || target.size > 0 || !source) {
    return;
  }

  for (const [id, value] of source) {
    target.set(id, value);
  }
}

function getClientGuildChannels(client: Client, guildId: string) {
  const entries: Array<[string, Channel]> = [];
  for (const channel of client.channels.values()) {
    const channelGuildId = getChannelGuildId(channel);
    if (channelGuildId === guildId && channel?.id) {
      entries.push([channel.id, channel]);
    }
  }
  return entries;
}

const event: BotEvent = {
  name: 'guildUpdate',

  async execute(oldGuild: Guild, newGuild: Guild, client: Client) {
    try {
      if (!newGuild?.id) return;

      const preservedChannels =
        oldGuild?.channels?.size > 0 ? oldGuild.channels.entries() : getClientGuildChannels(client, newGuild.id);

      restoreCollectionIfEmpty(newGuild.channels, preservedChannels);
      restoreCollectionIfEmpty(newGuild.roles, oldGuild?.roles?.entries?.());
      restoreCollectionIfEmpty(newGuild.members, oldGuild?.members?.entries?.());
      restoreCollectionIfEmpty(newGuild.emojis, oldGuild?.emojis?.entries?.());
      restoreCollectionIfEmpty(newGuild.stickers, oldGuild?.stickers?.entries?.());
    } catch (error) {
      console.error('Error in guildUpdate event:', error);
    }
  },
};

export default event;
