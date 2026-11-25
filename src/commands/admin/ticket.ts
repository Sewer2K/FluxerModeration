import { EmbedBuilder, OverwriteType, PermissionFlags } from '@fluxerjs/core';
import type {
  Channel,
  Client,
  DMChannel,
  Guild,
  GuildMember,
  Message,
  MessageSendOptions,
  TextChannel,
} from '@fluxerjs/core';
import { Routes } from '@fluxerjs/types';
import type { Command, IGuildSettings } from '@/types';
import GuildSettings, { GuildSettingsDocument } from '@/models/GuildSettings';
import Ticket from '@/models/Ticket';
import settingsCache from '@/utils/settingsCache';
import isNetworkError from '@/utils/isNetworkError';
import { encodeReactionForRoute } from '@/utils/encodeReactionForRoute';
import { generateTranscriptHtml } from '@/utils/transcriptGenerator';
import { t, normalizeLocale } from '@/i18n';
import { isInUnion } from '@/utils/isInUnion';
import { isGuildTextChannel } from '@/utils/isGuildTextChannel';
import { isGuildChannel } from '@/utils/isGuildChannel';
import { messageFromError } from '@/utils/messageFromError';
import { isPermDenied } from '@/utils/permError';
import { isSendCapable, sendMessage } from '@/utils/sendMessage';
import activityService from '@/services/ActivityService';
import {
  ensureTicketCategoryPermissions,
  TICKET_BOT_CHANNEL_PERMISSIONS,
  ticketCategoryBotOverwrite,
} from '@/services/TicketPermissionService';
import resolveTicketUserId from '@/utils/resolveTicketUserId';
import config from '@/config';

const ticketCooldowns = new Map<string, number>();
const TICKET_COOLDOWN_MS = 10 * 60 * 1000;

export function getTicketRuntimeState(): { cooldowns: number } {
  return { cooldowns: ticketCooldowns.size };
}

function ticketChannelCreateError(error: unknown): string {
  return isPermDenied(error)
    ? `${config.branding.publicName} needs Manage Channels in the configured ticket category.`
    : `${messageFromError(error)}`;
}

function checkTicketCooldown(guildId: string, userId: string): { allowed: boolean; remaining?: string } {
  const key = `${guildId}:${userId}`;
  const now = Date.now();
  const lastCreated = ticketCooldowns.get(key);
  if (lastCreated && now - lastCreated < TICKET_COOLDOWN_MS) {
    const remaining = Math.ceil((TICKET_COOLDOWN_MS - (now - lastCreated)) / 1000);
    const mins = Math.floor(remaining / 60);
    const secs = remaining % 60;
    return { allowed: false, remaining: mins > 0 ? `${mins}m ${secs}s` : `${secs}s` };
  }
  return { allowed: true };
}

function setTicketCooldown(guildId: string, userId: string): void {
  const key = `${guildId}:${userId}`;
  ticketCooldowns.set(key, Date.now());
  setTimeout(() => ticketCooldowns.delete(key), TICKET_COOLDOWN_MS);
}

function getSupportRoleIds(settings: IGuildSettings): string[] {
  const ids = new Set<string>(settings.ticketSupportRoleIds || []);
  if (settings.ticketSupportRoleId) ids.add(settings.ticketSupportRoleId);
  return [...ids];
}

async function getMemberWithTicketAccess(
  message: Message,
  guild: Guild,
  settings: IGuildSettings,
): Promise<{ ok: true; reason?: undefined; member: GuildMember } | { ok: false; reason: string }> {
  const lang = normalizeLocale(settings?.language);
  let member = guild.members?.get(message.author.id);
  if (!member) {
    try {
      member = await guild.fetchMember(message.author.id);
    } catch {}
  }
  if (!member) {
    return { ok: false, reason: t(lang, 'commands.admin.ticket.access.couldNotVerifyPermissionsRightNow') };
  }

  const supportRoleIds = getSupportRoleIds(settings);
  const memberRoleIds = member.roles?.roleIds ?? [];
  const isSupport = supportRoleIds.some((id: string) => memberRoleIds.includes(id));
  // guild owner can lack a populated permissions bitfield after resume (v2), same
  // as CommandHandler's owner bypass
  const isGuildOwner = guild.ownerId && String(guild.ownerId) === String(message.author.id);
  const isAdmin =
    isGuildOwner ||
    member.permissions?.has(PermissionFlags.ManageGuild) ||
    member.permissions?.has(PermissionFlags.Administrator);

  if (!isSupport && !isAdmin) {
    return { ok: false, reason: t(lang, 'commands.admin.ticket.access.supportRoleOrManageServer') };
  }

  return { ok: true, member };
}

async function save(settings: GuildSettingsDocument, guildId: string): Promise<void> {
  settings.markModified('ticketCategoryId');
  settings.markModified('ticketSetupChannelId');
  settings.markModified('ticketSetupMessageId');
  settings.markModified('ticketSupportRoleIds');
  settings.markModified('ticketLogChannelId');
  settings.markModified('ticketMaxOpen');
  settings.markModified('ticketOpenMessage');
  await settings.save();
  settingsCache.invalidate(guildId);
}

