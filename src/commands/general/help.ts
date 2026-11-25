import { EmbedBuilder, GuildMember, Message } from '@fluxerjs/core';
import type { Command, ICommandHandler, IGuildSettings } from '@/types';
import config from '@/config';
import isNetworkError from '@/utils/isNetworkError';
import settingsCache from '@/utils/settingsCache';
import { hasAnyPermission, ensureGuildRolesLoaded } from '@/utils/permissions';
import { t, normalizeLocale } from '@/i18n';
import { registerReactionPaginator } from '@/utils/reactionPaginator';
import {
  compactEmbedDescription,
  formatCompactPageIndicator,
  joinCompactFooterParts,
  trimFooterPrompt,
} from '@/utils/embedPresentation';
import { isArray } from '@/utils/isArray';
import { messageFromError } from '@/utils/messageFromError';

const ACCENT_COLOR = 0xf1c40f;

const CATEGORY_META: Record<string, { label: string; description: string }> = {
  moderation: { label: 'Moderation', description: 'Ban, kick, warn, timeout, mute, clear, slowmode' },
  admin: { label: 'Admin', description: 'Configure the bot - logging, automod, tickets, lockdown, reaction roles' },
  info: { label: 'Info', description: 'Server, member, role, and bot information' },
  general: { label: 'General', description: 'Help, ping, report' },
};

const CATEGORY_ORDER = ['moderation', 'admin', 'info', 'general'];
const CATEGORY_ALIASES: Record<string, string> = {
  mod: 'moderation',
  moderation: 'moderation',
  admin: 'admin',
  administration: 'admin',
  info: 'info',
  information: 'info',
  general: 'general',
  misc: 'general',
};

type HelpCategoryPage = {
  key: string;
  meta: { label: string; description?: string };
  commands: Command[];
};

function getMemberRoleIds(member: GuildMember): readonly string[] {
  return member.roles.roleIds;
}

function canSeeTicketCommand(member: GuildMember | null, guildSettings: IGuildSettings | null): boolean {
  if (!member) return false;
  if (hasAnyPermission(member, ['Administrator', 'ManageGuild'])) return true;
  const supportRoleIds = new Set<string>(guildSettings?.ticketSupportRoleIds || []);
  if (guildSettings?.ticketSupportRoleId) supportRoleIds.add(guildSettings.ticketSupportRoleId);
  if (supportRoleIds.size === 0) return false;
  const memberRoleIds = getMemberRoleIds(member);
  return memberRoleIds.some((id: string) => supportRoleIds.has(id));
}

function canSeeLockdownCommand(
  message: Message,
  member: GuildMember | null,
  guildSettings: IGuildSettings | null,
): boolean {
  if (!member) return false;
  if (hasAnyPermission(member, ['Administrator'])) return true;
  const isGuildOwner = Boolean(message.guild?.ownerId && String(message.guild.ownerId) === String(message.author?.id));
  if (isGuildOwner) return true;
  if ((guildSettings?.lockdownAllowedUsers ?? []).includes(message.author?.id)) return true;
  const memberRoleIds = getMemberRoleIds(member);
  return (guildSettings?.lockdownAllowedRoles ?? []).some((roleId: string) => memberRoleIds.includes(roleId));
}

async function getPrefix(message: Message): Promise<string> {
  const guildId = message.guildId || message.guild?.id;
  if (!guildId) return config.prefix;
  try {
    const settings = await settingsCache.get(guildId);
    if (settings?.prefixes && '0' in settings.prefixes) return settings.prefixes[0];
  } catch {}
  return config.prefix;
}

function isCommandDisabledInGuild(cmd: Command, disabled: unknown): boolean {
  if (!isArray(disabled) || disabled.length === 0) return false;
  return disabled.includes(cmd.name) || disabled.includes(cmd.category);
}

function sanitizeHelpQuery(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/^[^\w]+/, '')
    .trim();
}

function categorySlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function findCategoryStartIndex(query: string, categories: HelpCategoryPage[]): number {
  const normalized = sanitizeHelpQuery(query);
  if (!normalized) return -1;

  const directIndex = categories.findIndex((c) => c.key === normalized);
  if (directIndex >= 0) return directIndex;

  const aliasTarget = CATEGORY_ALIASES[normalized];
  if (aliasTarget) {
    const aliasIndex = categories.findIndex((c) => c.key === aliasTarget);
    if (aliasIndex >= 0) return aliasIndex;
  }

  const slug = categorySlug(normalized);
  return categories.findIndex((c) => categorySlug(c.meta.label) === slug);
}

