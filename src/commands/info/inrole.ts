import { EmbedBuilder, type GuildMember } from '@fluxerjs/core';
import type { Command } from '@/types';
import isNetworkError from '@/utils/isNetworkError';
import { registerReactionPaginator } from '@/utils/reactionPaginator';
import settingsCache from '@/utils/settingsCache';
import { formatCompactPageIndicator, joinCompactFooterParts } from '@/utils/embedPresentation';
import { t, normalizeLocale } from '@/i18n';
import { isArray } from '@/utils/isArray';
import { messageFromError } from '@/utils/messageFromError';

const command: Command = {
  name: 'inrole',
  description: 'List every member who has a specific role',
  usage: '<@role or role ID> [starting page]',
  category: 'info',
  cooldown: 10,

  async execute(message, args, client, prefix = '!') {
    let guild = message.guild;
    if (!guild && message.guildId) guild = await client.guilds.fetch(message.guildId);
    if (!guild) return void (await message.reply(t('en', 'commands.generic.serverOnly')));
    const settings = await settingsCache.get(guild.id).catch(() => null);
    const lang = normalizeLocale(settings?.language);

    const roleArg = args[0];
    if (!roleArg) return void (await message.reply(t(lang, 'commands.inrole.usage', { prefix })));

    const roleMention = roleArg.match(/^<@&(\d{17,19})>$/);
    let roleId: string;
    if (roleMention && '1' in roleMention) roleId = roleMention[1];
    else if (/^\d{17,19}$/.test(roleArg)) roleId = roleArg;
    else return void (await message.reply(t(lang, 'commands.generic.invalidRoleInput')));

    try {
      let role = guild.roles.get(roleId);
      if (!role) {
        try {
          role = await guild.fetchRole(roleId);
        } catch {}
      }
      if (!role) return void (await message.reply(t(lang, 'commands.generic.roleNotFound')));

      const members: GuildMember[] = [];
      try {
        let lastId: string | undefined;
        while (true) {
          const batch = await guild.members.fetch({ limit: 1000, ...(lastId && { after: lastId }) });
          members.push(...batch);
          if (batch.length < 1000) break;
          // `batch` is 1000-elements-long or longer here, it is certain that it's not empty here
          lastId = batch[batch.length - 1]!.id;
        }
      } catch (err) {
        const guildName = guild?.name || 'Unknown Server';
        if (isNetworkError(err)) {
          console.warn(`[${guildName}] Fluxer API unreachable during !inrole (ECONNRESET)`);
        } else {
          console.error(`[${guildName}] Error in !inrole: ${messageFromError(err)}`);
        }
        return void (await message.reply(t(lang, 'commands.generic.membersFetchFailed')));
      }

      const withRole = members.filter((m) => {
        if (typeof m.roles.has === 'function') return m.roles.has(roleId);
        const ids = m.roles.roleIds ?? (isArray(m.roles) ? m.roles : []);
        return ids.includes(roleId);
      });

      if (withRole.length === 0) {
        return void (await message.reply(t(lang, 'commands.inrole.noneWithRole', { roleName: role.name })));
      }

      const PAGE_SIZE = 50;
      const totalPages = Math.max(1, Math.ceil(withRole.length / PAGE_SIZE));

      let page = 1;
      if (args[1]) {
        const parsed = parseInt(args[1], 10);
        if (isNaN(parsed) || parsed < 1) return void (await message.reply(t(lang, 'commands.inrole.invalidPage')));
        if (parsed > totalPages) {
          return void (await message.reply(t(lang, 'commands.inrole.pageTooHigh', { totalPages })));
        }
        page = parsed;
      }

      const pageEmbeds = Array.from({ length: totalPages }, (_, pageIndex) => {
        const start = pageIndex * PAGE_SIZE;
        const displayed = withRole.slice(start, start + PAGE_SIZE);

        const list = displayed.map((m) => (m.user ? `<@${m.id}> (${m.user.username})` : `<@${m.id}>`)).join('\n');

        return new EmbedBuilder()
          .setTitle(t(lang, 'commands.inrole.embedTitle', { roleName: role.name }))
          .setColor(role.color || 0x5865f2)
          .setDescription(list)
          .setFooter({
            text: joinCompactFooterParts([
              t(lang, 'commands.inrole.footerTotal', { memberCount: withRole.length }),
              formatCompactPageIndicator(pageIndex + 1, totalPages),
            ]),
          });
      });

      const sentMessage = await message.reply({
        embeds: [pageEmbeds[page - 1]! /* `page - 1` is checked to be within `pageEmbeds`'s length */],
      });

      if (totalPages > 1) {
        const ownerUserId = message.author.id;
        const responseChannelId = sentMessage.channelId;
        const responseMessageId = sentMessage.id;

        if (ownerUserId && responseChannelId && responseMessageId) {
          await registerReactionPaginator(client, {
            messageId: responseMessageId,
            channelId: responseChannelId,
            ownerUserId,
            pages: pageEmbeds,
            initialPageIndex: page - 1,
            ttlMs: 3 * 60 * 1000,
            targetMessage: sentMessage,
          });
        }
      }

      return;
    } catch (error) {
      const guildName = guild?.name || 'Unknown Server';
      if (isNetworkError(error)) {
        console.warn(`[${guildName}] Fluxer API unreachable during !inrole (ECONNRESET)`);
      } else {
        console.error(`[${guildName}] Error in !inrole: ${messageFromError(error)}`);
        message.reply(t(lang, 'commands.inrole.genericError')).catch(() => {});
      }
    }
  },
};

export default command;