export async function createTicketForUser(
  guild: Guild,
  userId: string,
  settings: IGuildSettings,
  client: Client,
  subject?: string,
  prefix = '!',
): Promise<{ success: boolean; reason?: string; ticketNumber?: number; channelId?: string }> {
  const lang = normalizeLocale(settings?.language);
  const maxOpen = settings.ticketMaxOpen || 3;
  const openTickets = await Ticket.countDocuments({ guildId: guild.id, openedBy: userId, status: 'open' });
  if (openTickets >= maxOpen) {
    return {
      success: false,
      reason: t(lang, 'commands.admin.ticket.user.reasons.maxOpenTickets', { openTickets, maxOpen }),
    };
  }

  const cooldown = checkTicketCooldown(guild.id, userId);
  if (!cooldown.allowed) {
    return {
      success: false,
      reason: t(lang, 'commands.admin.ticket.user.reasons.waitCooldown', { remaining: cooldown.remaining }),
    };
  }

  const ticketNumber = await Ticket.getNextNumber(guild.id);
  const channelName = `ticket-${String(ticketNumber).padStart(4, '0')}`;

  const botId = client.user?.id;
  const everyoneRoleId = guild.id;
  const overwrites = [
    { id: everyoneRoleId, type: 0, allow: '0', deny: String(PermissionFlags.ViewChannel) },
    { id: userId, type: 1, allow: String(PermissionFlags.ViewChannel | PermissionFlags.SendMessages), deny: '0' },
  ];

  if (botId) {
    overwrites.push({
      id: botId,
      type: 1,
      allow: String(TICKET_BOT_CHANNEL_PERMISSIONS),
      deny: '0',
    });
  }

  const supportRoleIds = getSupportRoleIds(settings);
  for (const roleId of supportRoleIds) {
    overwrites.push({
      id: roleId,
      type: 0,
      allow: String(PermissionFlags.ViewChannel | PermissionFlags.SendMessages),
      deny: '0',
    });
  }

  let channel: TextChannel;
  try {
    channel = (await guild.createChannel({
      type: 0,
      name: channelName,
      parentId: settings.ticketCategoryId,
      topic: subject ? `Ticket #${ticketNumber} - ${subject}` : `Ticket #${ticketNumber} - Opened by <@${userId}>`,
      permissionOverwrites: overwrites,
    })) as TextChannel; /* cast used as `type: 0` is specified in options */
  } catch (err) {
    return {
      success: false,
      reason: t(lang, 'commands.admin.ticket.user.reasons.failedToCreateChannel', {
        error: ticketChannelCreateError(err),
      }),
    };
  }

  await Ticket.create({
    guildId: guild.id,
    channelId: channel.id,
    openedBy: userId,
    ticketNumber,
    subject: subject || null,
    participants: [userId],
  });
  activityService.recordTicket(guild.id);

  const replaceVars = (text: string) =>
    text
      .replace(/\{user\}/gi, `<@${userId}>`)
      .replace(/\{server\}/gi, guild.name)
      .replace(/\{ticket\}/gi, `#${ticketNumber}`)
      .replace(/\\n/g, '\n');

  let openMsg: string;
  if (settings.ticketOpenMessage) {
    openMsg = replaceVars(settings.ticketOpenMessage);
  } else {
    openMsg = t(lang, 'commands.admin.ticket.user.defaultOpenMessage', { userId, prefix });
  }

  const embed = new EmbedBuilder()
    .setTitle(t(lang, 'commands.admin.ticket.user.ticketEmbed.title', { ticketNumber }))
    .setDescription(openMsg)
    .setColor(0x5865f2);

  if (subject) {
    embed.addFields({
      name: t(lang, 'commands.admin.ticket.user.ticketEmbed.subjectField'),
      value: subject,
      inline: false,
    });
  }

  try {
    await channel.send({ embeds: [embed] });
  } catch {}

  if (supportRoleIds.length > 0) {
    try {
      const ping = await channel.send({ content: supportRoleIds.map((id: string) => `<@&${id}>`).join(' ') });
      setTimeout(() => ping.delete().catch(() => {}), 3000);
    } catch {}
  }

  setTicketCooldown(guild.id, userId);
  return { success: true, ticketNumber, channelId: channel.id };
}

