import type { Guild } from '@fluxerjs/core';
import type { ILeveling, ILevelRole } from '@/types/Leveling';
import { isArray } from '../isArray';

export interface LevelUpTemplateContext {
  userId: string;
  username: string;
  level: number;
  xp: number;
  earnedRoleId?: string | null;
  earnedRoleName?: string | null;
}

export function renderLevelUpMessage(template: string, ctx: LevelUpTemplateContext): string {
  let out = template;
  out = out.replaceAll('{user.mention}', `<@${ctx.userId}>`);
  out = out.replaceAll('{user.name}', ctx.username);
  out = out.replaceAll('{user.level}', String(ctx.level));
  out = out.replaceAll('{user.xp}', String(ctx.xp));

  out = out.replace(/\{earned:((?:[^{}]|\{mention\}|\{name\})*)\}/g, (_match, inner: string) => {
    if (!ctx.earnedRoleId) return '';
    const roleMention = `<@&${ctx.earnedRoleId}>`;
    const roleName = ctx.earnedRoleName ?? 'role';
    return inner.replaceAll('{mention}', roleMention).replaceAll('{name}', roleName);
  });

  return out.trim();
}

export function rolesEarnedAtLevel(level: number, levelRoles: ILevelRole[]): ILevelRole[] {
  return levelRoles.filter((lr) => lr.level === level);
}

export async function applyLevelRoles(
  guild: Guild,
  userId: string,
  level: number,
  leveling: ILeveling,
): Promise<{ applied: ILevelRole[]; removed: string[] }> {
  const applied: ILevelRole[] = [];
  const removed: string[] = [];
  const { levelRoles, stackRewards } = leveling;
  if (!isArray(levelRoles) || !levelRoles.length) return { applied, removed };

  let member = guild.members?.get(userId) ?? null;
  if (!member) member = await guild.fetchMember?.(userId).catch(() => null);
  if (!member) return { applied, removed };

  const rewardRoleIds = new Set(levelRoles.map((lr) => lr.roleId));
  const earnedNow = levelRoles.filter((lr) => level >= lr.level);

  if (!stackRewards) {
    const best = earnedNow.reduce<ILevelRole | null>((acc, lr) => {
      if (!acc || lr.level > acc.level) return lr;
      return acc;
    }, null);

    for (const lr of levelRoles) {
      if (member.roles?.roleIds?.includes(lr.roleId) && lr.roleId !== best?.roleId) {
        await member.roles.remove(lr.roleId).catch(() => {});
        removed.push(lr.roleId);
      }
    }

    if (best && !member.roles?.roleIds?.includes(best.roleId)) {
      await member.roles.add(best.roleId).catch(() => {});
      applied.push(best);
    }
    return { applied, removed };
  }

  for (const lr of earnedNow) {
    if (!member.roles?.roleIds?.includes(lr.roleId)) {
      await member.roles.add(lr.roleId).catch(() => {});
      applied.push(lr);
    }
  }

  // strip roles that aren't part of reward config (shouldn't happen often)
  for (const roleId of member.roles?.roleIds ?? []) {
    if (rewardRoleIds.has(roleId) && !earnedNow.some((lr) => lr.roleId === roleId)) {
      await member.roles.remove(roleId).catch(() => {});
      removed.push(roleId);
    }
  }

  return { applied, removed };
}

export function resolveLevelUpChannelId(leveling: ILeveling, messageChannelId: string | null): string | null {
  if (leveling.levelUp.channelMode === 'specific') return leveling.levelUp.channelId;
  return messageChannelId;
}
