import { PermissionFlags } from '@fluxerjs/core';

export interface RoleSnapshot {
  name: string;
  color: number;
  permissions: string;
}

export function normalizePermissionBits(raw: unknown): string {
  if (raw === null || raw === undefined || raw === '') return '0';
  try {
    return BigInt(String(raw)).toString();
  } catch {
    return String(raw);
  }
}

export function snapshotFromLiveRole(role: {
  name?: string;
  color?: number | null;
  _permissions?: string | number | bigint;
  permissions?: unknown;
}): RoleSnapshot {
  const rawPerms = role._permissions ?? role.permissions;
  return {
    name: role.name ?? '',
    color: role.color ?? 0,
    permissions: normalizePermissionBits(
      typeof rawPerms === 'object' && rawPerms !== null && 'bitfield' in (rawPerms as object)
        ? (rawPerms as { bitfield: unknown }).bitfield
        : rawPerms,
    ),
  };
}

export function formatPermissionBitfieldDelta(prev: string, next: string): string {
  try {
    const p = BigInt(prev || '0');
    const n = BigInt(next || '0');
    if (p === n) return 'No change';

    const added: string[] = [];
    const removed: string[] = [];
    for (const [name, bit] of Object.entries(PermissionFlags)) {
      const b = BigInt(bit as bigint);
      if ((n & b) !== 0n && (p & b) === 0n) added.push(name);
      if ((p & b) !== 0n && (n & b) === 0n) removed.push(name);
    }

    const parts: string[] = [];
    if (added.length) parts.push(`Added: ${added.join(', ')}`);
    if (removed.length) parts.push(`Removed: ${removed.join(', ')}`);
    return parts.join('\n') || `${prev} → ${next}`;
  } catch {
    return `${prev} → ${next}`;
  }
}

const roleCache = new Map<string, Map<string, RoleSnapshot>>();

function guildCache(guildId: string): Map<string, RoleSnapshot> {
  let cache = roleCache.get(guildId);
  if (!cache) {
    cache = new Map();
    roleCache.set(guildId, cache);
  }
  return cache;
}

export function seedGuildRoleCache(guild: { id: string; roles?: { values?: () => Iterable<unknown> } }): void {
  const roles = guild.roles;
  if (!roles || typeof roles.values !== 'function') return;

  const cache = guildCache(guild.id);
  for (const role of roles.values()) {
    if (role && typeof role === 'object' && 'id' in role) {
      cache.set(
        String((role as { id: string }).id),
        snapshotFromLiveRole(role as Parameters<typeof snapshotFromLiveRole>[0]),
      );
    }
  }
}

export function getCachedRoleSnapshot(guildId: string, roleId: string): RoleSnapshot | undefined {
  return roleCache.get(guildId)?.get(roleId);
}

export function setCachedRoleSnapshot(guildId: string, roleId: string, snapshot: RoleSnapshot): void {
  guildCache(guildId).set(roleId, snapshot);
}

export function deleteCachedRoleSnapshot(guildId: string, roleId: string): void {
  roleCache.get(guildId)?.delete(roleId);
}
