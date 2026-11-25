import type { Command, IAutomod } from '@/types';
import GuildSettings from '@/models/GuildSettings';
import settingsCache from '@/utils/settingsCache';
import isNetworkError from '@/utils/isNetworkError';
import { t, normalizeLocale } from '@/i18n';
import { messageFromError } from '@/utils/messageFromError';

const command: Command = {
  name: 'toggle-ghostping',
  description: 'Detect and alert when a member pings someone then immediately deletes the message',
  usage: '',
  category: 'admin',
  permissions: ['ManageGuild'],
  cooldown: 3,

  async execute(message, _args, client, prefix = '!') {
    let guild = message.guild;
    if (!guild && message.guildId) guild = await client.guilds.fetch(message.guildId);
    if (!guild) return void (await message.reply(t('en', 'commands.generic.serverOnly')));

    try {
      const settings = await GuildSettings.getOrCreate(guild.id);
      const lang = normalizeLocale(settings?.language);

      // handle unmigrated data
      settings.automod ??= {
        // values assumed to be populated in later calls
      } as IAutomod;
      // for whatever reason, the other `toggle-*` commands do not feature the above unmigrated data handler

      settings.automod.ghostPing = !settings.automod.ghostPing;
      settings.markModified('automod');
      await settings.save();
      settingsCache.invalidate(guild.id);

      const status = settings.automod.ghostPing ? 'enabled' : 'disabled';
      let reply = t(lang, 'commands.admin.toggleGhostping.base', { status });

      if (settings.automod.ghostPing && settings.automod.level === 'off') {
        reply += t(lang, 'commands.admin.toggleGhostping.noteLevelOff', { prefix });
      }

      await message.reply(reply);
    } catch (error) {
      const guildName = guild?.name || 'Unknown Server';
      if (isNetworkError(error)) {
        console.warn(`[${guildName}] Fluxer API unreachable during !toggle-ghostping (ECONNRESET)`);
      } else {
        console.error(`[${guildName}] Error in !toggle-ghostping: ${messageFromError(error)}`);
        const cached = await settingsCache.get(guild.id).catch(() => null);
        const lang = normalizeLocale(cached?.language);
        message.reply(t(lang, 'commands.admin.toggleGhostping.errors.generic')).catch(() => {});
      }
    }
  },
};

export default command;
