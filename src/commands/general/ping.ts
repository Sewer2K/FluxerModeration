import { EmbedBuilder, Routes } from '@fluxerjs/core';
import type { Command } from '@/types';
import isNetworkError from '@/utils/isNetworkError';
import settingsCache from '@/utils/settingsCache';
import { getGatewayPing } from '@/utils/gatewayPing';
import { t, normalizeLocale } from '@/i18n';
import { messageFromError } from '@/utils/messageFromError';

const command: Command = {
  name: 'ping',
  description: 'Check if the bot is online and see the round-trip response time',
  usage: '',
  category: 'general',
  cooldown: 3,

  async execute(message, _args, client) {
    try {
      const guildId = message.guildId || message.guild?.id;
      const gatewayPing = getGatewayPing(client);

      const replyStart = Date.now();
      const restStart = Date.now();
      const [settings, msg, restLatency] = await Promise.all([
        guildId ? settingsCache.get(guildId).catch(() => null) : Promise.resolve(null),
        message.reply(t('en', 'commands.ping.pinging')),
        client.rest
          .get(Routes.currentUser())
          .then(() => Date.now() - restStart)
          .catch(() => null),
      ]);
      const roundTrip = Date.now() - replyStart;
      const lang = normalizeLocale(settings?.language);

      const fields = [
        {
          name: t(lang, 'commands.ping.gateway'),
          value: gatewayPing !== null ? `\`${gatewayPing}ms\`` : '`—`',
          inline: true,
        },
        {
          name: t(lang, 'commands.ping.restApi'),
          value: restLatency !== null ? `\`${restLatency}ms\`` : '`—`',
          inline: true,
        },
        {
          name: t(lang, 'commands.ping.roundTrip'),
          value: `\`${roundTrip}ms\``,
          inline: true,
        },
      ];

      const embed = new EmbedBuilder()
        .setTitle(t(lang, 'commands.ping.title'))
        .setColor(0x5865f2)
        .addFields(...fields);

      const warmingUp = client.isGatewayRecovering?.() || process.uptime() < 90;
      if (warmingUp) {
        embed.setFooter({ text: t(lang, 'commands.ping.warmingUp') });
      }

      await msg.edit({ content: '', embeds: [embed] });
    } catch (error) {
      if (isNetworkError(error)) {
        console.warn(`Fluxer API unreachable during !ping (ECONNRESET)`);
      } else {
        console.error(`Error in !ping: ${messageFromError(error)}`);
      }
    }
  },
};

export default command;
