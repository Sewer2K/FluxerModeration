import type { Client, Role } from '@fluxerjs/core';
import type { BotEvent } from '@/types';
import { logServerEvent } from '@/utils/logger';

function colorHex(color: number | null | undefined): string {
  if (!color) return 'None';
  return `#${color.toString(16).padStart(6, '0').toUpperCase()}`;
}

const event: BotEvent = {
  name: 'guildRoleCreate',

  async execute(role: Role, client: Client) {
    try {
      const guild = client.guilds.get(role.guildId);
      if (!guild) return;

      if (!role?.id) return;

      await logServerEvent(
        guild,
        'Role Created',
        0x2ecc71,
        [
          { name: 'Role', value: `<@&${role.id}>`, inline: true },
          { name: 'Name', value: role.name, inline: true },
          { name: 'Color', value: colorHex(role.color), inline: true },
        ],
        client,
        { footer: `Role ID: ${role.id}`, eventType: 'role_create' },
      );
    } catch (error) {
      console.error('Error in guildRoleCreate event:', error);
    }
  },
};

export default event;
