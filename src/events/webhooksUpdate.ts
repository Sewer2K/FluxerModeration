import type { Client, WebhooksUpdatePayload } from '@fluxerjs/core';
import type { BotEvent } from '@/types';
import { logServerEvent } from '@/utils/logger';

const event: BotEvent = {
  name: 'webhooksUpdate',

  async execute(data: WebhooksUpdatePayload, client: Client) {
    try {
      const guildId = data.guildId;
      if (!guildId) return;

      const guild = client.guilds.get(guildId);
      if (!guild) return;

      const channelId = data.channelId;

      await logServerEvent(
        guild,
        'Webhooks Updated',
        0x9b59b6,
        [{ name: 'Channel', value: `<#${channelId}>`, inline: true }],
        client,
        {
          description: 'A webhook was created, updated, or deleted in this channel.',
          footer: `Channel ID: ${channelId}`,
          eventType: 'webhooks_update',
        },
      );
    } catch (error) {
      console.error('Error in webhooksUpdate event:', error);
    }
  },
};

export default event;