async function postTicketPanel(
  targetChannel: TextChannel | DMChannel,
  guild: Guild,
  settings: GuildSettingsDocument,
  client: Client,
): Promise<Message> {
  const lang = normalizeLocale(settings?.language);
  const emoji = settings.ticketEmoji || '\uD83C\uDFAB';

  const embed = new EmbedBuilder()
    .setTitle(t(lang, 'commands.admin.ticket.user.panelEmbed.title'))
    .setDescription(t(lang, 'commands.admin.ticket.user.panelEmbed.description', { emoji }))
    .setColor(0x5865f2)
    .setFooter({ text: t(lang, 'commands.admin.ticket.user.panelEmbed.footer') });

  const panelMsg = await targetChannel.send({ embeds: [embed] });

  let emojiForReact = emoji;
  if (typeof client?.resolveEmoji === 'function') {
    try {
      const resolved = await client.resolveEmoji(emoji, guild.id);
      if (typeof resolved === 'string' && resolved.trim()) emojiForReact = resolved.trim();
    } catch {
      /* use raw */
    }
  }

  const restPutReaction = async () => {
    const encoded = encodeReactionForRoute(emojiForReact);
    await client.rest.put(`${Routes.channelMessageReaction(targetChannel.id, panelMsg.id, encoded)}/@me`);
  };

  try {
    await panelMsg.react(emojiForReact);
  } catch (err) {
    console.warn(`[${guild.name}] ticket panel react() failed, trying REST: ${messageFromError(err)}`);
    try {
      await restPutReaction();
    } catch (restErr) {
      console.warn(`[${guild.name}] Failed to add ticket reaction: ${messageFromError(restErr)}`);
    }
  }

  settings.ticketSetupChannelId = targetChannel.id;
  settings.ticketSetupMessageId = panelMsg.id;
  await save(settings, guild.id);

  return panelMsg;
}

const SUBCOMMAND_LITERALS = ['setup', 'claim', 'close', 'add', 'remove', 'panel'] as const;

const subcommands: Record<
  (typeof SUBCOMMAND_LITERALS)[number],
  (
    message: Message,
    args: string[],
    guild: Guild,
    settings: GuildSettingsDocument,
    client: Client,
    prefix: string,
  ) => Promise<void>
