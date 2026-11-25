import type { Guild } from '@fluxerjs/core';

// Fluxer SnowflakeType: ^(0|[1-9][0-9]*)$ — see docs.fluxer.app/resources/guilds
const SNOWFLAKE_RE = /^(?:0|[1-9]\d*)$/;
const ROLE_MENTION_RE = /^<@&((?:0|[1-9]\d*))>$/;

export async function resolveRoleIdFromArg(guild: Guild, roleArg: string): Promise<string | null> {
  const trimmed = roleArg.trim();
  const mention = trimmed.match(ROLE_MENTION_RE);
  if (mention && '1' in mention) return mention[1];

  if (typeof guild.resolveRoleId === 'function') {
    try {
      const id = await guild.resolveRoleId(trimmed);
      if (id) return id;
    } catch {}
  }

  // SDK resolveRoleId caps at 19 digits; accept longer Fluxer snowflakes directly
  if (SNOWFLAKE_RE.test(trimmed) && trimmed.length >= 17) return trimmed;

  return null;
}

export async function fetchGuildRole(guild: Guild, roleId: string) {
  let role = guild.roles?.get(roleId);
  if (role) return role;

  if (typeof guild.fetchRoles === 'function') {
    try {
      await guild.fetchRoles();
      role = guild.roles?.get(roleId);
      if (role) return role;
    } catch {}
  }

  if (typeof guild.fetchRole === 'function') {
    try {
      return await guild.fetchRole(roleId);
    } catch {}
  }

  return null;
}