async function buildVisibleHelpCategories(opts: {
  commandHandler: ICommandHandler;
  message: Message;
  isOwner: boolean;
  member: GuildMember | null;
  disabledCommands: unknown;
  guildSettings: IGuildSettings | null;
}): Promise<HelpCategoryPage[]> {
  const categories = opts.commandHandler.getCommandsByCategory();
  const sorted = CATEGORY_ORDER.filter((c) => categories[c]).concat(
    Object.keys(categories).filter((c) => !CATEGORY_ORDER.includes(c)),
  );

  const pages: HelpCategoryPage[] = [];
  for (const cat of sorted) {
    const cmds = categories[cat];
    if (!cmds || cat === 'owner') continue;

    const visible: Command[] = [];
    for (const cmd of cmds) {
      if (
        await canUserSeeCommand({
          message: opts.message,
          cmd,
          isOwner: opts.isOwner,
          member: opts.member,
          disabledCommands: opts.disabledCommands,
          guildSettings: opts.guildSettings,
        })
      ) {
        visible.push(cmd);
      }
    }

    if (visible.length === 0) continue;
    pages.push({
      key: cat,
      meta: CATEGORY_META[cat] ?? { label: cat },
      commands: visible,
    });
  }

  return pages;
}

function buildCategoryEmbed(opts: {
  category: HelpCategoryPage;
  prefix: string;
  lang: string;
  pageNumber: number;
  totalPages: number;
}): EmbedBuilder {
  const commandList = opts.category.commands.map((cmd: Command) => `\`${cmd.name}\``).join('  ');
  const description = opts.category.meta.description
    ? `${opts.category.meta.description}\n\n${commandList}`
    : commandList;
  const footer = joinCompactFooterParts([
    trimFooterPrompt(t(opts.lang, 'commands.help.menuFooter', { prefix: opts.prefix })),
    formatCompactPageIndicator(opts.pageNumber, opts.totalPages),
  ]);

  return new EmbedBuilder()
    .setTitle(`${t(opts.lang, 'commands.help.menuTitle')} - ${opts.category.meta.label}`)
    .setDescription(description)
    .setColor(ACCENT_COLOR)
    .setFooter({ text: footer });
}

function buildTextCategoryList(opts: {
  categories: HelpCategoryPage[];
  prefix: string;
  lang: string;
  startIndex: number;
  showOnlyStartCategory: boolean;
}): string {
  const lines = [t(opts.lang, 'commands.help.commandListHeader', { prefix: opts.prefix }), ''];
  const list = opts.showOnlyStartCategory
    ? opts.categories.slice(opts.startIndex, opts.startIndex + 1)
    : opts.categories;

  for (const category of list) {
    lines.push(`**${category.meta.label}**${category.meta.description ? ` - ${category.meta.description}` : ''}`);
    lines.push(category.commands.map((cmd: Command) => `\`${cmd.name}\``).join('  '));
    lines.push('');
  }

  return lines.join('\n');
}

async function canUserSeeCommand(opts: {
  message: Message;
  cmd: Command;
  isOwner: boolean;
  member: GuildMember | null;
  disabledCommands: unknown;
  guildSettings: IGuildSettings | null;
}): Promise<boolean> {
  const { message, cmd, isOwner, member, disabledCommands, guildSettings } = opts;

  if (cmd.hidden) return false;
  if (cmd.ownerOnly && !isOwner) return false;
  if (!message.guildId && !message.guild?.id) {
    if (cmd.category === 'owner') return isOwner;
    return Boolean(cmd.allowDM);
  }

  if (cmd.category !== 'owner' && isCommandDisabledInGuild(cmd, disabledCommands)) return false;

  if (cmd.permissions?.length) {
    if (!member) return false;
    return hasAnyPermission(member, cmd.permissions);
  }

  if (cmd.category === 'admin') {
    if (cmd.name === 'ticket') return canSeeTicketCommand(member, guildSettings);
    if (cmd.name === 'lockdown') return canSeeLockdownCommand(message, member, guildSettings);
    return false;
  }

  return true;
}

