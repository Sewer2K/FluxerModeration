import type { Channel, Client } from '@fluxerjs/core';
import type { BotEvent } from '@/types';
import { logServerEvent } from '@/utils/logger';
import { isGuildTextChannel } from '@/utils/isGuildTextChannel';

function channelTypeName(type: number): string {
  const types: Record<number, string> = {
    0: 'Text',
    2: 'Voice',
    4: 'Category',
    5: 'Announcement',
    13: 'Stage',
    15: 'Forum',
  };
  return types[type] ?? 'Channel';
}

const event: BotEvent = {
  name: 'channelCreate',

  async execute(channel: Channel, client: Client) {
    try {
      if (!isGuildTextChannel(channel)) return;
      if (!channel.guildId) return;
      const guild = client.guilds.get(channel.guildId);
      if (!guild) return;

      await logServerEvent(
        guild,
        'Channel Created',
        0x2ecc71,
        [
          { name: 'Name', value: `#${channel.name}`, inline: true },
          { name: 'Type', value: channelTypeName(channel.type), inline: true },
          {
            name: 'Category',
            value: channel.parentId ? `ID: ${channel.parentId}` : 'None',
            inline: true,
          },
        ],
        client,
        { footer: `Channel ID: ${channel.id}`, eventType: 'channel_create' },
      );
    } catch (error) {
      console.error('Error in channelCreate event:', error);
    }
  },
};

export default event;
