import { EmbedBuilder, Role } from '@fluxerjs/core';
import type { Command } from '@/types';
import isNetworkError from '@/utils/isNetworkError';
import { joinCompactFooterParts } from '@/utils/embedPresentation';
import settingsCache from '@/utils/settingsCache';
import { t, normalizeLocale } from '@/i18n';
import { messageFromError } from '@/utils/messageFromError';

const command: Command = {
  name: 'rolelist',
  description: 'Show all roles in this server sorted by position',
  usage: '',
  category: 'info',
  cooldown: 5,

  async execute(message, _args, client) {
    let guild = message.guild;
    if (!guild && message.guildId) guild = await client.guilds.fetch(message.guildId);
    const settings = guild ? await settingsCache.get(guild.id).catch(() => null) : null;
    const lang = normalizeLocale(settings?.language);
    if (!guild) return void (await message.reply(t(lang, 'commands.generic.serverOnly')));

    try {
      let roles: Role[];
      try {
        roles = await guild.fetchRoles();
      } catch {
        roles = [...guild.roles.values()];
      }

      const sorted = roles.filter((r) => r.name !== '@everyone').sort((a, b) => (b.position ?? 0) - (a.position ?? 0));

      if (sorted.length === 0) {
        return void (await message.reply(t(lang, 'auditCatalog.commands.info.rolelist.l35_reply')));
      }

      const MAX_DISPLAY = 40;
      const displayed = sorted.slice(0, MAX_DISPLAY);
      const overflow = sorted.length - displayed.length;

      const lines = displayed.map((r) => {
        const color = r.color ? `\`#${r.color.toString(16).padStart(6, '0').toUpperCase()}\`` : '`default`';
        return `<@&${r.id}> ${color}`;
      });

      const embed = new EmbedBuilder()
        .setTitle(t(lang, 'auditCatalog.commands.info.rolelist.l50_setTitle', { 'guild.name': guild.name }))
        .setColor(0x5865f2)
        .setDescription(lines.join('\n'))
        .setFooter({
          text: joinCompactFooterParts([`${sorted.length} role(s)`, overflow > 0 ? `${overflow} more` : null]),
        });

      return void (await message.reply({ embeds: [embed] }));
    } catch (error) {
      const guildName = guild?.name || 'Unknown Server';
      if (isNetworkError(error)) {
        console.warn(`[${guildName}] Fluxer API unreachable during !rolelist (ECONNRESET)`);
      } else {
        console.error(`[${guildName}] Error in !rolelist: ${messageFromError(error)}`);
        message.reply(t(lang, 'auditCatalog.commands.info.rolelist.l68_reply')).catch(() => {});
      }
    }
  },
};

export default command;
