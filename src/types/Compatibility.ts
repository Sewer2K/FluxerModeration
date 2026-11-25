import type { GuildMemberRoleManager } from '@fluxerjs/core';

export interface UserLike {
  id: string;
  username?: string;
  avatarURL?: () => string | null;
}

export interface MemberLike {
  id: string;
  permissions?: { has(flag: bigint): boolean };
  roles?: {
    roleIds?: GuildMemberRoleManager['roleIds'];
    cache?: GuildMemberRoleManager['cache'];
  };
  guild?: GuildLike;
}

export interface GuildLike {
  ownerId?: string;
  roles?: Map<string, { position: number; name: string }> & { cache?: Map<string, { position: number; name: string }> };
}

export interface RoleLike {
  position?: number;
  name: string;
}
