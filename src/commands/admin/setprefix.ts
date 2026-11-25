import type { Command } from '@/types';
import GuildSettings from '@/models/GuildSettings';
import settingsCache from '@/utils/settingsCache';
import isNetworkError from '@/utils/isNetworkError';
import { t, normalizeLocale } from '@/i18n';
import { messageFromError } from '@/utils/messageFromError';

const command: Command = {
  name: 'setprefix',
  description: 'Set a custom prefix for this server',
  usage: '<prefix>',
  category: 'admin',
  permissions: ['ManageGuild'],
  cooldown: 3,

  async execute(message, args, client) {
    let guild = message.guild;
    if (!guild && message.guildId) guild = await client.guilds.fetch(message.guildId);
    if (!guild) return void (await message.reply(t('en', 'commands.generic.serverOnly')));

    try {
      const settings = await GuildSettings.getOrCreate(guild.id);
      const lang = normalizeLocale(settings?.language);

      if (!args[0]) {
        const currentPrefixes = settings.prefixes || [];
        if (currentPrefixes.length === 0) {
          return void (await message.reply(t(lang, 'commands.admin.setprefix.noCustomPrefix')));
        }
        const prefixList = currentPrefixes.map((p: string) => `\`${p}\``).join(', ');
        return void (await message.reply(
          t(lang, 'commands.admin.setprefix.currentPrefixes', { prefixes: prefixList }),
        ));
      }

      const newPrefix = args[0];
      if (!newPrefix || newPrefix.trim() === '')
        return void (await message.reply(t(lang, 'commands.admin.setprefix.prefixEmpty')));
      if (newPrefix.includes(' '))
        return void (await message.reply(t(lang, 'commands.admin.setprefix.prefixNoSpaces')));
      if (newPrefix.length > 10)
        return void (await message.reply(t(lang, 'commands.admin.setprefix.prefixTooLong', { max: 10 })));

      await GuildSettings.updateSetting(guild.id, 'prefixes', [newPrefix]);
      settingsCache.invalidate(guild.id);
      await message.reply(t(lang, 'commands.admin.setprefix.success', { newPrefix }));
    } catch (error) {
      const guildName = guild?.name || 'Unknown Server';
      if (isNetworkError(error)) {
        console.warn(`[${guildName}] Fluxer API unreachable during !setprefix (ECONNRESET)`);
      } else {
        console.error(`[${guildName}] Error in !setprefix: ${messageFromError(error)}`);
        const cached = await settingsCache.get(guild.id).catch(() => null);
        const lang = normalizeLocale(cached?.language);
        message.reply(t(lang, 'commands.admin.setprefix.errors.generic')).catch(() => {});
      }
    }
  },
};

export default command;
