import { PermissionFlags } from '@fluxerjs/core';
import type { MemberLike, GuildLike, RoleLike } from '@/types';
import { isArray } from './isArray';

function getMemberRoleIds(member: MemberLike | null): readonly string[] {
  if (!member?.roles) return [];
  const r = member.roles;
  if (isArray(r.roleIds) && r.roleIds.length > 0) return r.roleIds;
  return [];
}

function getRolePosition(guild: GuildLike | null, roleId: string): number {
  if (!guild?.roles) return 0;
  const roles = guild.roles;
  const role = roles.get?.(roleId) ?? roles.cache?.get?.(roleId);
  if (role && typeof role.position === 'number') return role.position;
  return 0;
}

export function getMemberHighestRolePosition(member: MemberLike | null, guild: GuildLike | null): number {
  const roleIds = getMemberRoleIds(member);
  if (roleIds.length === 0) return -1;
  let highest = 0;
  for (const roleId of roleIds) {
    const pos = getRolePosition(guild, roleId);
    if (pos > highest) highest = pos;
  }
  return highest;
}

export function hasPermission(member: MemberLike | null, permission: string): boolean {
  if (!member || !member.permissions) return false;

  const flag = (PermissionFlags as unknown as Record<string, bigint>)[permission];
  if (!flag) {
    console.warn(`Unknown permission flag: ${permission}`);
    return false;
  }

  return member.permissions.has(flag);
}

export function hasAnyPermission(member: MemberLike | null, permissions: string[]): boolean {
  if (!member || !member.permissions) return false;

  return permissions.some((perm) => hasPermission(member, perm));
}

export function hasAllPermissions(member: MemberLike | null, permissions: string[]): boolean {
  if (!member || !member.permissions) return false;

  return permissions.every((perm) => hasPermission(member, perm));
}

export function isAdministrator(member: MemberLike | null): boolean {
  return hasPermission(member, 'Administrator');
}

export function canModerate(
  moderator: MemberLike,
  target: MemberLike,
): { canModerate: boolean; reason: string | null } {
  if (moderator.id === target.id) {
    return { canModerate: false, reason: 'Cannot moderate yourself' };
  }

  if (target.guild && target.id === target.guild.ownerId) {
    return { canModerate: false, reason: 'Cannot moderate the server owner' };
  }

  const guild = moderator.guild;
  const modRoleIds = getMemberRoleIds(moderator);
  const targetRoleIds = getMemberRoleIds(target);
  if (guild && (modRoleIds.length > 0 || targetRoleIds.length > 0)) {
    let moderatorHighest = 0;
    let targetHighest = 0;

    for (const roleId of modRoleIds) {
      const pos = getRolePosition(guild, roleId);
      if (pos > moderatorHighest) moderatorHighest = pos;
    }

    for (const roleId of targetRoleIds) {
      const pos = getRolePosition(guild, roleId);
      if (pos > targetHighest) targetHighest = pos;
    }

    if (moderatorHighest > 0 || targetHighest > 0) {
      if (moderatorHighest <= targetHighest) {
        return { canModerate: false, reason: 'Cannot moderate someone with equal or higher role' };
      }
    }
  }

  return { canModerate: true, reason: null };
}

/*              __
               / _)
        .-^^^-/ /
    __/       /
    <__.|_|-|_|
*/

export function canManageRole(
  member: MemberLike | null,
  targetRole: RoleLike | null,
  guild: GuildLike | null,
): { allowed: true; reason: null } | { allowed: false; reason: string } {
  if (!member || !targetRole || !guild) {
    return { allowed: false, reason: 'Missing member, role, or guild data.' };
  }

  if (guild.ownerId && String(guild.ownerId) === String(member.id)) {
    return { allowed: true, reason: null };
  }

  const memberRoleIds = getMemberRoleIds(member);
  let memberHighest = 0;
  for (const roleId of memberRoleIds) {
    const pos = getRolePosition(guild, roleId);
    if (pos > memberHighest) memberHighest = pos;
  }

  const targetPosition = targetRole.position ?? 0;

  if (memberHighest <= targetPosition) {
    return {
      allowed: false,
      reason: `You cannot manage the **${targetRole.name}** role because it is equal to or higher than your highest role.`,
    };
  }

  return { allowed: true, reason: null };
}

export function getPermissionList(): string[] {
  return Object.keys(PermissionFlags);
}

/** Guild shells from gateway resume have no roles; member.permissions ORs role bitfields from guild.roles. */
export async function ensureGuildRolesLoaded(guild: GuildLike | null): Promise<void> {
  const g = guild as { roles?: { size?: number }; fetchRoles?: () => Promise<unknown> } | null;
  if (!g?.fetchRoles) return;
  if ((g.roles?.size ?? 0) > 0) return;
  try {
    await g.fetchRoles();
  } catch {
    /* permission check will fail closed */
  }
}
