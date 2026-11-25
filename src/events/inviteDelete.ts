import type { Client, InviteDeletePayload } from '@fluxerjs/core';
import type { BotEvent } from '@/types';
import { logServerEvent } from '@/utils/logger';

const event: BotEvent = {
  name: 'inviteDelete',

  async execute(data: InviteDeletePayload, client: Client) {
    try {
      const guildId = data.guildId;
      if (!guildId) return;

      const guild = client.guilds.get(guildId);
      if (!guild) return;

      await logServerEvent(
        guild,
        'Invite Deleted',
        0xe74c3c,
        [
          { name: 'Code', value: data.code ?? 'Unknown', inline: true },
          { name: 'Channel', value: data.channelId ? `<#${data.channelId}>` : 'Unknown', inline: true },
        ],
        client,
        { footer: `Invite Code: ${data.code ?? 'unknown'}`, eventType: 'invite_delete' },
      );
    } catch (error) {
      console.error('Error in inviteDelete event:', error);
    }
  },
};

export default event;
