import type { Client } from '@fluxerjs/core';
import { Routes } from '@fluxerjs/types';

export async function resolveGuildName(client: Client, guildId: string, fallback: string): Promise<string> {
  const cached = client.guilds.get(guildId);
  if (cached?.name) return cached.name;

  try {
    const data = (await client.rest.get(Routes.guild(guildId))) as { name?: string };
    if (data?.name) return data.name;
  } catch {
    // Guild may have been left or is otherwise inaccessible.
  }

  return fallback;
}
