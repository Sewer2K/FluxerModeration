import { EmbedBuilder, PermissionFlags } from '@fluxerjs/core';
import type { Channel, Client, Guild, GuildChannel, GuildMember, Message, TextChannel } from '@fluxerjs/core';
import type { RESTPostAPIEmbed } from '@fluxerjs/types';
import settingsCache from './settingsCache';
import isNetworkError from './isNetworkError';
import * as embedQueue from './embedQueue';
import { resolveGuildChannel, sendWithPermRefresh } from './channelSend';
import type { IGuildSettings, UserLike } from '@/types';
import { isArray } from './isArray';
import { isTextChannel } from './isTextChannel';
import { asIntersection } from './asIntersection';

const REQUIRED_SEND_PERMS = ['ViewChannel', 'SendMessages', 'EmbedLinks'] as const;

const resolveLogChannel = resolveGuildChannel;

function channelPermDiag(me: GuildMember, channel: GuildChannel): string {
  if (!me?.permissionsIn || !channel) return 'channelPerms=UNAVAILABLE';
  try {
    const chanPerms = me.permissionsIn(channel);
    const chanPermList = REQUIRED_SEND_PERMS.map((p) => {
      const flag = PermissionFlags[p];
      return `${p}=${flag ? chanPerms.has(flag) : '?'}`;
    });
    return `channelPerms=[${chanPermList.join(', ')}]`;
  } catch {
    return 'channelPerms=ERROR_COMPUTING';
  }
}

function diagnosePermissions(guild: Guild, channelId: string, error: unknown, resolvedChannel: Channel | null): string {
  const parts: string[] = [];

  parts.push(`guild="${guild?.name ?? '?'}" (${guild?.id ?? '?'})`);
  parts.push(`channel=${channelId}`);

  const channel = (resolvedChannel ?? guild?.channels?.get(channelId)) as GuildChannel | undefined;
  if (channel && 'name' in channel) {
    parts.push(`channelName=#${channel.name}`);
  }

  const me = guild?.members?.me;
  if (!me) {
    parts.push('botMember=NOT_CACHED (guild.members.me is null)');
    return parts.join(' | ');
  }

  const guildPerms = me.permissions;
  if (guildPerms) {
    const guildPermList = REQUIRED_SEND_PERMS.map((p) => {
      const flag = PermissionFlags[p];
      return `${p}=${flag ? guildPerms.has(flag) : '?'}`;
    });
    parts.push(`guildPerms=[${guildPermList.join(', ')}]`);
  } else {
    parts.push('guildPerms=UNAVAILABLE');
  }

  if (channel) {
    parts.push(channelPermDiag(me, channel));
  } else {
    parts.push('channelPerms=CHANNEL_NOT_CACHED');
  }

  const roleIds = me.roles?.roleIds;
  if (roleIds) {
    const roleNames = roleIds.map((id: string) => guild.roles?.get(id)?.name ?? id).slice(0, 10);
    parts.push(`botRoles=[${roleNames.join(', ')}]`);
  }

  if (error && typeof error === 'object') {
    if ('code' in error && error.code) parts.push(`apiCode=${error.code}`);
    if ('statusCode' in error && error.statusCode) parts.push(`httpStatus=${error.statusCode}`);
  }

  return parts.join(' | ');
}

export const COLORS = asIntersection<Record<string, number>>()({
  ban: 0xe74c3c, // Red
  unban: 0x2ecc71, // Green
  kick: 0xe67e22, // Orange
  mute: 0xf1c40f, // Yellow
  unmute: 0x2ecc71, // Green
  timeout: 0xf1c40f, // Yellow
  warn: 0xf39c12, // Orange
  clearwarns: 0x3498db, // Blue
  clear: 0x9b59b6, // Purple
  automod: 0xe74c3c, // Red
  default: 0x95a5a6, // Gray
});

/**
 * you can set emojis here if you'd like, i dont like emojis **everywhere** so im leaving them blank but you do you
 */
export const EMOJIS: Record<string, string> = {
  ban: '',
  unban: '',
  kick: '',
  mute: '',
  unmute: '',
  timeout: '',
  warn: '',
  clearwarns: '',
  clear: '',
  automod: '',
  default: '',
};

export interface LogField {
  name: string;
  value: string;
  inline?: boolean;
}

interface LogOptions {
  action: string;
  title: string;
  fields?: LogField[];
  thumbnail?: string | null;
  footer?: string;
  description?: string;
  client?: Client;
}

interface ModActionExtra {
  fields?: LogField[];
  footer?: string;
  client?: Client;
}

