import type { Client, GuildEmojisUpdatePayload } from '@fluxerjs/core';
import type { BotEvent } from '@/types';
import { logServerEvent } from '@/utils/logger';

const event: BotEvent = {
  name: 'guildEmojisUpdate',

  async execute(data: GuildEmojisUpdatePayload, client: Client) {
    try {
      const guildId = data.guildId;
      if (!guildId) return;

      const guild = client.guilds.get(guildId);
      if (!guild) return;

      const emojis = data.emojis ?? [];
      const emojiList = emojis
        .slice(0, 10)
        .map((emoji) => `${emoji.animated ? '<a' : '<'}:${emoji.name}:${emoji.id}> \`${emoji.name}\``)
        .join('\n');

      const total = emojis.length;
      const summary = total > 10 ? `${emojiList}\n... and ${total - 10} more` : emojiList;

      await logServerEvent(
        guild,
        'Emojis Updated',
        0xf1c40f,
        [
          { name: 'Total Emojis', value: String(total), inline: true },
          { name: 'Current Emojis', value: summary || 'None', inline: false },
        ],
        client,
        {
          description: 'Server emojis were created, updated, or deleted.',
          footer: `Guild ID: ${guildId}`,
          eventType: 'guild_emojis_update',
        },
      );
    } catch (error) {
      console.error('Error in guildEmojisUpdate event:', error);
    }
  },
};

export default event;
