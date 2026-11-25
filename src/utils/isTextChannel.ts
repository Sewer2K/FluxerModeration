import type { Channel, TextBasedChannel } from '@fluxerjs/core';

// Shared text-channel guard.
export function isTextChannel(channel: Channel): channel is TextBasedChannel {
  return channel.isTextBased();
}
