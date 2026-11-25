import type { Command, IGuildSettings } from '@/types';
import GuildSettings, { type GuildSettingsDocument } from '@/models/GuildSettings';
import settingsCache from '@/utils/settingsCache';
import isNetworkError from '@/utils/isNetworkError';
import { Channel, Client, EmbedBuilder, Guild, Message } from '@fluxerjs/core';
import strLen from '@/utils/strlen';
import { STICKY_MESSAGE_MAX_PER_GUILD, clearStickyCache, postStickyMessage } from '@/utils/stickyMessage';
import { t, normalizeLocale } from '@/i18n';
import { isInUnion } from '@/utils/isInUnion';
import { isArray } from '@/utils/isArray';
import { isTextChannel } from '@/utils/isTextChannel';
import { messageFromError } from '@/utils/messageFromError';

function parseChannelId(arg: string | undefined): string | null {
  if (!arg) return null;
  const mention = arg.match(/^<#(\d{17,19})>$/);
  if (mention && '1' in mention) return mention[1];
  if (/^\d{17,19}$/.test(arg)) return arg;
  return null;
}

async function save(settings: GuildSettingsDocument, guildId: string): Promise<void> {
  settings.markModified('stickyMessages');
  await settings.save();
  settingsCache.invalidate(guildId);
}

async function embedReply(message: Message, description: string, title?: string): Promise<void> {
  const embed = new EmbedBuilder().setDescription(description).setColor(0x5865f2);
  if (title) embed.setTitle(title);
  await message.reply({ embeds: [embed] });
}

function findEntry(settings: IGuildSettings, channelId: string) {
  return (settings.stickyMessages || []).find((entry) => entry.channelId === channelId);
}

function ensureList(settings: IGuildSettings) {
  if (!isArray(settings.stickyMessages)) settings.stickyMessages = [];
  return settings.stickyMessages;
}

const SUBCOMMAND_LITERALS = ['list', 'add', 'remove', 'message', 'on', 'off', 'test'] as const;

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
  async list(message, _args, _guild, settings, _client, prefix) {
    const lang = normalizeLocale(settings?.language);
    const entries = settings.stickyMessages || [];
    if (!entries.length) {
      return embedReply(message, t(lang, 'commands.admin.sticky.listEmpty', { prefix }));
    }

    const lines = entries
      .map((entry, i: number) => {
        const status = entry.enabled ? 'on' : 'off';
        const preview = entry.content?.trim() ? entry.content.trim().slice(0, 80) : '(no message set)';
        return `**${i + 1}.** <#${entry.channelId}> · \`${status}\` · ${preview}`;
      })
      .join('\n');

    return embedReply(
      message,
      t(lang, 'commands.admin.sticky.list', { lines, count: entries.length, max: STICKY_MESSAGE_MAX_PER_GUILD }),
      t(lang, 'commands.admin.sticky.title'),
    );
  },

  async add(message, args, guild, settings, _client, prefix) {
    const lang = normalizeLocale(settings?.language);
    const channelId = parseChannelId(args[0]);
    if (!channelId) {
      return embedReply(message, t(lang, 'commands.admin.sticky.channelRequired', { prefix, sub: 'add' }));
    }

    const list = ensureList(settings);
    if (findEntry(settings, channelId)) {
      return embedReply(message, t(lang, 'commands.admin.sticky.alreadyExists', { channelId }));
    }
    if (list.length >= STICKY_MESSAGE_MAX_PER_GUILD) {
      return embedReply(message, t(lang, 'commands.admin.sticky.maxReached', { max: STICKY_MESSAGE_MAX_PER_GUILD }));
    }

    const content = args.slice(1).join(' ').trim() || null;
    if (content && strLen(content) > 2000) {
      return embedReply(message, t(lang, 'commands.admin.sticky.messageTooLong'));
    }

    list.push({ channelId, enabled: true, content });
    await save(settings, guild.id);
    return embedReply(message, t(lang, 'commands.admin.sticky.added', { channelId }));
  },

  async remove(message, args, guild, settings, _client, prefix) {
    const lang = normalizeLocale(settings?.language);
    const channelId = parseChannelId(args[0]);
    if (!channelId) {
      return embedReply(message, t(lang, 'commands.admin.sticky.channelRequired', { prefix, sub: 'remove' }));
    }

    const before = settings.stickyMessages?.length || 0;
    settings.stickyMessages = (settings.stickyMessages || []).filter((entry) => entry.channelId !== channelId);
    if (settings.stickyMessages.length === before) {
      return embedReply(message, t(lang, 'commands.admin.sticky.notFound', { channelId }));
    }

    clearStickyCache(guild.id, channelId);
    await save(settings, guild.id);
    return embedReply(message, t(lang, 'commands.admin.sticky.removed', { channelId }));
  },

  async message(message, args, guild, settings, _client, prefix) {
    const lang = normalizeLocale(settings?.language);
    const channelId = parseChannelId(args[0]);
    if (!channelId) {
      return embedReply(message, t(lang, 'commands.admin.sticky.channelRequired', { prefix, sub: 'message' }));
    }

    const entry = findEntry(settings, channelId);
    if (!entry) {
      return embedReply(message, t(lang, 'commands.admin.sticky.notConfigured', { channelId, prefix }));
    }

    const text = args.slice(1).join(' ').trim();
    if (!text) {
      return embedReply(message, t(lang, 'commands.admin.sticky.messageUsage', { prefix }));
    }
    if (strLen(text) > 2000) {
      return embedReply(message, t(lang, 'commands.admin.sticky.messageTooLong'));
    }

    entry.content = text;
    entry.enabled = true;
    await save(settings, guild.id);
    return embedReply(message, t(lang, 'commands.admin.sticky.messageSet', { channelId }));
  },

  async on(message, args, guild, settings, _client, prefix) {
    const lang = normalizeLocale(settings?.language);
    const channelId = parseChannelId(args[0]);
    if (!channelId) {
      return embedReply(message, t(lang, 'commands.admin.sticky.channelRequired', { prefix, sub: 'on' }));
    }

    const entry = findEntry(settings, channelId);
    if (!entry) {
      return embedReply(message, t(lang, 'commands.admin.sticky.notConfigured', { channelId, prefix }));
    }
    if (!entry.content?.trim()) {
      return embedReply(message, t(lang, 'commands.admin.sticky.needsMessage', { prefix }));
    }

    entry.enabled = true;
    await save(settings, guild.id);
    return embedReply(message, t(lang, 'commands.admin.sticky.enabled', { channelId }));
  },

  async off(message, args, guild, settings, _client, prefix) {
    const lang = normalizeLocale(settings?.language);
    const channelId = parseChannelId(args[0]);
    if (!channelId) {
      return embedReply(message, t(lang, 'commands.admin.sticky.channelRequired', { prefix, sub: 'off' }));
    }

    const entry = findEntry(settings, channelId);
    if (!entry) {
      return embedReply(message, t(lang, 'commands.admin.sticky.notConfigured', { channelId, prefix }));
    }

    entry.enabled = false;
    clearStickyCache(guild.id, channelId);
    await save(settings, guild.id);
    return embedReply(message, t(lang, 'commands.admin.sticky.disabled', { channelId }));
  },

  async test(message, args, guild, settings, client, prefix) {
    const lang = normalizeLocale(settings?.language);
    const channelId = parseChannelId(args[0]);
    if (!channelId) {
      return embedReply(message, t(lang, 'commands.admin.sticky.channelRequired', { prefix, sub: 'test' }));
    }

    const entry = findEntry(settings, channelId);
    if (!entry?.content?.trim()) {
      return embedReply(message, t(lang, 'commands.admin.sticky.notConfigured', { channelId, prefix }));
    }

    let channel: Channel | null = guild.channels?.get?.(channelId) ?? null;
    if (!channel) {
      try {
        channel = await client.channels.fetch(channelId);
      } catch {
        channel = null;
      }
    }
    if (!channel || !isTextChannel(channel)) {
      return embedReply(message, t(lang, 'commands.admin.sticky.channelMissing', { channelId }));
    }

    await postStickyMessage(guild, channel, channelId, entry.content, client);
    return embedReply(message, t(lang, 'commands.admin.sticky.testPosted', { channelId }));
  },
};

