import type { Channel, Client, Guild } from '@fluxerjs/core';
import type { Command, ILogChannelOverrides } from '@/types';
import GuildSettings from '@/models/GuildSettings';
import settingsCache from '@/utils/settingsCache';
import isNetworkError from '@/utils/isNetworkError';
import { LOG_CATEGORIES, type LogCategory } from '@/utils/logger';
import { t, normalizeLocale } from '@/i18n';
import { messageFromError } from '@/utils/messageFromError';

const CATEGORY_LABELS: Record<string, string> = {
  member: 'Member (join/leave/role update)',
  voice: 'Voice (join/leave/move)',
  message: 'Message (edit/delete/pin)',
  role: 'Role (create/delete/update)',
  channel: 'Channel (create/delete/update)',
  reaction: 'Reaction (add/remove)',
  server: 'Server (webhooks/emojis/invites)',
};

function parseChannelId(arg: string): string | null {
  const mention = arg.match(/^<#(\d{17,19})>$/);
  if (mention && '1' in mention) return mention[1];
  if (/^\d{17,19}$/.test(arg)) return arg;
  return null;
}

async function verifyChannel(channelId: string, guild: Guild, client: Client): Promise<Channel | null> {
  let channel: Channel | null = guild.channels?.get(channelId) ?? null;
  if (!channel) {
    try {
      channel = await client.channels.fetch(channelId);
    } catch {}
  }
  return channel;
}

const command: Command = {
  name: 'setserverlog',
  description: [
    'Set the channel where server events are logged. You can also split logs into separate channels by category.',
    '',
    '**Usage:**',
    '`!setserverlog #channel` - set the default log channel for all events',
    '`!setserverlog <category> #channel` - send a specific category to a different channel',
    '`!setserverlog <category> clear` - remove a category override (falls back to default)',
    '`!setserverlog status` - show all configured log channels',
    '`!setserverlog clear` - remove the default log channel',
    '',
    '**Categories:** `member`, `voice`, `message`, `role`, `channel`, `reaction`, `server`',
  ].join('\n'),
  usage: '[category] [#channel | clear]',
  category: 'admin',
  permissions: ['ManageGuild'],
  cooldown: 3,

  async execute(message, args, client, prefix = '!') {
    let guild = message.guild;
    if (!guild && message.guildId) {
      guild = await client.guilds.fetch(message.guildId);
    }

    if (!guild) {
      return void (await message.reply(t('en', 'commands.generic.serverOnly')));
    }

    try {
      const settings = await GuildSettings.getOrCreate(guild.id);
      const lang = normalizeLocale(settings?.language);
      const overrides =
        settings.logChannelOverrides ||
        ({
          // values assumed to be populated in later calls
        } as ILogChannelOverrides);

      if (!args[0] || args[0].toLowerCase() === 'status') {
        const defaultCh = settings.serverLogChannelId;
        const lines: string[] = [];
        lines.push(
          `**${t(lang, 'commands.admin.setserverlog.defaultLabel')}:** ${defaultCh ? `<#${defaultCh}>` : t(lang, 'commands.admin.setserverlog.notSet')}`,
        );

        let hasOverrides = false;
        for (const cat of LOG_CATEGORIES) {
          if (overrides[cat]) {
            lines.push(`**${CATEGORY_LABELS[cat] || cat}:** <#${overrides[cat]}>`);
            hasOverrides = true;
          }
        }

        if (!hasOverrides && !defaultCh) {
          return void (await message.reply(t(lang, 'commands.admin.setserverlog.noServerLogChannelSet', { prefix })));
        }

        if (!hasOverrides) {
          lines.push(t(lang, 'commands.admin.setserverlog.allEventsDefault', { prefix }));
        }

        return void (await message.reply(lines.join('\n')));
      }

      if (args[0].toLowerCase() === 'clear') {
        settings.serverLogChannelId = null;
        await settings.save();
        settingsCache.invalidate(guild.id);
        return void (await message.reply(t(lang, 'commands.admin.setserverlog.cleared')));
      }

      const maybeCategory = args[0].toLowerCase();
      if ((LOG_CATEGORIES as readonly string[]).includes(maybeCategory)) {
        const category = maybeCategory as LogCategory;
        const action = args[1]?.toLowerCase();

        if (!action) {
          const current = overrides[category];
          const defaultChannelLabel = t(lang, 'commands.admin.setserverlog.defaultChannel');
          const categoryLabel = CATEGORY_LABELS[category] || category;
          return void (await message.reply(
            `**${categoryLabel}** logs → ${current ? `<#${current}>` : defaultChannelLabel}\n` +
              t(lang, 'commands.admin.setserverlog.logsUsageHint', { prefix, category }),
          ));
        }

        if (action === 'clear') {
          // handle unmigrated data
          settings.logChannelOverrides ??= {
            // values assumed to be populated in later calls
          } as ILogChannelOverrides;

          settings.logChannelOverrides[category] = null;
          settings.markModified('logChannelOverrides');
          await settings.save();
          settingsCache.invalidate(guild.id);
          const categoryLabel = CATEGORY_LABELS[category] || category;
          return void (await message.reply(
            t(lang, 'commands.admin.setserverlog.logsWillGoToDefaultChannel', { categoryLabel }),
          ));
        }

        let channelId: string | null;
        // assigns `channelId` within if statement
        if (!('1' in args) || ((channelId = parseChannelId(args[1])), !channelId)) {
          return void (await message.reply(t(lang, 'commands.generic.invalidChannelInput')));
        }

        const channel = await verifyChannel(channelId, guild, client);
        if (!channel) return void (await message.reply(t(lang, 'commands.generic.channelNotInGuild')));

        // handle unmigrated data
        settings.logChannelOverrides ??= {
          // values assumed to be populated in later calls
        } as ILogChannelOverrides;

        settings.logChannelOverrides[category] = channelId;
        settings.markModified('logChannelOverrides');
        await settings.save();
        settingsCache.invalidate(guild.id);

        const categoryLabel = CATEGORY_LABELS[category] || category;
        return void (await message.reply(
          t(lang, 'commands.admin.setserverlog.logsWillGoToChannel', { categoryLabel, channelId }),
        ));
      }

      const channelId = parseChannelId(args[0]);
      if (!channelId) {
        return void (await message.reply(
          t(lang, 'commands.admin.setserverlog.invalidArgument', {
            prefix,
            categories: LOG_CATEGORIES.join(', '),
          }),
        ));
      }

      const channel = await verifyChannel(channelId, guild, client);
      if (!channel) return void (await message.reply(t(lang, 'commands.generic.channelNotInGuild')));

      settings.serverLogChannelId = channelId;
      await settings.save();
      settingsCache.invalidate(guild.id);

      await message.reply(t(lang, 'commands.admin.setserverlog.setDone', { channelId }));
    } catch (error) {
      const guildName = guild?.name || 'Unknown Server';
      if (isNetworkError(error)) {
        console.warn(`[${guildName}] Fluxer API unreachable during !setserverlog (ECONNRESET)`);
      } else {
        console.error(`[${guildName}] Error in !setserverlog: ${messageFromError(error)}`);
        const cached = await settingsCache.get(guild.id).catch(() => null);
        const lang = normalizeLocale(cached?.language);
        message.reply(t(lang, 'commands.admin.setserverlog.errors.generic')).catch(() => {});
      }
    }
  },
};

export default command;
