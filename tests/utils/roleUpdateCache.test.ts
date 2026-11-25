'use strict';

import { PermissionFlags } from '@fluxerjs/core';
import {
  formatPermissionBitfieldDelta,
  getCachedRoleSnapshot,
  normalizePermissionBits,
  seedGuildRoleCache,
  setCachedRoleSnapshot,
  snapshotFromLiveRole,
} from '@/utils/roleUpdateCache';

describe('roleUpdateCache', () => {
  test('normalizes permission bitfields as comparable strings', () => {
    expect(normalizePermissionBits('128')).toBe('128');
    expect(normalizePermissionBits(128)).toBe('128');
  });

  test('snapshots live roles using raw _permissions', () => {
    const snap = snapshotFromLiveRole({
      name: 'Mod',
      color: 0x8500ba,
      _permissions: '128',
    });
    expect(snap).toEqual({ name: 'Mod', color: 0x8500ba, permissions: '128' });
  });

  test('seeds guild role cache from guild.roles', () => {
    const guildId = 'guild-seed-test';
    seedGuildRoleCache({
      id: guildId,
      roles: {
        values: () => [{ id: '1', name: 'Admin', color: 0x8500ba, _permissions: '8' }],
      },
    });
    expect(getCachedRoleSnapshot(guildId, '1')).toEqual({
      name: 'Admin',
      color: 0x8500ba,
      permissions: '8',
    });
  });

  test('formats permission deltas as added/removed names', () => {
    const viewAudit = BigInt(PermissionFlags.ViewAuditLog);
    const manageGuild = BigInt(PermissionFlags.ManageGuild);
    const prev = (viewAudit | manageGuild).toString();
    const next = viewAudit.toString();

    const delta = formatPermissionBitfieldDelta(prev, next);
    expect(delta).toContain('Removed:');
    expect(delta).toContain('ManageGuild');
    expect(delta).not.toContain('ViewAuditLog');
  });

  test('does not treat identical snapshots as permission changes', () => {
    const guildId = 'guild-delta-test';
    const roleId = 'role-1';
    setCachedRoleSnapshot(guildId, roleId, { name: 'Admin', color: 0x8500ba, permissions: '8' });
    const prev = getCachedRoleSnapshot(guildId, roleId)!;
    const next = snapshotFromLiveRole({ name: 'Admin', color: 0x8500ba, _permissions: '8' });
    expect(prev.permissions).toBe(next.permissions);
    expect(prev.color).toBe(next.color);
  });
});