async function showHelp(message: Message, prefix: string, lang: string): Promise<void> {
  await embedReply(message, t(lang, 'commands.admin.sticky.help', { prefix }), t(lang, 'commands.admin.sticky.title'));
}

const command: Command = {
  name: 'sticky',
  description: 'Pin a message to the bottom of a channel. Reposts after each new message.',
  usage:
    'add <#channel> [message] | message <#channel> <text> | remove <#channel> | on/off <#channel> | list | test <#channel>',
  category: 'admin',
  permissions: ['ManageGuild'],
  cooldown: 3,

  async execute(message, args, client, prefix = '!') {
    let guild = message.guild;
    if (!guild && message.guildId) guild = await client.guilds.fetch(message.guildId);
    if (!guild) return void (await embedReply(message, t('en', 'commands.generic.serverOnly')));

    const settings = await GuildSettings.getOrCreate(guild.id);
    const lang = normalizeLocale(settings?.language);
    ensureList(settings);

    const sub: string | undefined = args[0]?.toLowerCase();
    if (!isInUnion(sub, SUBCOMMAND_LITERALS) || !subcommands[sub]) {
      return showHelp(message, prefix, lang);
    }

    try {
      await subcommands[sub](message, args.slice(1), guild, settings, client, prefix);
    } catch (error) {
      const guildName = guild?.name || 'Unknown Server';
      if (isNetworkError(error)) {
        console.warn(`[${guildName}] Fluxer API unreachable during !sticky (ECONNRESET)`);
      } else {
        console.error(`[${guildName}] Error in !sticky: ${messageFromError(error)}`);
        embedReply(message, t(lang, 'commands.admin.sticky.error')).catch(() => {});
      }
    }
  },
};

export default command;