const command: Command = {
  name: 'help',
  description: 'Show all commands, detailed info for one command, or a specific category page.',
  usage: '[command/category]',
  category: 'general',
  cooldown: 5,

  async execute(message, args, client) {
    const { commandHandler } = client;
    if (!commandHandler) return void (await message.reply(t('en', 'commands.generic.handlerMissing')));

    const prefix = await getPrefix(message);
    const isOwner = Boolean(config.ownerId && message.author.id === config.ownerId);
    const guildId = message.guildId || message.guild?.id;
    if (message.guild) await ensureGuildRolesLoaded(message.guild);
    const member = guildId ? await commandHandler.getMember(message).catch(() => null) : null;
    const guildSettings = guildId ? await settingsCache.get(guildId).catch(() => null) : null;
    const disabledCommands = guildSettings?.disabledCommands ?? null;
    const lang = normalizeLocale(guildSettings?.language);

    try {
      if (args[0]) {
        const commandName = sanitizeHelpQuery(args[0]);
        const cmd = commandHandler.getCommand(commandName);

        const visible =
          cmd && (await canUserSeeCommand({ message, cmd, isOwner, member, disabledCommands, guildSettings }));
        if (cmd && visible) {
          const usageStr = `\`${prefix}${cmd.name}${cmd.usage ? ' ' + cmd.usage : ''}\``;

          const embed = new EmbedBuilder()
            .setTitle(`${cmd.name}`)
            .setDescription(compactEmbedDescription(cmd.description))
            .setColor(ACCENT_COLOR)
            .addFields({ name: t(lang, 'commands.admin.starboard.help.fieldUsage'), value: usageStr, inline: false });

          if (cmd.permissions?.length) {
            embed.addFields({
              name: t(lang, 'auditCatalog.commands.general.help.l271_addFields_name'),
              value: cmd.permissions.join(', '),
              inline: true,
            });
          }
          if (cmd.aliases?.length) {
            embed.addFields({
              name: t(lang, 'commands.admin.starboard.help.fieldAliases'),
              value: cmd.aliases.map((a: string) => `\`${a}\``).join('  '),
              inline: true,
            });
          }
          if (cmd.cooldown) {
            embed.addFields({
              name: t(lang, 'commands.admin.starboard.help.fieldCooldown'),
              value: t(lang, 'auditCatalog.commands.general.help.l277_addFields_value', {
                'cmd.cooldown': cmd.cooldown,
              }),
              inline: true,
            });
          }

          try {
            return void (await message.reply({ embeds: [embed] }));
          } catch {
            const lines = [
              `**${cmd.name}** - ${isArray(cmd.description) ? cmd.description[0] : cmd.description || ''}`,
              `Usage: ${usageStr}`,
              cmd.permissions?.length ? `Permission: ${cmd.permissions.join(', ')}` : '',
              cmd.aliases?.length ? `Aliases: ${cmd.aliases.join(', ')}` : '',
            ].filter(Boolean);
            return void (await message.reply(lines.join('\n')).catch(() => {}));
          }
        }
      }

      const visibleCategories = await buildVisibleHelpCategories({
        commandHandler,
        message,
        isOwner,
        member,
        disabledCommands,
        guildSettings,
      });

      if (visibleCategories.length === 0) {
        return void (await message.reply(t(lang, 'commands.help.errors.generic')).catch(() => {}));
      }

      const startIndex = args[0] ? findCategoryStartIndex(args[0], visibleCategories) : 0;
      if (args[0] && startIndex < 0) {
        const commandName = sanitizeHelpQuery(args[0]);
        return void (await message
          .reply(t(lang, 'commands.help.errors.commandNotFound', { commandName, prefix }))
          .catch(() => {}));
      }

      const pages = visibleCategories.map((category, index) => {
        return buildCategoryEmbed({
          category,
          prefix,
          lang,
          pageNumber: index + 1,
          totalPages: visibleCategories.length,
        });
      });

      try {
        const sentMessage = await message.reply({
          embeds: [
            // `startIndex` known index of `pages`. This whole section would need to be reworked to allow safer indexing
            pages[startIndex]!,
          ],
        });

        if (pages.length > 1) {
          const ownerUserId = message.author.id;
          const responseChannelId = sentMessage.channelId;
          const responseMessageId = sentMessage.id;

          if (ownerUserId && responseChannelId && responseMessageId) {
            await registerReactionPaginator(client, {
              messageId: responseMessageId,
              channelId: responseChannelId,
              ownerUserId,
              pages,
              initialPageIndex: startIndex,
              ttlMs: 3 * 60 * 1000,
              targetMessage: sentMessage,
            });
          }
        }
      } catch {
        const text = buildTextCategoryList({
          categories: visibleCategories,
          prefix,
          lang,
          startIndex: Math.max(0, startIndex),
          showOnlyStartCategory: Boolean(args[0]),
        });
        return void (await message.reply(text).catch(() => {}));
      }
    } catch (error) {
      const guildName = message.guild?.name || 'Unknown Server';
      if (isNetworkError(error)) {
        console.warn(`[${guildName}] Fluxer API unreachable during !help (ECONNRESET)`);
      } else if (
        error &&
        typeof error === 'object' &&
        'message' in error &&
        typeof error.message === 'string' &&
        (error.message.toLowerCase().includes('nsfw') || error.message.toLowerCase().includes('age restricted'))
      ) {
        return;
      } else {
        console.error(`[${guildName}] Error in !help: ${messageFromError(error)}`);
        try {
          await message.reply(t(lang, 'commands.help.errors.generic'));
        } catch {}
      }
    }
  },
};

export default command;
