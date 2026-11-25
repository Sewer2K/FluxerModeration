import type { Client, Role } from '@fluxerjs/core';
import type { BotEvent } from '@/types';
import { logServerEvent } from '@/utils/logger';
import { deleteCachedRoleSnapshot } from '@/utils/roleUpdateCache';

const event: BotEvent = {
  name: 'guildRoleDelete',

  async execute(_role: Role | null, guildId: string, roleId: string, client: Client) {
    try {
      const guild = client.guilds.get(guildId);
      if (!guild) return;

      if (!roleId) return;

      deleteCachedRoleSnapshot(guildId, roleId);

      await logServerEvent(
        guild,
        'Role Deleted',
        0xe74c3c,
        [{ name: 'Role', value: `<@&${roleId}>`, inline: true }],
        client,
        { footer: `Role ID: ${roleId}`, eventType: 'role_delete' },
      );
    } catch (error) {
      console.error('Error in guildRoleDelete event:', error);
    }
  },
};

export default event;
