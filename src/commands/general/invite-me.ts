import { EmbedBuilder } from '@fluxerjs/core';
import type { Command } from '@/types';
import isNetworkError from '@/utils/isNetworkError';
import settingsCache from '@/utils/settingsCache';
import { t, normalizeLocale } from '@/i18n';
import config from '@/config';
import { messageFromError } from '@/utils/messageFromError';
import { fluxerBotInviteUrl } from '@/utils/fluxerUrls';

const command: Command = {
  name: 'invite-me',
  description: `Get the bot invite link to add ${config.branding.publicName} to your server.`,
  usage: '',
  category: 'general',
  aliases: ['inv'],
  cooldown: 5,

  async execute(message, _args, _client) {
    try {
      const inviteUrl = fluxerBotInviteUrl();
      const guildId = message.guildId || message.guild?.id;
      const settings = guildId ? await settingsCache.get(guildId).catch(() => null) : null;
      const lang = normalizeLocale(settings?.language);
      const embed = new EmbedBuilder()
        .setTitle(t(lang, 'commands.invite.title'))
        .setDescription(
          t(lang, 'auditCatalog.commands.general.invite_me.l24_setDescription', { INVITE_URL: inviteUrl }),
        )
        .setColor(0x6c72f8);

      await message.reply({ embeds: [embed] });
    } catch (error) {
      if (isNetworkError(error)) {
        console.warn('Fluxer API unreachable during !invite-me (ECONNRESET)');
      } else {
        console.error(`Error in !invite-me: ${messageFromError(error)}`);
        await message.reply(t('en', 'commands.invite.fallback', { inviteUrl: fluxerBotInviteUrl() })).catch(() => {});
      }
    }
  },
};

export default command;