export async function logToChannel(
  guild: Guild,
  settings: IGuildSettings | null,
  options: LogOptions,
): Promise<boolean> {
  let logChannelId: string | null | undefined;
  let logChannel: TextChannel | null = null;
  try {
    if (!settings) {
      settings = await settingsCache.get(guild.id);
    }

    logChannelId = settings?.moderation?.logChannelId || settings?.logChannelId;

    if (!logChannelId) {
      return false;
    }

    logChannel = await resolveLogChannel(guild, logChannelId, options.client);

    if (!logChannel) {
      return false;
    }

    const { action, title, fields, thumbnail, footer, description } = options;

    const logStyle = settings?.moderation?.logStyle ?? 'embed';

    if (logStyle === 'text') {
      const parts: string[] = [`**[${title}]**`];
      if (description) parts.push(description);
      if (fields && isArray(fields)) {
        for (const field of fields) {
          parts.push(`${field.name}: ${field.value || 'None'}`);
        }
      }
      if (footer) parts.push(`_${footer}_`);
      await sendWithPermRefresh(guild, logChannelId, logChannel, { content: parts.join(' | ') }, options.client);
      return true;
    }

    const embed = new EmbedBuilder()
      .setTitle(`${EMOJIS[action] || EMOJIS.default} ${title}`)
      .setColor(COLORS[action] || COLORS.default)
      .setTimestamp(new Date());

    if (description) embed.setDescription(description);

    if (fields && isArray(fields)) {
      for (const field of fields) {
        embed.addFields({
          name: field.name,
          value: field.value || 'None',
          inline: field.inline ?? false,
        });
      }
    }

    if (thumbnail) {
      embed.setThumbnail(thumbnail);
    }

    if (footer) {
      embed.setFooter({ text: footer });
    }

    await sendWithPermRefresh(guild, logChannelId, logChannel, { embeds: [embed] }, options.client);
    return true;
  } catch (error: unknown) {
    if (
      error &&
      typeof error === 'object' &&
      (('code' in error && error.code === 'MISSING_PERMISSIONS') || ('statusCode' in error && error.statusCode === 403))
    ) {
      const diag = diagnosePermissions(guild, logChannelId ?? 'unknown', error, logChannel);
      console.error(`[logToChannel] MISSING_PERMISSIONS - ${diag}`);
    } else {
      console.error('Error logging to channel:', error);
    }
    return false;
  }
}

export async function logModAction(
  guild: Guild,
  moderator: UserLike,
  target: UserLike | null,
  action: string,
  reason = 'No reason provided',
  extra: ModActionExtra = {},
): Promise<boolean> {
  const fields: LogField[] = [];

  if (target) {
    fields.push({ name: 'User', value: `<@${target.id}> (${target.id})`, inline: true });
  }

  const moderatorLabel = moderator?.id ? `<@${moderator.id}> (${moderator.id})` : 'Unknown moderator';
  fields.push(
    { name: 'Moderator', value: moderatorLabel, inline: true },
    { name: 'Reason', value: reason, inline: false },
  );

  if (extra.fields && isArray(extra.fields)) {
    fields.push(...extra.fields);
  }

  const actionName = action.charAt(0).toUpperCase() + action.slice(1);
  const title = target ? `${actionName} - ${target.username || target.id}` : actionName;

  return logToChannel(guild, null, {
    action,
    title,
    fields,
    thumbnail: target?.avatarURL ? target.avatarURL() : null,
    footer: extra.footer,
    client: extra.client,
  });
}

// seems to be unused
export async function logAutomodAction(
  message: Message,
  action: string,
  reason: string,
  extra: ModActionExtra = {},
): Promise<boolean> {
  if (!message.guild) {
    // could use guildId to get guild here instead of exiting
    return false;
  }

  const fields: LogField[] = [
    { name: 'User', value: `<@${message.author.id}> (${message.author.id})`, inline: true },
    { name: 'Channel', value: `<#${message.channelId || message.channel?.id}>`, inline: true },
    { name: 'Reason', value: reason, inline: false },
  ];

  if (extra.fields && isArray(extra.fields)) {
    fields.push(...extra.fields);
  }

  return logToChannel(message.guild, null, {
    action: 'automod',
    title: `Automod: ${action}`,
    fields,
    thumbnail: message.author.avatarURL ? message.author.avatarURL() : null,
    client: extra.client,
  });
}

