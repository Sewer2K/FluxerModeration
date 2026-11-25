import type { Channel, LinkChannel, TextChannel, VoiceChannel } from '@fluxerjs/core';
import { isGuildTextChannel } from './isGuildTextChannel';

// not future-safe to put `channel is GuildChannel` here but these are all the `GuildChannel` subclasses as of @fluxerjs v1.3.1
export function isGuildChannel(channel: Channel): channel is VoiceChannel | LinkChannel | TextChannel {
  return channel.isVoice() || channel.isLink() || isGuildTextChannel(channel);
}
