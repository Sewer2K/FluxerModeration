import { Channel, TextChannel } from '@fluxerjs/core';

export function isGuildTextChannel(channel: Channel): channel is TextChannel {
  return channel.isTextBased() && !channel.isDM();
}
