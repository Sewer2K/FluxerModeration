import type { Command } from '@/types';
import GuildSettings from '@/models/GuildSettings';
import settingsCache from '@/utils/settingsCache';
import isNetworkError from '@/utils/isNetworkError';
import { t, normalizeLocale } from '@/i18n';
import { messageFromError } from '@/utils/messageFromError';

const command: Command = {
  name: 'toggle-automod',
  description: 'Enable or disable the entire automod system \u2014 overrides all individual filter toggles',
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
      const currentLevel = settings.automod?.level || 'off';
      const newLevel = currentLevel === 'off' ? 'minimal' : 'off';

      settings.automod.level = newLevel;
      settings.markModified('automod');
      await settings.save();
      settingsCache.invalidate(guild.id);

      if (newLevel === 'off') return void (await message.reply(t(lang, 'commands.admin.toggleAutomod.disabled')));
      return void (await message.reply(t(lang, 'commands.admin.toggleAutomod.enabled')));
    } catch (error) {
      if (isNetworkError(error)) {
        console.warn(`[${guild?.name || 'Unknown Server'}] Fluxer API unreachable during !toggle-automod (ECONNRESET)`);
      } else {
        console.error(`[${guild?.name || 'Unknown Server'}] Error in !toggle-automod: ${messageFromError(error)}`);
        const cached = await settingsCache.get(guild.id).catch(() => null);
        const lang = normalizeLocale(cached?.language);
        message.reply(t(lang, 'commands.admin.toggleAutomod.errors.generic')).catch(() => {});
      }
    }
  },
};

export default command;
