import type { Channel, TextBasedChannel } from '@fluxerjs/core';

// purely exists to mock in tests
export function isTextChannel(channel: Channel): channel is TextBasedChannel {
  return channel.isTextBased();
}
