import type { Command } from '@/types';
import GuildSettings from '@/models/GuildSettings';
import settingsCache from '@/utils/settingsCache';
import isNetworkError from '@/utils/isNetworkError';
import { t, normalizeLocale } from '@/i18n';
import { messageFromError } from '@/utils/messageFromError';

const command: Command = {
  name: 'toggle-antilink',
  description: 'Block messages containing URLs; moderators and admins are exempt',
  usage: '',
  category: 'admin',
  permissions: ['ManageGuild'],
  cooldown: 3,

  async execute(message, _args, client) {
    let guild = message.guild;
    if (!guild && message.guildId) guild = await client.guilds.fetch(message.guildId);
    if (!guild) return void (await message.reply(t('en', 'commands.generic.serverOnly')));

    try {
      const settings = await GuildSettings.getOrCreate(guild.id);
      const lang = normalizeLocale(settings?.language);
      const newState = !settings.automod.antiLink;
      settings.automod.antiLink = newState;

      if (newState && (!settings.automod.level || settings.automod.level === 'off')) {
        settings.automod.level = 'minimal';
      }

      settings.markModified('automod');
      await settings.save();
      settingsCache.invalidate(guild.id);

      const status = newState ? 'enabled' : 'disabled';
      let reply = t(lang, 'commands.admin.toggleAntilink.base', { status });
      if (newState && settings.automod.level === 'minimal') {
        reply += ' ' + t(lang, 'commands.generic.automodSuffixLevelMinimal');
      }
      await message.reply(reply);
    } catch (error) {
      if (isNetworkError(error)) {
        console.warn(
          `[${guild?.name || 'Unknown Server'}] Fluxer API unreachable during !toggle-antilink (ECONNRESET)`,
        );
      } else {
        console.error(`[${guild?.name || 'Unknown Server'}] Error in !toggle-antilink: ${messageFromError(error)}`);
        const cached = await settingsCache.get(guild.id).catch(() => null);
        const lang = normalizeLocale(cached?.language);
        message.reply(t(lang, 'commands.admin.toggleAntilink.errors.generic')).catch(() => {});
      }
    }
  },
};

export default command;
