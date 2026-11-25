import { OverwriteType, PermissionFlags } from '@fluxerjs/core';
import type { Channel, Client, Guild } from '@fluxerjs/core';
import GuildSettings from '@/models/GuildSettings';
import { messageFromError } from '@/utils/messageFromError';
import log from '@/utils/consoleLogger';

export const TICKET_BOT_CHANNEL_PERMISSIONS =
  PermissionFlags.ViewChannel |
  PermissionFlags.SendMessages |
  PermissionFlags.ManageMessages |
  PermissionFlags.ManageChannels |
  PermissionFlags.EmbedLinks |
  PermissionFlags.ReadMessageHistory;
export const TICKET_CATEGORY_BOT_PERMISSIONS = PermissionFlags.ViewChannel | PermissionFlags.ManageChannels;

export function ticketCategoryBotOverwrite(botId: string) {
  return {
    id: botId,
    type: OverwriteType.Member,
    allow: String(TICKET_CATEGORY_BOT_PERMISSIONS),
    deny: '0',
  };
}

export async function ensureTicketCategoryPermissions(
  guild: Guild,
  categoryId: string,
  client: Client,
): Promise<boolean> {
  const botId = client.user?.id;
  if (!botId) return false;

  let category: Channel | null = guild.channels?.get(categoryId) ?? null;
  if (!category) category = await client.channels.fetch(categoryId).catch(() => null);

  if (!category || !category.isCategory() || category.guildId !== guild.id) {
    log.warn('Tickets', `Configured ticket category ${categoryId} was not found in ${guild.name}`);
    return false;
  }

  const existing = category.permissionOverwrites.cache.get(botId);
  if (existing?.allow.has(PermissionFlags.ViewChannel) && existing.allow.has(PermissionFlags.ManageChannels)) {
    return false;
  }

  await category.permissionOverwrites.edit(botId, {
    type: OverwriteType.Member,
    allow: String(TICKET_CATEGORY_BOT_PERMISSIONS),
    deny: '0',
  });
  return true;
}

export async function repairTicketCategoryPermissions(client: Client): Promise<void> {
  const botId = client.user?.id;
  if (!botId) return;

  let settings: Array<{ guildId: string; ticketCategoryId?: string | null }>;
  try {
    settings = await GuildSettings.find({ ticketCategoryId: { $exists: true, $nin: [null, ''] } })
      .select('guildId ticketCategoryId')
      .lean();
  } catch (error) {
    log.warn('Tickets', `Could not load ticket categories for permission repair: ${messageFromError(error)}`);
    return;
  }

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const setting of settings) {
    if (!setting.ticketCategoryId) continue;
    const guild = client.guilds?.get(setting.guildId);
    if (!guild) {
      skipped++;
      continue;
    }

    try {
      if (await ensureTicketCategoryPermissions(guild, setting.ticketCategoryId, client)) updated++;
      else skipped++;
    } catch (error) {
      failed++;
      log.warn(
        'Tickets',
        `Could not update ticket category ${setting.ticketCategoryId} in ${guild.name}: ${messageFromError(error)}`,
      );
    }
  }

  log.info(
    'Tickets',
    `Category permission repair complete: ${updated} updated, ${skipped} already valid/skipped, ${failed} failed`,
  );
}
