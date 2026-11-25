import type { Channel, LinkChannel, TextChannel, VoiceChannel } from '@fluxerjs/core';
import { isGuildChannel } from './isGuildChannel';

// union and reasons for copied from `isGuildChannel`
export function getChannelGuildId(channel: VoiceChannel | LinkChannel | TextChannel): string;
export function getChannelGuildId(channel: Channel): string | null;
export function getChannelGuildId(channel: Channel): string | null {
  return isGuildChannel(channel) ? channel.guildId : null;
}
