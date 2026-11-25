import type { Channel } from '@fluxerjs/core';
import type { Command, IModeration } from '@/types';
import GuildSettings from '@/models/GuildSettings';
import settingsCache from '@/utils/settingsCache';
import isNetworkError from '@/utils/isNetworkError';
import { t, normalizeLocale } from '@/i18n';
import { messageFromError } from '@/utils/messageFromError';

const command: Command = {
  name: 'setlog',
  description: 'Set the channel where moderation actions are logged. Run with no argument to view the current setting',
  usage: '[#channel or channel ID]',
  category: 'admin',
  permissions: ['ManageGuild'],
  cooldown: 3,

  async execute(message, args, client, prefix = '!') {
    let guild = message.guild;
    if (!guild && message.guildId) guild = await client.guilds.fetch(message.guildId);
    if (!guild) return void (await message.reply(t('en', 'commands.generic.serverOnly')));

    try {
      const settings = await GuildSettings.getOrCreate(guild.id);
      const lang = normalizeLocale(settings?.language);

      if (!args[0]) {
        const current = settings.moderation?.logChannelId || settings.logChannelId;
        if (!current) return void (await message.reply(t(lang, 'commands.admin.setlog.noLogChannel', { prefix })));
        return void (await message.reply(t(lang, 'commands.admin.setlog.currentLogChannel', { channelId: current })));
      }

      if (args[0].toLowerCase() === 'clear') {
        // handle unmigrated data
        settings.moderation ??= {
          // values assumed to be populated in later calls
        } as IModeration;

        settings.moderation.logChannelId = null;
        settings.logChannelId = null;
        settings.markModified('moderation');
        await settings.save();
        settingsCache.invalidate(guild.id);
        return void (await message.reply(t(lang, 'commands.admin.setlog.cleared')));
      }

      const channelMention = args[0].match(/^<#(\d{17,19})>$/);
      let channelId: string;
      if (channelMention && '1' in channelMention) channelId = channelMention[1];
      else if (/^\d{17,19}$/.test(args[0])) channelId = args[0];
      else return void (await message.reply(t(lang, 'commands.generic.invalidChannelInput')));

      let channel: Channel | null = guild.channels?.get(channelId) ?? null;
      if (!channel) {
        try {
          channel = await client.channels.fetch(channelId);
        } catch {
          return void (await message.reply(t(lang, 'commands.generic.channelNotInGuild')));
        }
      }
      if (!channel) return void (await message.reply(t(lang, 'commands.generic.channelNotInGuild')));

      // handle unmigrated data
      settings.moderation ??= {
        // values assumed to be populated in later calls
      } as IModeration;

      settings.moderation.logChannelId = channelId;
      settings.logChannelId = null;
      settings.markModified('moderation');
      await settings.save();
      settingsCache.invalidate(guild.id);
      await message.reply(t(lang, 'commands.admin.setlog.setDone', { channelId }));
    } catch (error) {
      const guildName = guild?.name || 'Unknown Server';
      if (isNetworkError(error)) {
        console.warn(`[${guildName}] Fluxer API unreachable during !setlog (ECONNRESET)`);
      } else {
        console.error(`[${guildName}] Error in !setlog: ${messageFromError(error)}`);
        const cached = await settingsCache.get(guild.id).catch(() => null);
        const lang = normalizeLocale(cached?.language);
        message.reply(t(lang, 'commands.admin.setlog.errors.generic')).catch(() => {});
      }
    }
  },
};

export default command;
