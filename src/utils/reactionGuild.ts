import type { Client, MessageReaction } from '@fluxerjs/core';
import { getChannelGuildId } from './getGuildChannel';

export async function resolveReactionGuildId(client: Client, reaction: MessageReaction): Promise<string | null> {
  const direct = reaction.guildId;
  if (direct) return String(direct);

  const channelId = reaction.channelId;
  if (!channelId || !client) return null;

  try {
    const channel = client.channels?.get(channelId) ?? (await client.channels?.fetch(channelId).catch(() => null));
    if (!channel) return null;

    const guildId = getChannelGuildId(channel);
    return guildId ? String(guildId) : null;
  } catch {
    return null;
  }
}
