import type { Client } from '@fluxerjs/core';
import { APIGuild, type APIGuildMember, Routes } from '@fluxerjs/types';
import { isArray } from './isArray';

const counts = new Map<string, number>();

export function set(guildId: string, count: number): void {
  counts.set(guildId, count);
}

export async function fetchAndSetMemberCount(guildId: string, client: Client): Promise<number | null> {
  const cachedCount = client.guilds.get(guildId)?.memberCount;
  if (typeof cachedCount === 'number' && cachedCount >= 0) {
    counts.set(guildId, cachedCount);
    return cachedCount;
  }

  try {
    const guildData = (await client.rest.get(Routes.guild(guildId))) as APIGuild & { member_count?: unknown };
    const count = guildData?.member_count;
    if (typeof count === 'number' && count > 0) {
      counts.set(guildId, count);
      return count;
    }
  } catch {}

  try {
    let total = 0;
    let lastId: string | undefined;
    while (true) {
      const qs = `?limit=1000${lastId ? `&after=${lastId}` : ''}`;
      const list = (await client.rest.get(Routes.guildMembers(guildId) + qs, { auth: true })) as
        APIGuildMember[] | { members?: APIGuildMember[] };
      const batch = isArray(list) ? list : (list.members ?? []);
      total += batch.length;
      if (batch.length < 1000) break;
      lastId = batch[batch.length - 1]?.user?.id;
      if (!lastId) break;
    }
    counts.set(guildId, total);
    return total;
  } catch {
    return null;
  }
}

export function get(guildId: string): number | null {
  return counts.get(guildId) ?? null;
}

export function increment(guildId: string): number {
  const n = (counts.get(guildId) ?? 0) + 1;
  counts.set(guildId, n);
  return n;
}

export function decrement(guildId: string): number {
  const n = Math.max(0, (counts.get(guildId) ?? 1) - 1);
  counts.set(guildId, n);
  return n;
}
