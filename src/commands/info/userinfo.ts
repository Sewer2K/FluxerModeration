import { EmbedBuilder, GuildMember, User } from '@fluxerjs/core';
import type { Command } from '@/types';
import parseUserId from '@/utils/parseUserId';
import isNetworkError from '@/utils/isNetworkError';
import settingsCache from '@/utils/settingsCache';
import { t, normalizeLocale } from '@/i18n';
import { messageFromError } from '@/utils/messageFromError';
import { snowflakeToDate } from '@/utils/snowflakeDate';

const command: Command = {
  name: 'userinfo',
  description:
    'Show profile info for a user \u2014 account age, server join date, roles, and timeout status. Leave blank for your own info',
  usage: '[@user or user ID]',
  category: 'info',
  cooldown: 5,

  async execute(message, args, client) {
    console.log('user infoing');

    let guild = message.guild;
    if (!guild && message.guildId) {
      guild = await client.guilds.fetch(message.guildId);
    }

    if (!guild) {
      return void (await message.reply(t('en', 'commands.generic.serverOnly')));
    }

    try {
      const settings = await settingsCache.get(guild.id).catch(() => null);
      const lang = normalizeLocale(settings?.language);
      let userId = message.author.id;

      if (args[0]) {
        const parsedId = parseUserId(args[0]);
        if (!parsedId) {
          return void (await message.reply(t(lang, 'commands.generic.invalidUserInput')));
        }
        userId = parsedId;
      }

      let user: User | null = null;
      try {
        user = await client.users.fetch(userId);
      } catch {
        return void (await message.reply(t(lang, 'commands.userinfo.userNotFound')));
      }

      let member: GuildMember | null = guild.members.get(userId) ?? null;
      if (!member) {
        try {
          member = await guild.fetchMember(userId);
        } catch {
          member = null;
        }
      }

      const createdAt = snowflakeToDate(user.id) ?? new Date(0);
      const localeForDate = lang === 'en' ? 'en-US' : lang;
      const createdString = createdAt.toLocaleDateString(localeForDate, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });

      // there is no indication from the Fluxer API nor FluxerJS that `displayColor` is returned here. There is an
      // `accentColor` value on `GuildMember` but it appears to be null regardless of role. It's described in the Fluxer
      // OpenAPI spec as "The accent colour of the member guild profile as an integer"
      const displayColor: unknown = (member as Record<string, unknown> | null)?.displayColor;

      const embed = new EmbedBuilder()
        .setTitle(user.username)
        .setColor(
          displayColor && (typeof displayColor === 'number' || typeof displayColor === 'string')
            ? displayColor
            : 0x3498db,
        )
        .setThumbnail(user.avatarURL?.() || null)
        .addFields(
          { name: t(lang, 'commands.userinfo.fieldId'), value: user.id, inline: true },
          {
            name: t(lang, 'commands.userinfo.fieldBot'),
            value: user.bot ? t(lang, 'commands.userinfo.yes') : t(lang, 'commands.userinfo.no'),
            inline: true,
          },
          { name: t(lang, 'commands.userinfo.fieldAccountCreated'), value: createdString, inline: true },
        );

      if (member) {
        const joinedAt = member.joinedAt ? new Date(member.joinedAt) : null;
        const joinedString = joinedAt
          ? joinedAt.toLocaleDateString(localeForDate, {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })
          : t(lang, 'commands.userinfo.unknown');

        embed.addFields({ name: t(lang, 'commands.userinfo.fieldJoinedServer'), value: joinedString, inline: true });

        if (member.roles && member.roles.cache) {
          const roles = member.roles.cache
            .filter((role) => role.id !== guild.id)
            .map((role) => `<@&${role.id}>`)
            .slice(0, 10)
            .join(', ');

          if (roles) {
            const totalRoles = member.roles.cache.size - 1;
            embed.addFields({
              name: t(lang, 'commands.userinfo.fieldRoles', { totalRoles }),
              value: roles + (totalRoles > 10 ? t(lang, 'commands.userinfo.rolesOverflowSuffix') : ''),
              inline: false,
            });
          }
        }

        if (member.communicationDisabledUntil && member.communicationDisabledUntil > new Date()) {
          const timeoutEnd = new Date(member.communicationDisabledUntil);
          embed.addFields({
            name: t(lang, 'commands.userinfo.fieldTimeout'),
            value: t(lang, 'commands.userinfo.timeoutUntil', { timeoutEnd: timeoutEnd.toLocaleString(localeForDate) }),
            inline: true,
          });
        }

        if (member.nick) {
          embed.addFields({ name: t(lang, 'commands.userinfo.fieldNickname'), value: member.nick, inline: true });
        }
      }

      await message.reply({ embeds: [embed] });
    } catch (error) {
      const guildName = guild?.name || 'Unknown Server';
      if (isNetworkError(error)) {
        console.warn(`[${guildName}] Fluxer API unreachable during !userinfo (ECONNRESET)`);
      } else {
        console.error(`[${guildName}] Error in !userinfo: ${messageFromError(error)}`);
        message.reply(t('en', 'commands.userinfo.genericError')).catch(() => {});
      }
    }
  },
};

export default command;