> = {
  async setup(message, args, guild, settings, client, prefix): Promise<void> {
    const sub = args[0]?.toLowerCase();
    const lang = normalizeLocale(settings?.language);

    if (sub === 'category') {
      const val = args[1];
      if (!val) return void (await message.reply(t(lang, 'commands.admin.ticket.setup.category.usage', { prefix })));

      if (val.toLowerCase() === 'create') {
        try {
          const botId = client.user?.id;
          const category = await guild.createChannel({
            type: 4,
            name: 'Tickets',
            permissionOverwrites: botId ? [ticketCategoryBotOverwrite(botId)] : undefined,
          });
          settings.ticketCategoryId = category.id;
          await save(settings, guild.id);
          return void (await message.reply(
            t(lang, 'commands.admin.ticket.setup.category.created', { categoryId: category.id }),
          ));
        } catch (err) {
          return void (await message.reply(
            t(lang, 'commands.admin.ticket.setup.category.failedToCreate', { error: `${messageFromError(err)}` }),
          ));
        }
      }

      const categoryId = val.match(/^\d{17,19}$/)?.[0];
      if (!categoryId)
        return void (await message.reply(t(lang, 'commands.admin.ticket.setup.category.invalidCategoryId')));
      settings.ticketCategoryId = categoryId;
      await save(settings, guild.id);
      try {
        await ensureTicketCategoryPermissions(guild, categoryId, client);
      } catch (error) {
        console.warn(`[${guild.name}] Could not repair ticket category permissions: ${messageFromError(error)}`);
      }
      return void (await message.reply(t(lang, 'commands.admin.ticket.setup.category.setDone', { categoryId })));
    }

    if (sub === 'channel') {
      if (!settings.ticketCategoryId) {
        return void (await message.reply(t(lang, 'commands.admin.ticket.setup.channel.setupFirst', { prefix })));
      }

      const val = args[1];

      if (!val || val.toLowerCase() === 'create') {
        try {
          const everyoneRoleId = guild.id;
          const botId = client.user?.id;

          const overwrites = [
            {
              id: everyoneRoleId,
              type: 0,
              allow: String(
                PermissionFlags.ViewChannel | PermissionFlags.AddReactions | PermissionFlags.ReadMessageHistory,
              ),
              deny: String(PermissionFlags.SendMessages),
            },
          ];

          if (botId) {
            overwrites.push({
              id: botId,
              type: 1,
              allow: String(TICKET_BOT_CHANNEL_PERMISSIONS | PermissionFlags.AddReactions),
              deny: '0',
            });
          }

          const ticketChannel = (await guild.createChannel({
            type: 0,
            name: 'make-a-ticket',
            parentId: settings.ticketCategoryId,
            topic: 'React to the message below to create a support ticket!',
            permissionOverwrites: overwrites,
          })) as TextChannel; /* cast used as `type: 0` is specified in options */

          await postTicketPanel(ticketChannel, guild, settings, client);
          return void (await message.reply(
            t(lang, 'commands.admin.ticket.setup.channel.created', { channelId: ticketChannel.id }),
          ));
        } catch (err) {
          return void (await message.reply(
            t(lang, 'commands.admin.ticket.setup.channel.failedToCreate', { error: ticketChannelCreateError(err) }),
          ));
        }
      }

      const channelId = val.match(/^<#(\d{17,19})>$/)?.[1] ?? (val.match(/^\d{17,19}$/)?.[0] || null);
      if (!channelId) {
        return void (await message.reply(t(lang, 'commands.generic.invalidChannelInput')));
      }

      let targetChannel: Channel | null = guild.channels?.get(channelId) ?? null;
      if (!targetChannel) {
        targetChannel = await client.channels.fetch(channelId).catch(() => null);
      }
      if (!targetChannel || !isGuildTextChannel(targetChannel)) {
        return void (await message.reply(t(lang, 'commands.admin.ticket.setup.channel.couldNotFind')));
      }

      const botId = client.user?.id;
      if (botId) {
        try {
          await targetChannel.permissionOverwrites.edit(botId, {
            type: OverwriteType.Member,
            allow: String(
              PermissionFlags.ViewChannel |
                PermissionFlags.SendMessages |
                PermissionFlags.ManageMessages |
                PermissionFlags.ManageChannels |
                PermissionFlags.AddReactions |
                PermissionFlags.ReadMessageHistory |
                PermissionFlags.EmbedLinks,
            ),
          });
        } catch {
          return void (await message.reply(
            t(lang, 'commands.admin.ticket.setup.channel.botPermissionUpdateFailed', { channelId }),
          ));
        }
      }

      try {
        await postTicketPanel(targetChannel, guild, settings, client);
        return void (await message.reply(t(lang, 'commands.admin.ticket.setup.channel.panelPosted', { channelId })));
      } catch (err) {
        return void (await message.reply(
          t(lang, 'commands.admin.ticket.setup.channel.failedToPostPanel', { error: `${messageFromError(err)}` }),
        ));
      }
    }

    if (sub === 'role') {
      const action = args[1]?.toLowerCase();
      const val = args[2];

      if (!action) {
        const roleIds = getSupportRoleIds(settings);
        if (roleIds.length === 0)
          return void (await message.reply(t(lang, 'commands.admin.ticket.setup.role.noSupportRoles', { prefix })));
        return void (await message.reply(
          t(lang, 'commands.admin.ticket.setup.role.list', {
            count: roleIds.length,
            roleList: roleIds.map((id: string) => `<@&${id}>`).join(', '),
          }),
        ));
      }

      if (action === 'clear') {
        settings.ticketSupportRoleId = null;
        settings.ticketSupportRoleIds = [];
        await save(settings, guild.id);
        return void (await message.reply(t(lang, 'commands.admin.ticket.setup.role.clearedAll')));
      }

      if (action === 'add') {
        if (!val) return void (await message.reply(t(lang, 'commands.admin.ticket.setup.role.addUsage', { prefix })));
        const roleId = val.match(/^<@&(\d{17,19})>$/)?.[1] ?? (val.match(/^\d{17,19}$/)?.[0] || null);
        if (!roleId) return void (await message.reply(t(lang, 'commands.generic.invalidRoleInput')));
        const current = getSupportRoleIds(settings);
        if (current.includes(roleId))
          return void (await message.reply(t(lang, 'commands.admin.ticket.setup.role.alreadySupportRole', { roleId })));
        if (current.length >= 10)
          return void (await message.reply(t(lang, 'commands.admin.ticket.setup.role.maxSupportRoles')));
        settings.ticketSupportRoleIds = [...new Set([...current, roleId])];
        settings.ticketSupportRoleId =
          settings.ticketSupportRoleIds[0]!; /* per above, this contains at least the `roleId` element */
        await save(settings, guild.id);
        return void (await message.reply(
          t(lang, 'commands.admin.ticket.setup.role.added', { roleId, total: settings.ticketSupportRoleIds.length }),
        ));
      }

      if (action === 'remove') {
        if (!val)
          return void (await message.reply(t(lang, 'commands.admin.ticket.setup.role.removeUsage', { prefix })));
        const roleId = val.match(/^<@&(\d{17,19})>$/)?.[1] ?? (val.match(/^\d{17,19}$/)?.[0] || null);
        if (!roleId) return void (await message.reply(t(lang, 'commands.generic.invalidRoleInput')));
        const current = getSupportRoleIds(settings);
        if (!current.includes(roleId))
          return void (await message.reply(t(lang, 'commands.admin.ticket.setup.role.notSupportRole', { roleId })));
        const updated = current.filter((id: string) => id !== roleId);
        settings.ticketSupportRoleIds = updated;
        settings.ticketSupportRoleId = updated[0] || null;
        await save(settings, guild.id);
        return void (await message.reply(
          t(lang, 'commands.admin.ticket.setup.role.removed', { roleId, remaining: updated.length }),
        ));
      }

      const roleId = action.match(/^<@&(\d{17,19})>$/)?.[1] ?? (action.match(/^\d{17,19}$/)?.[0] || null);
      if (roleId) {
        const current = getSupportRoleIds(settings);
        if (current.length >= 10)
          return void (await message.reply(t(lang, 'commands.admin.ticket.setup.role.maxSupportRoles')));
        settings.ticketSupportRoleIds = [...new Set([...current, roleId])];
        settings.ticketSupportRoleId =
          settings.ticketSupportRoleIds[0]!; /* per above, this contains at least the `roleId` element */
        await save(settings, guild.id);
        return void (await message.reply(
          t(lang, 'commands.admin.ticket.setup.role.added', { roleId, total: settings.ticketSupportRoleIds.length }),
        ));
      }

      return void (await message.reply(t(lang, 'commands.admin.ticket.setup.role.generalListUsage', { prefix })));
    }

    if (sub === 'log') {
      const val = args[1];
      if (!val) return void (await message.reply(t(lang, 'commands.admin.ticket.setup.log.usage', { prefix })));
      if (val.toLowerCase() === 'clear') {
        settings.ticketLogChannelId = null;
        await save(settings, guild.id);
        return void (await message.reply(t(lang, 'commands.admin.ticket.setup.log.cleared')));
      }
      const channelId = val.match(/^<#(\d{17,19})>$/)?.[1] ?? (val.match(/^\d{17,19}$/)?.[0] || null);
      if (!channelId) return void (await message.reply(t(lang, 'commands.generic.invalidChannelInput')));
      settings.ticketLogChannelId = channelId;
      await save(settings, guild.id);
      return void (await message.reply(t(lang, 'commands.admin.ticket.setup.log.setDone', { channelId })));
    }

    if (sub === 'max') {
      let val: number;
      // assigns `val` within if statement
      if (!('1' in args) || ((val = parseInt(args[1])), isNaN(val) || val < 1 || val > 10)) {
        return void (await message.reply(t(lang, 'commands.admin.ticket.setup.max.usage', { prefix })));
      }
      settings.ticketMaxOpen = val;
      await save(settings, guild.id);
      return void (await message.reply(t(lang, 'commands.admin.ticket.setup.max.setDone', { maxOpen: val })));
    }

    if (sub === 'message') {
      const val = args.slice(1).join(' ').trim();
      if (!val) return void (await message.reply(t(lang, 'commands.admin.ticket.setup.message.usage', { prefix })));
      if (val.toLowerCase() === 'clear') {
        settings.ticketOpenMessage = null;
        await save(settings, guild.id);
        return void (await message.reply(t(lang, 'commands.admin.ticket.setup.message.cleared')));
      }
      if (val.length > 1000) return void (await message.reply(t(lang, 'commands.admin.ticket.setup.message.tooLong')));
      settings.ticketOpenMessage = val;
      await save(settings, guild.id);
      return void (await message.reply(t(lang, 'commands.admin.ticket.setup.message.setDone')));
    }

    const cat = settings.ticketCategoryId
      ? `<#${settings.ticketCategoryId}>`
      : t(lang, 'commands.admin.ticket.setupEmbed.notSet');
    const roleIds = getSupportRoleIds(settings);
    const role =
      roleIds.length > 0
        ? roleIds.map((id: string) => `<@&${id}>`).join(', ')
        : t(lang, 'commands.admin.ticket.setupEmbed.notSet');
    const log = settings.ticketLogChannelId
      ? `<#${settings.ticketLogChannelId}>`
      : t(lang, 'commands.admin.ticket.setupEmbed.notSet');
    const setupCh = settings.ticketSetupChannelId
      ? `<#${settings.ticketSetupChannelId}>`
      : t(lang, 'commands.admin.ticket.setupEmbed.notSet');

    const embed = new EmbedBuilder()
      .setTitle(t(lang, 'commands.admin.ticket.setupEmbed.title'))
      .setColor(0x5865f2)
      .addFields(
        { name: t(lang, 'commands.admin.ticket.setupEmbed.fields.category'), value: cat, inline: true },
        { name: t(lang, 'commands.admin.ticket.setupEmbed.fields.ticketChannel'), value: setupCh, inline: true },
        { name: t(lang, 'commands.admin.ticket.setupEmbed.fields.supportRole'), value: role, inline: true },
        { name: t(lang, 'commands.admin.ticket.setupEmbed.fields.logChannel'), value: log, inline: true },
        {
          name: t(lang, 'commands.admin.ticket.setupEmbed.fields.maxOpen'),
          value: String(settings.ticketMaxOpen || 3),
          inline: true,
        },
        {
          name: t(lang, 'commands.admin.ticket.setupEmbed.fields.customMessage'),
          value: settings.ticketOpenMessage
            ? t(lang, 'commands.admin.ticket.setupEmbed.customMessageValues.set')
            : t(lang, 'commands.admin.ticket.setupEmbed.customMessageValues.default'),
          inline: true,
        },
        {
          name: t(lang, 'commands.admin.ticket.setupEmbed.fields.setupCommands'),
          value: t(lang, 'commands.admin.ticket.setupEmbed.setupCommands', { prefix }),
          inline: false,
        },
      );

    return void (await message.reply({ embeds: [embed] }));
  },

  async claim(message, args, guild, settings, _client, _prefix) {
    const lang = normalizeLocale(settings?.language);
    const access = await getMemberWithTicketAccess(message, guild, settings);
    if (!access.ok) return void (await message.reply(access.reason));

    const channelId = message.channelId;
    const ticket = await Ticket.findOne({ channelId, status: 'open' });
    if (!ticket) return void (await message.reply(t(lang, 'commands.admin.ticket.notOpenError')));

    if (ticket.claimedBy) {
      return void (await message.reply(
        t(lang, 'commands.admin.ticket.claim.alreadyClaimed', { claimedBy: ticket.claimedBy }),
      ));
    }

    ticket.claimedBy = message.author.id;
    ticket.claimedAt = new Date();
    await ticket.save();

    const embed = new EmbedBuilder()
      .setTitle(t(lang, 'commands.admin.ticket.user.claimEmbed.title', { ticketNumber: ticket.ticketNumber }))
      .setDescription(t(lang, 'commands.admin.ticket.user.claimEmbed.description', { userId: message.author.id }))
      .setColor(0x2ecc71);

    return void (await message.reply({ embeds: [embed] }));
  },

  async close(message, args, guild, settings, client, _prefix) {
    const lang = normalizeLocale(settings?.language);

    // guild is already resolved by execute(). fluxer.js v2 leaves message.channel
    // undefined here, so don't gate on it: the ticket lookup below is the real
    // check (no open ticket in this channel -> notOpenError).
    const access = await getMemberWithTicketAccess(message, guild, settings);
    if (!access.ok) return void (await message.reply(access.reason));

    const channelId = message.channelId;
    const ticket = await Ticket.findOne({ channelId, status: 'open' });

    if (!ticket) {
      return void (await message.reply(t(lang, 'commands.admin.ticket.notOpenError')));
    }

    const reason = args.join(' ').trim() || t(lang, 'commands.generic.noReasonProvided');

    const embed = new EmbedBuilder()
      .setTitle(t(lang, 'commands.admin.ticket.user.closeEmbed.title', { ticketNumber: ticket.ticketNumber }))
      .setDescription(t(lang, 'commands.admin.ticket.user.closeEmbed.description', { userId: message.author.id }))
      .setColor(0xed4245)
      .addFields({ name: t(lang, 'commands.admin.ticket.user.closeEmbed.reasonField'), value: reason, inline: false });

    if (ticket.claimedBy) {
      embed.addFields({
        name: t(lang, 'commands.admin.ticket.user.closeEmbed.claimedByField'),
        value: `<@${ticket.claimedBy}>`,
        inline: true,
      });
    }

    ticket.status = 'closed';
    ticket.closedBy = message.author.id;
    ticket.closedAt = new Date();
    await ticket.save();

    try {
      let channel: Channel | null = guild.channels?.get(channelId) ?? null;
      if (!channel) channel = await client.channels.fetch(channelId).catch(() => null);
      if (channel?.isTextBased()) await channel.send({ embeds: [embed] });
    } catch {}

    if (settings.ticketLogChannelId) {
      try {
        let logChannel: Channel | null = guild.channels?.get(settings.ticketLogChannelId) ?? null;
        if (!logChannel)
          try {
            logChannel = await client.channels.fetch(settings.ticketLogChannelId);
          } catch {}
        if (logChannel?.isTextBased()) {
          const transcriptMessages = (ticket.transcript || []) as Array<{
            authorId: string;
            authorName: string;
            avatarURL?: string | null;
            content: string;
            attachments?: Array<{ url: string; name: string }>;
            timestamp: Date | string;
          }>;

          const logEmbed = new EmbedBuilder()
            .setTitle(
              t(lang, 'commands.admin.ticket.user.logEmbed.titleClosed', {
                ticketNumber: ticket.ticketNumber,
              }),
            )
            .setColor(0xed4245)
            .addFields({
              name: t(lang, 'commands.admin.ticket.user.logEmbed.openedByField'),
              value: `<@${ticket.openedBy}>`,
              inline: true,
            })
            .addFields({
              name: t(lang, 'commands.admin.ticket.user.logEmbed.closedByField'),
              value: `<@${message.author.id}>`,
              inline: true,
            });

          if (ticket.claimedBy) {
            logEmbed.addFields({
              name: t(lang, 'commands.admin.ticket.user.logEmbed.claimedByField'),
              value: `<@${ticket.claimedBy}>`,
              inline: true,
            });
          }

          logEmbed.addFields({
            name: t(lang, 'commands.admin.ticket.user.logEmbed.reasonField'),
            value: reason,
            inline: false,
          });

          if (ticket.subject) {
            logEmbed.addFields({
              name: t(lang, 'commands.admin.ticket.user.logEmbed.subjectField'),
              value: ticket.subject,
              inline: false,
            });
          }

          logEmbed.addFields({
            name: t(lang, 'commands.admin.ticket.user.logEmbed.messagesField'),
            value: String(transcriptMessages.length),
            inline: true,
          });

          const sendOpts: MessageSendOptions = { embeds: [logEmbed] };

          if (transcriptMessages.length > 0) {
            try {
              const nameCache = new Map<string, string>();
              for (const m of transcriptMessages) nameCache.set(m.authorId, m.authorName);

              const resolveName = async (id: string): Promise<string> => {
                if (nameCache.has(id)) return nameCache.get(id)!;
                try {
                  const user = await client.users.fetch(id);
                  const name = user.username || id;
                  nameCache.set(id, name);
                  return name;
                } catch {
                  return id;
                }
              };

              const openedByName = await resolveName(ticket.openedBy);
              const closedByName = message.author.username || message.author.id;
              const claimedByName = ticket.claimedBy ? await resolveName(ticket.claimedBy) : null;

              const html = await generateTranscriptHtml(
                {
                  guildName: guild.name,
                  ticketNumber: ticket.ticketNumber,
                  openedBy: openedByName,
                  claimedBy: claimedByName,
                  closedBy: closedByName,
                  subject: ticket.subject,
                  createdAt: ticket.createdAt,
                  closedAt: new Date(),
                  messages: transcriptMessages,
                },
                client.rest,
              );
              sendOpts.files = [
                {
                  name: `transcript-${ticket.ticketNumber}.html`,
                  data: Buffer.from(html, 'utf-8'),
                },
              ];
            } catch (err) {
              console.error(`[ticket] Failed to generate transcript: ${messageFromError(err)}`);
            }
          }

          if (isSendCapable(logChannel)) {
            await sendMessage(logChannel, sendOpts);
          }
        }
      } catch {}
    }

    const openedByUserId = ticket.openedBy;
    if (openedByUserId) {
      try {
        const transcriptMessages = (ticket.transcript || []) as Array<{
          authorId: string;
          authorName: string;
          avatarURL?: string | null;
          content: string;
          attachments?: Array<{ url: string; name: string }>;
          timestamp: Date | string;
        }>;
        const userEmbed = new EmbedBuilder()
          .setTitle(t(lang, 'commands.admin.ticket.user.dmEmbed.titleClosed', { ticketNumber: ticket.ticketNumber }))
          .setDescription(
            t(lang, 'commands.admin.ticket.user.dmEmbed.description', {
              guildName: guild.name,
              userId: message.author.id,
            }),
          )
          .setColor(0xed4245)
          .addFields({ name: t(lang, 'commands.admin.ticket.user.dmEmbed.reasonField'), value: reason, inline: false });
        const userSendOpts: MessageSendOptions = { embeds: [userEmbed] };
        if (transcriptMessages.length > 0) {
          try {
            const nameCache = new Map<string, string>();
            for (const m of transcriptMessages) nameCache.set(m.authorId, m.authorName);
            const resolveName = async (id: string): Promise<string> => {
              if (nameCache.has(id)) return nameCache.get(id)!;
              try {
                const username = await client.users.fetch(id);
                const name = username.username || id;
                nameCache.set(id, name);
                return name;
              } catch {
                return id;
              }
            };
            const openedByName = await resolveName(openedByUserId);
            const closedByName = message.author.username || message.author.id;
            const claimedByName = ticket.claimedBy ? await resolveName(ticket.claimedBy) : null;
            const html = await generateTranscriptHtml(
              {
                guildName: guild.name,
                ticketNumber: ticket.ticketNumber,
                openedBy: openedByName,
                claimedBy: claimedByName,
                closedBy: closedByName,
                subject: ticket.subject,
                createdAt: ticket.createdAt,
                closedAt: new Date(),
                messages: transcriptMessages,
              },
              client.rest,
            );
            userSendOpts.files = [{ name: `transcript-${ticket.ticketNumber}.html`, data: Buffer.from(html, 'utf-8') }];
          } catch (err) {
            console.error(`[ticket] Failed to generate transcript for DM: ${messageFromError(err)}`);
          }
        }
        const opener = await client.users.fetch(openedByUserId).catch(() => null);
        if (opener) await sendMessage(opener, userSendOpts);
      } catch {}
    }

    setTimeout(async () => {
      try {
        const ch = guild.channels?.get(channelId) || (await client.channels.fetch(channelId).catch(() => null));
        if (ch && isGuildChannel(ch)) await ch.delete();
      } catch {}
    }, 5000);
  },

  async add(message, args, guild, settings, client, prefix) {
    const lang = normalizeLocale(settings?.language);
    const access = await getMemberWithTicketAccess(message, guild, settings);
    if (!access.ok) return void (await message.reply(access.reason));

    const channelId = message.channelId;
    const ticket = await Ticket.findOne({ channelId, status: 'open' });
    if (!ticket) return void (await message.reply(t(lang, 'commands.admin.ticket.notOpenError')));

    const userId = resolveTicketUserId(message.mentions, args[0], message.content);
    if (!userId) return void (await message.reply(t(lang, 'commands.admin.ticket.add.usage', { prefix })));

    const channel = guild.channels.get(channelId);
    if (!channel) return void (await message.reply(t(lang, 'commands.admin.ticket.add.channelNotFound')));

    try {
      await channel.permissionOverwrites.edit(userId, {
        type: OverwriteType.Member,
        allow: String(PermissionFlags.ViewChannel | PermissionFlags.SendMessages),
      });

      if (!ticket.participants.includes(userId)) {
        ticket.participants.push(userId);
        await ticket.save();
      }

      return void (await message.reply(t(lang, 'commands.admin.ticket.add.added', { userId })));
    } catch (err) {
      return void (await message.reply(
        t(lang, 'commands.admin.ticket.add.failedToAddUser', { error: `${messageFromError(err)}` }),
      ));
    }
  },

  async remove(message, args, guild, settings, client, prefix) {
    const lang = normalizeLocale(settings?.language);
    const access = await getMemberWithTicketAccess(message, guild, settings);
    if (!access.ok) return void (await message.reply(access.reason));

    const channelId = message.channelId;
    const ticket = await Ticket.findOne({ channelId, status: 'open' });
    if (!ticket) return void (await message.reply(t(lang, 'commands.admin.ticket.notOpenError')));

    const userId = resolveTicketUserId(message.mentions, args[0], message.content);
    if (!userId) return void (await message.reply(t(lang, 'commands.admin.ticket.remove.usage', { prefix })));

    if (userId === ticket.openedBy)
      return void (await message.reply(t(lang, 'commands.admin.ticket.remove.openedByCannotRemove')));

    const channel = guild.channels?.get(channelId);
    if (!channel) return void (await message.reply(t(lang, 'commands.admin.ticket.remove.channelNotFound')));

    try {
      await channel.permissionOverwrites.delete(userId);
      ticket.participants = ticket.participants.filter((id: string) => id !== userId);
      await ticket.save();
      return void (await message.reply(t(lang, 'commands.admin.ticket.remove.removed', { userId })));
    } catch (err) {
      return void (await message.reply(
        t(lang, 'commands.admin.ticket.remove.failedToRemoveUser', { error: `${messageFromError(err)}` }),
      ));
    }
  },

  async panel(message, args, guild, settings, client, prefix) {
    const lang = normalizeLocale(settings?.language);
    if (!settings.ticketCategoryId) {
      return void (await message.reply(t(lang, 'commands.admin.ticket.panel.ticketNotSetup', { prefix })));
    }

    const channelMention = args[0];
    const channelId =
      (channelMention?.match(/^<#(\d{17,19})>$/)?.[1] ?? (channelMention?.match(/^\d{17,19}$/)?.[0] || null)) ||
      message.channelId;

    let targetChannel: Channel | null = guild.channels.get(channelId) ?? null;
    if (!targetChannel) {
      targetChannel = await client.channels.fetch(channelId).catch(() => null);
    }
    if (!targetChannel || !isGuildTextChannel(targetChannel)) {
      return void (await message.reply(t(lang, 'commands.admin.ticket.panel.channelNotFound')));
    }

    try {
      await postTicketPanel(targetChannel, guild, settings, client);
      if (channelId !== (message.channelId || message.channel?.id)) {
        return void (await message.reply(t(lang, 'commands.admin.ticket.panel.posted', { channelId })));
      }
    } catch (err) {
      return void (await message.reply(
        t(lang, 'commands.admin.ticket.panel.failedToSend', { error: `${messageFromError(err)}` }),
      ));
    }
  },
};

async function showHelp(message: Message, prefix: string, lang: string) {
  await message.reply(
    t(lang, 'commands.admin.ticket.help.body', {
      prefix,
    }),
  );
}

const command: Command = {
  name: 'ticket',
  description: 'Support ticket system - create, manage, and close tickets.',
  usage: '<close|add|remove|panel|setup> [options]',
  category: 'admin',
  permissions: [],
  cooldown: 3,

  async execute(message, args, client, prefix = '!'): Promise<void> {
    let guild = message.guild;
    if (!guild && message.guildId) guild = await client.guilds.fetch(message.guildId);
    if (!guild) return void (await message.reply(t('en', 'commands.generic.serverOnly')));

    const sub = args[0]?.toLowerCase();

    let settings: GuildSettingsDocument;
    let lang = 'en';
    try {
      settings = await GuildSettings.getOrCreate(guild.id);
      lang = normalizeLocale(settings?.language);
    } catch (error) {
      const guildName = guild?.name || 'Unknown Server';
      if (isNetworkError(error)) {
        console.warn(`[${guildName}] Fluxer API unreachable during !ticket (ECONNRESET)`);
      } else {
        console.error(`[${guildName}] Error in !ticket: ${messageFromError(error)}`);
      }
      message.reply(t(lang, 'commands.admin.ticket.processingError')).catch(() => {});
      return;
    }

    if (sub === 'open') return void (await message.reply(t(lang, 'commands.admin.ticket.openNotice', { prefix })));

    if (!isInUnion(sub, SUBCOMMAND_LITERALS) || !subcommands[sub]) {
      return void (await showHelp(message, prefix, lang));
    }

    if (sub === 'setup' || sub === 'panel') {
      let member = guild.members?.get(message.author.id);
      if (!member)
        try {
          member = await guild.fetchMember(message.author.id);
        } catch {}
      if (member) {
        const perms = member.permissions;
        if (!perms?.has(PermissionFlags.ManageGuild) && !perms?.has(PermissionFlags.Administrator)) {
          return void (await message.reply(t(lang, 'commands.admin.ticket.missingManageServerPermission')));
        }
      }
    }

    try {
      await subcommands[sub](message, args.slice(1), guild, settings, client, prefix);
    } catch (error) {
      const guildName = guild?.name || 'Unknown Server';
      if (isNetworkError(error)) {
        console.warn(`[${guildName}] Fluxer API unreachable during !ticket (ECONNRESET)`);
      } else {
        console.error(`[${guildName}] Error in !ticket: ${messageFromError(error)}`);
        message.reply(t(lang, 'commands.admin.ticket.processingError')).catch(() => {});
      }
    }
  },
};

export default command;
