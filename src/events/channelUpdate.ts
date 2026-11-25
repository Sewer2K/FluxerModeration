import type { Channel, Client } from '@fluxerjs/core';
import type { BotEvent } from '@/types';
import { isGuildTextChannel } from '@/utils/isGuildTextChannel';
import { logServerEvent } from '@/utils/logger';
import type { LogField } from '@/utils/logger';

const event: BotEvent = {
  name: 'channelUpdate',

  async execute(oldChannel: Channel, newChannel: Channel, client: Client) {
    try {
      if (!(isGuildTextChannel(oldChannel) && isGuildTextChannel(newChannel))) return;
      if (!newChannel.guildId) return;

      const guild = client.guilds.get(newChannel.guildId);
      if (!guild) return;

      const changes: LogField[] = [];

      if (oldChannel.name !== newChannel.name) {
        changes.push({ name: 'Name', value: `\`${oldChannel.name}\` → \`${newChannel.name}\``, inline: false });
      }
      if ((oldChannel.topic ?? '') !== (newChannel.topic ?? '')) {
        const before = oldChannel.topic || '*(none)*';
        const after = newChannel.topic || '*(none)*';
        changes.push({ name: 'Topic', value: `Before: ${before}\nAfter: ${after}`, inline: false });
      }
      if (oldChannel.nsfw !== newChannel.nsfw) {
        changes.push({
          name: 'NSFW',
          value: `${oldChannel.nsfw ? 'Yes' : 'No'} → ${newChannel.nsfw ? 'Yes' : 'No'}`,
          inline: true,
        });
      }
      if ((oldChannel.rateLimitPerUser ?? 0) !== (newChannel.rateLimitPerUser ?? 0)) {
        changes.push({
          name: 'Slowmode',
          value: `${oldChannel.rateLimitPerUser ?? 0}s → ${newChannel.rateLimitPerUser ?? 0}s`,
          inline: true,
        });
      }

      if (!changes.length) return;

      await logServerEvent(
        guild,
        'Channel Updated',
        0xf1c40f,
        [{ name: 'Channel', value: `<#${newChannel.id}>`, inline: false }, ...changes],
        client,
        { footer: `Channel ID: ${newChannel.id}`, eventType: 'channel_update' },
      );
    } catch (error) {
      console.error('Error in channelUpdate event:', error);
    }
  },
};

export default event;
