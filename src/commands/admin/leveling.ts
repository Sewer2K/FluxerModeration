import type { Command, ILeveling } from '@/types';
import GuildSettings from '@/models/GuildSettings';
import settingsCache from '@/utils/settingsCache';
import isNetworkError from '@/utils/isNetworkError';
import { t, normalizeLocale } from '@/i18n';
import { getLevelingConfig } from '@/utils/leveling';
import { messageFromError } from '@/utils/messageFromError';

function parseSubcommand(raw?: string): 'enable' | 'disable' | 'toggle' | 'status' | null {
  const sub = raw?.toLowerCase();
  if (!sub || sub === 'status') return 'status';
  if (sub === 'on' || sub === 'enable') return 'enable';
  if (sub === 'off' || sub === 'disable') return 'disable';
  if (sub === 'toggle') return 'toggle';
  return null;
}

const command: Command = {
  name: 'leveling',
  description: 'Enable, disable, or check the leveling system',
  usage: '<enable|disable|toggle|status>',
  category: 'admin',
  aliases: ['levelconfig', 'xpconfig'],
  permissions: ['ManageGuild'],
  cooldown: 3,

  async execute(message, args, client, prefix = '!') {
    let guild = message.guild;
    if (!guild && message.guildId) guild = await client.guilds.fetch(message.guildId);
    if (!guild) return void (await message.reply(t('en', 'commands.generic.serverOnly')));

    const sub = parseSubcommand(args[0]);
    if (!sub) {
      return void (await message.reply(t('en', 'commands.admin.leveling.usage', { prefix })));
    }

    try {
      const settings = await GuildSettings.getOrCreate(guild.id);
      const lang = normalizeLocale(settings?.language);
      const leveling = getLevelingConfig(settings);

      if (sub === 'status') {
        const messageXp = leveling.messageXp.enabled ? 'on' : 'off';
        const voiceXp = leveling.voiceXp.enabled ? 'on' : 'off';
        const reactionXp = leveling.reactionXp.enabled ? 'on' : 'off';
        return void (await message.reply(
          t(lang, 'commands.admin.leveling.status', {
            enabled: leveling.enabled ? 'enabled' : 'disabled',
            messageXp,
            voiceXp,
            reactionXp,
            prefix,
          }),
        ));
      }

      const nextEnabled = sub === 'enable' ? true : sub === 'disable' ? false : !leveling.enabled;
      if (nextEnabled === leveling.enabled) {
        return void (await message.reply(
          t(lang, nextEnabled ? 'commands.admin.leveling.alreadyEnabled' : 'commands.admin.leveling.alreadyDisabled'),
        ));
      }

      // handle unmigrated data
      if (!settings.leveling || typeof settings.leveling !== 'object') {
        settings.leveling = {
          // values assumed to be populated in later calls
        } as ILeveling;
      }
      settings.leveling.enabled = nextEnabled;
      settings.markModified('leveling');
      await settings.save();
      settingsCache.invalidate(guild.id);

      return void (await message.reply(
        t(lang, nextEnabled ? 'commands.admin.leveling.enabled' : 'commands.admin.leveling.disabled', { prefix }),
      ));
    } catch (error) {
      if (isNetworkError(error)) {
        console.warn(`[${guild?.name || 'Unknown Server'}] Fluxer API unreachable during !leveling (ECONNRESET)`);
        return;
      }
      console.error(`[${guild?.name || 'Unknown Server'}] Error in !leveling: ${messageFromError(error)}`);
      const cached = await settingsCache.get(guild.id).catch(() => null);
      const lang = normalizeLocale(cached?.language);
      await message.reply(t(lang, 'commands.admin.leveling.errors.generic')).catch(() => {});
    }
  },
};

export default command;
