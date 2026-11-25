import type { Client, GuildBan } from '@fluxerjs/core';
import type { BotEvent } from '@/types';
import { type LogField, logServerEvent } from '@/utils/logger';

const event: BotEvent = {
  name: 'guildBanAdd',

  async execute(ban: GuildBan, client: Client) {
    try {
      const guild = client.guilds.get(ban.guildId);
      if (!guild) return;

      const userId = ban.user?.id;
      if (!userId) return;

      const banFields: LogField[] = [];
      if (ban.reason) {
        banFields.push({ name: 'Reason', value: ban.reason, inline: false });
      }

      await logServerEvent(
        guild,
        'Member Banned',
        0xe74c3c, // red
        banFields,
        client,
        {
          description: `<@${userId}> was banned from the server`,
          footer: `User ID: ${userId}`,
          eventType: 'member_ban',
        },
      );
    } catch (error) {
      console.error('Error in guildBanAdd event:', error);
    }
  },
};

export default event;