export async function sendEmbed(
  guild: Guild,
  channelId: string,
  embed: RESTPostAPIEmbed,
  client?: Client,
): Promise<boolean> {
  const channel = await resolveLogChannel(guild, channelId, client);
  if (!channel || !isTextChannel(channel)) return false;

  try {
    await sendWithPermRefresh(guild, channelId, channel, { embeds: [embed] }, client);
    return true;
  } catch (err: unknown) {
    if (isNetworkError(err)) {
      embedQueue.enqueue(guild.id, channelId, embed);
    } else if (
      err &&
      typeof err === 'object' &&
      (('code' in err && err.code === 'MISSING_PERMISSIONS') || ('statusCode' in err && err.statusCode === 403))
    ) {
      const diag = diagnosePermissions(guild, channelId, err, channel);
      console.error(`[sendEmbed] MISSING_PERMISSIONS - ${diag}`);
    } else {
      console.error('Error sending embed to channel:', err);
    }
    return false;
  }
}

export const LOG_CATEGORIES = ['member', 'voice', 'message', 'role', 'channel', 'reaction', 'server'] as const;
export type LogCategory = (typeof LOG_CATEGORIES)[number];

const EVENT_CATEGORIES: Partial<Record<string, LogCategory>> = {
  member_join: 'member',
  member_leave: 'member',
  member_role_update: 'member',
  global_ban: 'member',
  voice_join: 'voice',
  voice_leave: 'voice',
  voice_move: 'voice',
  message_delete: 'message',
  message_edit: 'message',
  channel_pins_update: 'message',
  role_create: 'role',
  role_delete: 'role',
  role_update: 'role',
  channel_create: 'channel',
  channel_delete: 'channel',
  channel_update: 'channel',
  reaction_add: 'reaction',
  reaction_remove: 'reaction',
  webhooks_update: 'server',
  guild_emojis_update: 'server',
  invite_create: 'server',
  invite_delete: 'server',
};

const bulkRoleUpdateSuppressionUntil = new Map<string, number>();

export function beginBulkRoleUpdateSuppression(guildId: string, durationMs = 10 * 60 * 1000): void {
  bulkRoleUpdateSuppressionUntil.set(guildId, Date.now() + Math.max(1000, durationMs));
}

export function endBulkRoleUpdateSuppression(guildId: string): void {
  bulkRoleUpdateSuppressionUntil.delete(guildId);
}

function isBulkRoleUpdateSuppressed(guildId: string): boolean {
  const until = bulkRoleUpdateSuppressionUntil.get(guildId);
  if (!until) return false;
  if (Date.now() > until) {
    bulkRoleUpdateSuppressionUntil.delete(guildId);
    return false;
  }
  return true;
}

export async function logServerEvent(
  guild: Guild,
  title: string,
  color: number,
  fields: LogField[],
  client?: Client,
  embedExtra: { description?: string; footer?: string; eventType?: string } = {},
): Promise<boolean> {
  const { eventType } = embedExtra;

  try {
    const settings = await settingsCache.get(guild.id).catch(() => null);

    if (eventType === 'member_role_update' && isBulkRoleUpdateSuppressed(guild.id)) {
      return false;
    }

    if (eventType && settings?.disabledLogEvents?.includes(eventType)) {
      return false;
    }

    let channelId: string | null = null;

    if (eventType) {
      const category = EVENT_CATEGORIES[eventType];
      if (category) {
        channelId = settings?.logChannelOverrides?.[category] || null;
      }
    }
    if (!channelId) {
      channelId = settings?.serverLogChannelId ?? null;
    }
    if (!channelId) return false;

    const logStyle = settings?.moderation?.logStyle ?? 'embed';

    if (logStyle === 'text') {
      const channel = await resolveLogChannel(guild, channelId, client);
      if (!channel) return false;
      const parts: string[] = [`**[${title}]**`];
      if (embedExtra.description) parts.push(embedExtra.description);
      for (const field of fields) {
        parts.push(`${field.name}: ${field.value || 'None'}`);
      }
      if (embedExtra.footer) parts.push(`_${embedExtra.footer}_`);
      try {
        await channel.send({ content: parts.join(' | ') });
        return true;
      } catch {
        return false;
      }
    }

    const embed = new EmbedBuilder().setTitle(title).setColor(color).setTimestamp(new Date());

    if (embedExtra.description) embed.setDescription(embedExtra.description);

    for (const field of fields) {
      embed.addFields({ name: field.name, value: field.value || 'None', inline: field.inline ?? false });
    }

    if (embedExtra.footer) embed.setFooter({ text: embedExtra.footer });

    return sendEmbed(guild, channelId, embed.toJSON(), client);
  } catch (err) {
    console.error('Error in logServerEvent:', err);
    return false;
  }
}
