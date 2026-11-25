import type { Client, Role } from '@fluxerjs/core';
import type { BotEvent } from '@/types';
import { logServerEvent } from '@/utils/logger';
import {
  formatPermissionBitfieldDelta,
  getCachedRoleSnapshot,
  setCachedRoleSnapshot,
  snapshotFromLiveRole,
} from '@/utils/roleUpdateCache';

function colorHex(color: number | null | undefined): string {
  if (!color) return 'None';
  return `#${color.toString(16).padStart(6, '0').toUpperCase()}`;
}

const event: BotEvent = {
  name: 'guildRoleUpdate',

  async execute(_oldRole: Role | null, role: Role, client: Client) {
    try {
      const roleId = role.id;

      const guildId = role.guildId;
      const guild = client.guilds.get(guildId);
      if (!guild) return;

      const prev = getCachedRoleSnapshot(guildId, roleId);
      const next = snapshotFromLiveRole(role);
      setCachedRoleSnapshot(guildId, roleId, next);

      if (!prev) return;

      const nameChanged = prev.name !== next.name;
      const colorChanged = prev.color !== next.color;
      const permsChanged = prev.permissions !== next.permissions;

      if (!nameChanged && !colorChanged && !permsChanged) return;

      const fields: { name: string; value: string; inline: boolean }[] = [
        { name: 'Role', value: `<@&${roleId}>`, inline: false },
      ];

      if (nameChanged) {
        fields.push({ name: 'Name', value: `${prev.name} → ${next.name}`, inline: true });
      }
      if (colorChanged) {
        fields.push({ name: 'Color', value: `${colorHex(prev.color)} → ${colorHex(next.color)}`, inline: true });
      }
      if (permsChanged) {
        fields.push({
          name: 'Permissions',
          value: formatPermissionBitfieldDelta(prev.permissions, next.permissions),
          inline: false,
        });
      }

      await logServerEvent(guild, 'Role Updated', 0xf1c40f, fields, client, {
        footer: `Role ID: ${roleId}`,
        eventType: 'role_update',
      });
    } catch (error) {
      console.error('Error in guildRoleUpdate event:', error);
    }
  },
};

export default event;
