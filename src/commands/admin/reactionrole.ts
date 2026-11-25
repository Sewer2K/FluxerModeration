import type { Channel, Client, Guild, Message } from '@fluxerjs/core';
import { APIRole, RESTPostAPIEmbed, Routes } from '@fluxerjs/types';
import type { Command, IReactionRolesEntry, IReactionRolesRole } from '@/types';
import GuildSettings from '@/models/GuildSettings';
import settingsCache from '@/utils/settingsCache';
import { canManageRole } from '@/utils/permissions';
import isNetworkError from '@/utils/isNetworkError';
import { t, normalizeLocale } from '@/i18n';
import { isTextChannel } from '@/utils/isTextChannel';
import { isArray } from '@/utils/isArray';
import { messageFromError } from '@/utils/messageFromError';

async function resolveChannel(arg: string, guild: Guild, client: Client): Promise<Channel | null> {
  const idMatch = /^<#(\d+)>$/.exec(arg) || /^(\d+)$/.exec(arg);
  if (idMatch) {
    const id = idMatch[1];
    if (!id) return null;
    let ch: Channel | null = guild.channels.get(id) ?? null;
    if (!ch) {
      try {
        ch = await client.channels.resolve(id);
      } catch {}
    }
    return ch || null;
  }

  const name = arg.replace(/^#/, '').toLowerCase();
  for (const ch of guild.channels.values()) {
    if (ch.name && ch.name.toLowerCase() === name) return ch;
  }
  return null;
}

export function parseRoleId(str: string): string | null {
  const value = str.trim();
  const match = /^<@&?(\d+)>$/.exec(value) || /^<(\d+)>$/.exec(value) || /^(\d+)$/.exec(value);
  return match?.[1] ?? null;
}

function normalizeEmoji(str: string): string {
  const mention = /^<a?:(\w+):(\d+)>$/.exec(str);
  if (mention) return `${mention[1]}:${mention[2]}`;
  const colon = /^a?:(\w+):(\d+)$/.exec(str);
  if (colon) return `${colon[1]}:${colon[2]}`;
  return str.replace(/[\uFE00-\uFE0F\u200D]/g, '').trim();
}

function isUnicodeEmoji(str: string): boolean {
  const stripped = str.replace(/[\uFE00-\uFE0F\u200D]/g, '').trim();
  return stripped.length > 0 && !/^[\x20-\x7E]+$/.test(stripped);
}

export function normalizeEmojiInput(str: string): string {
  const value = str.trim();
  const wrapped = /^<(.+)>$/.exec(value)?.[1]?.trim();
  return wrapped && isUnicodeEmoji(wrapped) ? wrapped : value;
}

async function safeResolveEmoji(client: Client, emojiArg: string, guildId: string): Promise<string | null> {
  const input = normalizeEmojiInput(emojiArg);
  try {
    const resolved = await client.resolveEmoji(input, guildId);
    return normalizeEmoji(resolved);
  } catch {}
  if (isUnicodeEmoji(input)) {
    return normalizeEmoji(input);
  }
  const normalized = normalizeEmoji(input);
  if (normalized !== input) return normalized;
  return null;
}

function stripBrackets(s: string): string {
  return s.replace(/^<|>$/g, '');
}

function formatEmojiDisplay(emoji: string): string {
  if (/^\d+$/.test(emoji)) return `<:_:${emoji}>`;
  if (/^\w+:\d+$/.test(emoji)) return `<:${emoji}>`;
  return emoji;
}

async function rebuildPanelBody(rr: IReactionRolesEntry, guild: Guild, client: Client): Promise<void> {
  try {
    const channel = guild.channels?.get(rr.channelId) ?? (await client.channels.fetch(rr.channelId).catch(() => null));
    if (!channel?.isTextBased()) return;
    const panelMessage = await channel.messages.fetch(rr.messageId).catch(() => null);
    if (!panelMessage) return;

    const lines = rr.roles.map((r) => {
      const emojiDisplay = formatEmojiDisplay(r.emoji);
      const roleIds: string[] = r.roleIds?.length ? r.roleIds : [r.roleId];
      const rolePart = roleIds
        .map((id: string) => {
          const role = guild.roles?.get(id);
          return role ? role.name : `<@&${id}>`;
        })
        .join(', ');
      return `${emojiDisplay} ${rolePart}`;
    });

    const newDescription = `React to get a role. React again to remove.\n\n${lines.join('\n')}`;
    await panelMessage.edit({
      content: rr.plainText ? newDescription : null,
      embeds: [{ description: newDescription, color: 0x5865f2 }],
    });
  } catch {
    // panel edit failure is non-fatal
  }
}

function extractRawText(content: string, skipTokens: number): string {
  let idx = 0;
  for (let i = 0; i < skipTokens; i++) {
    while (idx < content.length && content[idx] === ' ') idx++;
    while (idx < content.length && content[idx] !== ' ' && content[idx] !== '\n') idx++;
  }
  if (idx < content.length && content[idx] === ' ') idx++;
  return content.slice(idx).trim();
}

function usageEmbed(prefix: string, lang: string): RESTPostAPIEmbed {
  return {
    description: null,
    title: t(lang, 'commands.admin.reactionrole.help.title'),
    color: 0x5865f2,
    fields: [
      {
        name: t(lang, 'commands.admin.reactionrole.help.fieldPostName', { prefix }),
        value: t(lang, 'commands.admin.reactionrole.help.fieldPostValue'),
        inline: false,
      },
      {
        name: t(lang, 'commands.admin.reactionrole.help.fieldAddName', { prefix }),
        value: t(lang, 'commands.admin.reactionrole.help.fieldAddValue'),
        inline: false,
      },
      {
        name: t(lang, 'commands.admin.reactionrole.help.fieldAddMultiName', { prefix }),
        value: t(lang, 'commands.admin.reactionrole.help.fieldAddMultiValue'),
        inline: false,
      },
      {
        name: t(lang, 'commands.admin.reactionrole.help.fieldRemoveName', { prefix }),
        value: t(lang, 'commands.admin.reactionrole.help.fieldRemoveValue'),
        inline: false,
      },
      {
        name: t(lang, 'commands.admin.reactionrole.help.fieldEditName', { prefix }),
        value: t(lang, 'commands.admin.reactionrole.help.fieldEditValue'),
        inline: false,
      },
      {
        name: t(lang, 'commands.admin.reactionrole.help.fieldClearName', { prefix }),
        value: t(lang, 'commands.admin.reactionrole.help.fieldClearValue'),
        inline: false,
      },
      {
        name: t(lang, 'commands.admin.reactionrole.help.fieldListName', { prefix }),
        value: t(lang, 'commands.admin.reactionrole.help.fieldListValue'),
        inline: false,
      },
      {
        name: t(lang, 'commands.admin.reactionrole.help.fieldDmName', { prefix }),
        value: t(lang, 'commands.admin.reactionrole.help.fieldDmValue'),
        inline: false,
      },
      {
        name: t(lang, 'commands.admin.reactionrole.help.fieldSwitchName', { prefix }),
        value: t(lang, 'commands.admin.reactionrole.help.fieldSwitchValue'),
        inline: false,
      },
    ],
    footer: { text: t(lang, 'commands.admin.reactionrole.help.footer') },
  };
}

const command: Command = {
  name: 'reactionrole',
  description:
    'Create panels where users react with an emoji to get a role. Add --text to !rr post to show the panel outside the embed.',
  usage: '<post|add|remove|edit|clear|list|dm>',
  category: 'admin',
  aliases: ['rr'],
  permissions: ['ManageGuild'],

  async execute(message, args, client, prefix = '!') {
    const subcommand = args[0]?.toLowerCase();

    let guild = message.guild;
    if (!guild && message.guildId) {
      guild = await client.guilds.fetch(message.guildId);
    }
    if (!guild) return void (await message.reply(t('en', 'commands.generic.serverOnly')));
    const lang = normalizeLocale((await GuildSettings.getOrCreate(guild.id)).language);

    if (!subcommand) {
      return void (await message.reply({ embeds: [usageEmbed(prefix, lang)] }));
    }

    if (subcommand === 'post') {
      const channelArg = args[1];
      const plainText = args[2]?.toLowerCase() === '--text' || args[2]?.toLowerCase() === '--plain-text';
      const text = channelArg ? extractRawText(message.content, plainText ? 4 : 3) : '';

      if (!channelArg) {
        return void (await message.reply(t(lang, 'commands.admin.reactionrole.post.usage', { prefix })));
      }

      const channel = await resolveChannel(channelArg, guild, client);
      if (!channel?.isTextBased()) {
        return void (await message.reply(t(lang, 'commands.admin.reactionrole.common.channelNotFoundDetailed')));
      }

      const description = text || 'React below to get a role';

      try {
        const posted = await channel.send({
          ...(plainText ? { content: description } : {}),
          embeds: [
            {
              description,
              color: 0x5865f2,
            },
          ],
        });

        const settings = await GuildSettings.getOrCreate(guild.id);
        const exists = settings.reactionRoles.find((entry) => entry.messageId === posted.id);
        if (!exists) {
          settings.reactionRoles.push({ messageId: posted.id, channelId: channel.id, plainText, roles: [] });
          await settings.save();
          settingsCache.invalidate(guild.id);
        }

        return void (await message.reply(
          t(lang, 'commands.admin.reactionrole.post.success', {
            channelId: channel.id,
            messageId: posted.id,
            channelName: channel.name,
            prefix,
          }),
        ));
      } catch (err) {
        if (isNetworkError(err)) {
          console.warn(`[${guild?.name || 'Unknown Server'}] Fluxer API unreachable during !rr post (ECONNRESET)`);
        } else {
          console.error(`[${guild?.name || 'Unknown Server'}] Error in !rr post: ${messageFromError(err)}`);
          message.reply(t(lang, 'commands.admin.reactionrole.errors.postFailed')).catch(() => {});
        }
        return;
      }
    }

    if (subcommand === 'add') {
      const [, channelArg, rawMessageId, emojiArg, roleArg] = args;
      const messageId = rawMessageId ? stripBrackets(rawMessageId) : rawMessageId;

      if (!channelArg || !messageId || !emojiArg || !roleArg) {
        return void (await message.reply(t(lang, 'commands.admin.reactionrole.add.usage', { prefix })));
      }

      let roleId = parseRoleId(roleArg);
      if (!roleId) {
        try {
          roleId = await guild.resolveRoleId(roleArg);
        } catch {}
      }
      if (!roleId) return void (await message.reply(t(lang, 'commands.admin.reactionrole.add.invalidRole')));

      const emoji = await safeResolveEmoji(client, emojiArg, guild.id);
      if (!emoji) {
        return void (await message.reply(t(lang, 'commands.admin.reactionrole.common.invalidEmoji')));
      }

      const channel = await resolveChannel(channelArg, guild, client);
      if (!channel || !isTextChannel(channel)) {
        return void (await message.reply(t(lang, 'commands.admin.reactionrole.common.channelNotFound')));
      }

      let targetMessage: Message;
      try {
        targetMessage = await channel.messages.fetch(messageId);
      } catch {
        return void (await message.reply(t(lang, 'commands.admin.reactionrole.common.messageNotFoundDetailed')));
      }

      let role = guild.roles?.get(roleId);
      if (!role) {
        try {
          await guild.fetchRoles();
          role = guild.roles?.get(roleId);
        } catch {}
      }
      if (!role) {
        try {
          role = await guild.fetchRole(roleId);
        } catch {}
      }
      if (!role) return void (await message.reply(t(lang, 'commands.admin.reactionrole.add.roleNotFound')));

      let commandMember = guild.members?.get(message.author.id);
      if (!commandMember) {
        try {
          commandMember = await guild.fetchMember(message.author.id);
        } catch {}
      }
      if (commandMember) {
        const check = canManageRole(commandMember, role, guild);
        if (!check.allowed)
          return void (await message.reply(check.reason || t(lang, 'commands.generic.cannotManageRole')));
      }

      let hierarchyWarning = '';
      const botUserId = client.user?.id;
      let botMember = botUserId ? guild.members?.get(botUserId) : null;
      if (!botMember && botUserId) {
        try {
          botMember = await guild.fetchMember(botUserId);
        } catch {}
      }
      if (botMember) {
        let freshRoles: Map<string, number> | null = null;
        try {
          const rolesData = (await client.rest.get(Routes.guildRoles(guild.id))) as APIRole[] | Record<string, APIRole>;
          if (isArray(rolesData)) {
            freshRoles = new Map(rolesData.map((r) => [r.id, r.position ?? 0]));
          } else {
            freshRoles = new Map(Object.entries(rolesData).map(([k, v]) => [k, v.position ?? 0]));
          }
        } catch {}

        const botRoleIds = botMember.roles?.roleIds ?? [];
        const getPos = (id: string) => freshRoles?.get(id) ?? guild.roles?.get(id)?.position ?? 0;
        const botHighestPos = botRoleIds.length > 0 ? Math.max(0, ...botRoleIds.map((id: string) => getPos(id))) : 0;
        const targetPos = getPos(roleId);
        if (targetPos >= botHighestPos) {
          hierarchyWarning = `\n\nMy role is currently below **${role.name}** - users won't receive this role until you move my role above it in **Server Settings > Roles**.`;
        }
      }

      try {
        await targetMessage.react(emojiArg);
      } catch {
        return void (await message.reply(
          t(lang, 'commands.admin.reactionrole.common.reactPermissionError', { emojiArg, channelId: channel.id }),
        ));
      }

      try {
        const settings = await GuildSettings.getOrCreate(guild.id);
        const entry = settings.reactionRoles.find(
          (entry) => entry.messageId === messageId && entry.channelId === channel.id,
        );

        if (entry) {
          if (entry.roles.length >= 20) {
            return void (await message.reply(t(lang, 'commands.admin.reactionrole.common.maxPairs')));
          }
          if (entry.roles.some((r) => r.emoji === emoji)) {
            return void (await message.reply(
              t(lang, 'commands.admin.reactionrole.common.alreadyMapped', { emojiArg }),
            ));
          }
          entry.roles.push({ emoji, roleId, removeRoleId: null });
        } else {
          settings.reactionRoles.push({
            messageId,
            channelId: channel.id,
            roles: [{ emoji, roleId, removeRoleId: null }],
          });
        }

        settings.markModified('reactionRoles');
        await settings.save();
        settingsCache.invalidate(guild.id);

        const updatedEntry = settings.reactionRoles.find(
          (entry) => entry.messageId === messageId && entry.channelId === channel.id,
        );
        if (updatedEntry) rebuildPanelBody(updatedEntry, guild, client).catch(() => {});
      } catch (err) {
        if (isNetworkError(err)) {
          console.warn(`[${guild?.name || 'Unknown Server'}] Fluxer API unreachable during !rr add (ECONNRESET)`);
        } else {
          console.error(`[${guild?.name || 'Unknown Server'}] Error in !rr add: ${messageFromError(err)}`);
          message.reply(t(lang, 'commands.admin.reactionrole.errors.saveFailed')).catch(() => {});
        }
        return;
      }

      return void (await message.reply(
        t(lang, 'commands.admin.reactionrole.add.done', { emojiArg, roleId, hierarchyWarning }),
      ));
    }

    if (subcommand === 'edit') {
      const channelArg = args[1];
      const messageId = args[2] ? stripBrackets(args[2]) : args[2];
      const newText = channelArg && messageId ? extractRawText(message.content, 4) : '';

      if (!channelArg || !messageId) {
        return void (await message.reply(t(lang, 'commands.admin.reactionrole.edit.usage', { prefix })));
      }

      const channel = await resolveChannel(channelArg, guild, client);
      if (!channel?.isTextBased()) {
        return void (await message.reply(t(lang, 'commands.admin.reactionrole.common.channelNotFoundDetailed')));
      }

      const settings = await GuildSettings.getOrCreate(guild.id);
      const entry = settings.reactionRoles.find(
        (entry) => entry.messageId === messageId && entry.channelId === channel.id,
      );
      if (!entry) {
        return void (await message.reply(t(lang, 'commands.admin.reactionrole.edit.panelNotFound', { prefix })));
      }

      let targetMessage: Message | undefined;
      try {
        targetMessage = await channel.messages.fetch(messageId);
      } catch {
        return void (await message.reply(t(lang, 'commands.admin.reactionrole.common.messageNotFoundDetailed')));
      }

      if (!newText) {
        return void (await message.reply(
          t(lang, 'commands.admin.reactionrole.edit.missingTextPrompt', {
            prefix,
            channelName: channel.name,
            messageId,
          }),
        ));
      }

      try {
        await targetMessage.edit({
          embeds: [
            {
              description: newText,
              color: 0x5865f2,
            },
          ],
        });

        return void (await message.reply(
          t(lang, 'commands.admin.reactionrole.edit.updated', { channelId: channel.id }),
        ));
      } catch (err) {
        if (isNetworkError(err)) {
          console.warn(`[${guild?.name || 'Unknown Server'}] Fluxer API unreachable during !rr edit (ECONNRESET)`);
        } else {
          console.error(`[${guild?.name || 'Unknown Server'}] Error in !rr edit: ${messageFromError(err)}`);
          message.reply(t(lang, 'commands.admin.reactionrole.errors.editFailed')).catch(() => {});
        }
        return;
      }
    }

    if (subcommand === 'remove') {
      const [, channelArg, rawMessageId, emojiArg] = args;
      const messageId = rawMessageId ? stripBrackets(rawMessageId) : rawMessageId;

      if (!channelArg || !messageId || !emojiArg) {
        return void (await message.reply(t(lang, 'commands.admin.reactionrole.remove.usage', { prefix })));
      }

      const channel = await resolveChannel(channelArg, guild, client);
      if (!channel?.isTextBased()) {
        return void (await message.reply(t(lang, 'commands.admin.reactionrole.common.channelNotFound')));
      }

      const emoji = await safeResolveEmoji(client, emojiArg, guild.id);
      if (!emoji) {
        return void (await message.reply(t(lang, 'commands.admin.reactionrole.common.invalidEmoji')));
      }

      try {
        const settings = await GuildSettings.getOrCreate(guild.id);
        const entry = settings.reactionRoles.find(
          (entry) => entry.messageId === messageId && entry.channelId === channel.id,
        );

        if (!entry) return void (await message.reply(t(lang, 'commands.admin.reactionrole.remove.noneConfigured')));

        const before = entry.roles.length;
        entry.roles = entry.roles.filter((r) => r.emoji !== emoji);

        if (entry.roles.length === before) {
          return void (await message.reply(
            t(lang, 'commands.admin.reactionrole.remove.mappingNotFound', { emojiArg }),
          ));
        }

        if (entry.roles.length === 0) {
          settings.reactionRoles = settings.reactionRoles.filter((entry) => entry.messageId !== messageId);
        }

        settings.markModified('reactionRoles');
        await settings.save();
        settingsCache.invalidate(guild.id);
      } catch (err) {
        if (isNetworkError(err)) {
          console.warn(`[${guild?.name || 'Unknown Server'}] Fluxer API unreachable during !rr remove (ECONNRESET)`);
        } else {
          console.error(`[${guild?.name || 'Unknown Server'}] Error in !rr remove: ${messageFromError(err)}`);
          message.reply(t(lang, 'commands.admin.reactionrole.errors.updateFailed')).catch(() => {});
        }
        return;
      }

      try {
        const targetMessage = await channel.messages.fetch(messageId).catch(() => null);
        if (targetMessage) {
          await targetMessage.removeReaction(emojiArg).catch(() => {});
        }
      } catch {}

      return void (await message.reply(t(lang, 'commands.admin.reactionrole.remove.done', { emojiArg })));
    }

    if (subcommand === 'clear') {
      let messageId: string | undefined, channelId: string | undefined;

      if (args[1] && /^\d{17,19}$/.test(stripBrackets(args[1])) && !args[2]) {
        messageId = stripBrackets(args[1]);
      } else {
        const channelArg = args[1];
        messageId = args[2] ? stripBrackets(args[2]) : args[2];
        if (!channelArg || !messageId) {
          return void (await message.reply(t(lang, 'commands.admin.reactionrole.clear.usage', { prefix })));
        }
        const ch = await resolveChannel(channelArg, guild, client);
        if (!ch) return void (await message.reply(t(lang, 'commands.admin.reactionrole.common.channelNotFound')));
        channelId = ch.id;
      }

      let count = 0;

      try {
        const settings = await GuildSettings.getOrCreate(guild.id);

        let entry: IReactionRolesEntry | undefined;
        if (channelId) {
          entry = settings.reactionRoles.find(
            (entry) => entry.messageId === messageId && entry.channelId === channelId,
          );
        } else {
          entry = settings.reactionRoles.find((entry) => entry.messageId === messageId);
          if (entry) channelId = entry.channelId;
        }

        if (!entry) {
          return void (await message.reply(t(lang, 'commands.admin.reactionrole.clear.noneFound', { prefix })));
        }

        count = entry.roles.length;
        settings.reactionRoles = settings.reactionRoles.filter((entry) => entry.messageId !== messageId);
        settings.markModified('reactionRoles');
        await settings.save();
        settingsCache.invalidate(guild.id);
      } catch (err) {
        if (isNetworkError(err)) {
          console.warn(`[${guild?.name || 'Unknown Server'}] Fluxer API unreachable during !rr clear (ECONNRESET)`);
        } else {
          console.error(`[${guild?.name || 'Unknown Server'}] Error in !rr clear: ${messageFromError(err)}`);
          message.reply(t(lang, 'commands.admin.reactionrole.errors.clearFailed')).catch(() => {});
        }
        return;
      }

      try {
        const targetChannel = channelId
          ? guild.channels?.get(channelId) || (await resolveChannel(channelId, guild, client))
          : null;
        if (targetChannel?.isTextBased() && messageId) {
          const targetMessage = await targetChannel.messages.fetch(messageId).catch(() => null);
          if (targetMessage) await targetMessage.removeAllReactions().catch(() => {});
        }
      } catch {}

      return void (await message.reply(t(lang, 'commands.admin.reactionrole.clear.done', { count })));
    }

    if (subcommand === 'list') {
      try {
        const settings = await GuildSettings.getOrCreate(guild.id);
        const reactionRoles = settings.reactionRoles;

        if (!reactionRoles || reactionRoles.length === 0) {
          return void (await message.reply(t(lang, 'commands.admin.reactionrole.list.noneConfigured')));
        }

        const fields = reactionRoles.map((rr, i: number) => ({
          name: t(lang, 'commands.admin.reactionrole.list.panelName', {
            index: i + 1,
            channelId: rr.channelId,
            messageId: rr.messageId,
          }),
          value:
            rr.roles.length > 0
              ? rr.roles
                  .map((r) => {
                    if (r.removeRoleId) {
                      return `${r.emoji} → remove <@&${r.removeRoleId}>, add <@&${r.roleId}>`;
                    }
                    return `${r.emoji} → <@&${r.roleId}>`;
                  })
                  .join('\n')
              : t(lang, 'commands.admin.reactionrole.list.noMappingsYet'),
          inline: false,
        }));

        const dmStatus = settings.reactionRoleDMEnabled
          ? t(lang, 'commands.admin.reactionrole.list.dmOn')
          : t(lang, 'commands.admin.reactionrole.list.dmOff');

        return void (await message.reply({
          embeds: [
            {
              description: null,
              title: t(lang, 'commands.admin.reactionrole.list.title'),
              color: 0x5865f2,
              fields,
              footer: { text: t(lang, 'commands.admin.reactionrole.list.footer', { dmStatus, prefix }) },
            },
          ],
        }));
      } catch (err) {
        if (isNetworkError(err)) {
          console.warn(`[${guild?.name || 'Unknown Server'}] Fluxer API unreachable during !rr list (ECONNRESET)`);
        } else {
          console.error(`[${guild?.name || 'Unknown Server'}] Error in !rr list: ${messageFromError(err)}`);
          message.reply(t(lang, 'commands.admin.reactionrole.errors.listFailed')).catch(() => {});
        }
        return;
      }
    }

    if (subcommand === 'dm') {
      const toggle = args[1]?.toLowerCase();
      if (!toggle || !['on', 'off'].includes(toggle)) {
        return void (await message.reply(t(lang, 'commands.admin.reactionrole.dm.usage', { prefix })));
      }

      try {
        await GuildSettings.updateSetting(guild.id, 'reactionRoleDMEnabled', toggle === 'on');
        settingsCache.invalidate(guild.id);
        return void (await message.reply(t(lang, 'commands.admin.reactionrole.dm.done', { toggle })));
      } catch (err) {
        if (isNetworkError(err)) {
          console.warn(`[${guild?.name || 'Unknown Server'}] Fluxer API unreachable during !rr dm (ECONNRESET)`);
        } else {
          console.error(`[${guild?.name || 'Unknown Server'}] Error in !rr dm: ${messageFromError(err)}`);
          message.reply(t(lang, 'commands.admin.reactionrole.errors.dmUpdateFailed')).catch(() => {});
        }
        return;
      }
    }

    if (subcommand === 'switch') {
      const [, channelArg, rawMessageId, emojiArg, removeRoleArg, addRoleArg] = args;
      const messageId = rawMessageId ? stripBrackets(rawMessageId) : rawMessageId;

      if (!channelArg || !messageId || !emojiArg || !removeRoleArg || !addRoleArg) {
        return void (await message.reply(t(lang, 'commands.admin.reactionrole.switch.usage', { prefix })));
      }

      let removeRoleId = parseRoleId(removeRoleArg);
      if (!removeRoleId) {
        try {
          removeRoleId = await guild.resolveRoleId(removeRoleArg);
        } catch {}
      }
      let addRoleId = parseRoleId(addRoleArg);
      if (!addRoleId) {
        try {
          addRoleId = await guild.resolveRoleId(addRoleArg);
        } catch {}
      }
      if (!removeRoleId)
        return void (await message.reply(t(lang, 'commands.admin.reactionrole.switch.invalidRemoveRole')));
      if (!addRoleId) return void (await message.reply(t(lang, 'commands.admin.reactionrole.switch.invalidAddRole')));

      const emoji = await safeResolveEmoji(client, emojiArg, guild.id);
      if (!emoji) {
        return void (await message.reply(t(lang, 'commands.admin.reactionrole.common.invalidEmoji')));
      }

      const channel = await resolveChannel(channelArg, guild, client);
      if (!channel?.isTextBased()) {
        return void (await message.reply(t(lang, 'commands.admin.reactionrole.common.channelNotFound')));
      }

      let targetMessage: Message | undefined;
      try {
        targetMessage = await channel.messages.fetch(messageId);
      } catch {
        return void (await message.reply(t(lang, 'commands.admin.reactionrole.switch.messageNotFound')));
      }

      let addRole = guild.roles?.get(addRoleId);
      let removeRole = guild.roles?.get(removeRoleId);
      if (!addRole || !removeRole) {
        try {
          await guild.fetchRoles();
        } catch {}
        if (!addRole) addRole = guild.roles?.get(addRoleId);
        if (!removeRole) removeRole = guild.roles?.get(removeRoleId);
      }
      if (!addRole) {
        try {
          addRole = await guild.fetchRole(addRoleId);
        } catch {}
      }
      if (!addRole) return void (await message.reply(t(lang, 'commands.admin.reactionrole.switch.addRoleNotFound')));
      if (!removeRole) {
        try {
          removeRole = await guild.fetchRole(removeRoleId);
        } catch {}
      }
      if (!removeRole)
        return void (await message.reply(t(lang, 'commands.admin.reactionrole.switch.removeRoleNotFound')));

      let commandMember = guild.members?.get(message.author.id);
      if (!commandMember) {
        try {
          commandMember = await guild.fetchMember(message.author.id);
        } catch {}
      }
      if (commandMember) {
        const check1 = canManageRole(commandMember, addRole, guild);
        if (!check1.allowed)
          return void (await message.reply(
            check1.reason || t(lang, 'commands.admin.reactionrole.switch.cannotManageAddRoleFallback'),
          ));
        const check2 = canManageRole(commandMember, removeRole, guild);
        if (!check2.allowed)
          return void (await message.reply(
            check2.reason || t(lang, 'commands.admin.reactionrole.switch.cannotManageRemoveRoleFallback'),
          ));
      }

      try {
        await targetMessage.react(emojiArg);
      } catch {
        return void (await message.reply(
          t(lang, 'commands.admin.reactionrole.common.reactPermissionError', { emojiArg, channelId: channel.id }),
        ));
      }

      try {
        const settings = await GuildSettings.getOrCreate(guild.id);
        const entry = settings.reactionRoles.find(
          (entry) => entry.messageId === messageId && entry.channelId === channel.id,
        );

        const roleEntry = { emoji, roleId: addRoleId, removeRoleId };

        if (entry) {
          if (entry.roles.length >= 20) {
            return void (await message.reply(t(lang, 'commands.admin.reactionrole.common.maxPairs')));
          }
          if (entry.roles.some((r) => r.emoji === emoji)) {
            return void (await message.reply(
              t(lang, 'commands.admin.reactionrole.switch.alreadyMappedRemoveFirst', { emojiArg, prefix }),
            ));
          }
          entry.roles.push(roleEntry);
        } else {
          settings.reactionRoles.push({ messageId, channelId: channel.id, roles: [roleEntry] });
        }

        settings.markModified('reactionRoles');
        await settings.save();
        settingsCache.invalidate(guild.id);

        const updatedSwitchEntry = settings.reactionRoles.find(
          (entry) => entry.messageId === messageId && entry.channelId === channel.id,
        );
        if (updatedSwitchEntry) rebuildPanelBody(updatedSwitchEntry, guild, client).catch(() => {});
      } catch (err) {
        if (isNetworkError(err)) {
          console.warn(`[${guild?.name || 'Unknown Server'}] Fluxer API unreachable during !rr switch (ECONNRESET)`);
        } else {
          console.error(`[${guild?.name || 'Unknown Server'}] Error in !rr switch: ${messageFromError(err)}`);
          message.reply(t(lang, 'commands.admin.reactionrole.errors.switchSaveFailed')).catch(() => {});
        }
        return;
      }

      return void (await message.reply(
        t(lang, 'commands.admin.reactionrole.switch.done', {
          emojiArg,
          removeRoleName: removeRole.name,
          addRoleName: addRole.name,
        }),
      ));
    }

    if (subcommand === 'addmulti') {
      const [, channelArg, rawMessageId, emojiArg, ...roleArgs] = args;
      const messageId = rawMessageId ? stripBrackets(rawMessageId) : rawMessageId;

      if (!channelArg || !messageId || !emojiArg || roleArgs.length < 2) {
        return void (await message.reply(t(lang, 'commands.admin.reactionrole.addmulti.usage', { prefix })));
      }

      if (roleArgs.length > 10) {
        return void (await message.reply(t(lang, 'commands.admin.reactionrole.addmulti.maxRoles')));
      }

      const resolvedRoleIds: string[] = [];
      for (const roleArg of roleArgs) {
        let roleId = parseRoleId(roleArg);
        if (!roleId) {
          try {
            roleId = await guild.resolveRoleId(roleArg);
          } catch {}
        }
        if (!roleId)
          return void (await message.reply(t(lang, 'commands.admin.reactionrole.addmulti.invalidRole', { roleArg })));
        if (resolvedRoleIds.includes(roleId))
          return void (await message.reply(t(lang, 'commands.admin.reactionrole.addmulti.duplicateRole', { roleId })));
        resolvedRoleIds.push(roleId);
      }

      const emoji = await safeResolveEmoji(client, emojiArg, guild.id);
      if (!emoji) {
        return void (await message.reply(t(lang, 'commands.admin.reactionrole.common.invalidEmoji')));
      }

      const channel = await resolveChannel(channelArg, guild, client);
      if (!channel?.isTextBased()) {
        return void (await message.reply(t(lang, 'commands.admin.reactionrole.common.channelNotFound')));
      }

      let targetMessage: Message | undefined;
      try {
        targetMessage = await channel.messages.fetch(messageId);
      } catch {
        return void (await message.reply(t(lang, 'commands.admin.reactionrole.common.messageNotFoundDetailed')));
      }

      const roleNames: string[] = [];
      for (const roleId of resolvedRoleIds) {
        let role = guild.roles?.get(roleId);
        if (!role) {
          try {
            await guild.fetchRoles();
            role = guild.roles?.get(roleId);
          } catch {}
        }
        if (!role) {
          try {
            role = await guild.fetchRole(roleId);
          } catch {}
        }
        if (!role)
          return void (await message.reply(t(lang, 'commands.admin.reactionrole.addmulti.roleNotFound', { roleId })));

        let commandMember = guild.members.get(message.author.id);
        if (!commandMember) {
          try {
            commandMember = await guild.fetchMember(message.author.id);
          } catch {}
        }
        if (commandMember) {
          const check = canManageRole(commandMember, role, guild);
          if (!check.allowed)
            return void (await message.reply(
              check.reason || t(lang, 'commands.generic.cannotManageRoleSpecific', { roleName: role.name }),
            ));
        }
        roleNames.push(role.name);
      }

      try {
        await targetMessage.react(emojiArg);
      } catch {
        return void (await message.reply(
          t(lang, 'commands.admin.reactionrole.common.reactPermissionError', { emojiArg, channelId: channel.id }),
        ));
      }

      try {
        const settings = await GuildSettings.getOrCreate(guild.id);
        const entry = settings.reactionRoles.find(
          (entry) => entry.messageId === messageId && entry.channelId === channel.id,
        );

        const roleEntry: IReactionRolesRole = {
          emoji,
          roleId: resolvedRoleIds[0]!, // there is at least two roles in this array
          roleIds: resolvedRoleIds,
          removeRoleId: null,
        };

        if (entry) {
          if (entry.roles.length >= 20) {
            return void (await message.reply(t(lang, 'commands.admin.reactionrole.common.maxPairs')));
          }
          if (entry.roles.some((r) => r.emoji === emoji)) {
            return void (await message.reply(
              t(lang, 'commands.admin.reactionrole.addmulti.alreadyMappedRemoveFirst', { emojiArg, prefix }),
            ));
          }
          entry.roles.push(roleEntry);
        } else {
          settings.reactionRoles.push({ messageId, channelId: channel.id, roles: [roleEntry] });
        }

        settings.markModified('reactionRoles');
        await settings.save();
        settingsCache.invalidate(guild.id);

        const updatedMultiEntry = settings.reactionRoles.find(
          (entry) => entry.messageId === messageId && entry.channelId === channel.id,
        );
        if (updatedMultiEntry) rebuildPanelBody(updatedMultiEntry, guild, client).catch(() => {});
      } catch (err) {
        if (isNetworkError(err)) {
          console.warn(`[${guild?.name || 'Unknown Server'}] Fluxer API unreachable during !rr addmulti (ECONNRESET)`);
        } else {
          console.error(`[${guild?.name || 'Unknown Server'}] Error in !rr addmulti: ${messageFromError(err)}`);
          message.reply(t(lang, 'commands.admin.reactionrole.errors.saveFailed')).catch(() => {});
        }
        return;
      }

      const roleList = resolvedRoleIds.map((id: string) => `<@&${id}>`).join(', ');
      return void (await message.reply(
        t(lang, 'commands.admin.reactionrole.addmulti.done', { emojiArg, roleCount: resolvedRoleIds.length, roleList }),
      ));
    }

    return void (await message.reply({ embeds: [usageEmbed(prefix, lang)] }));
  },
};

export default command;
