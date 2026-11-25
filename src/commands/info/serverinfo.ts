import { EmbedBuilder } from '@fluxerjs/core';
import { Routes } from '@fluxerjs/types';
import type { APIGuild, APIGuildMember } from '@fluxerjs/types';
import type { Command } from '@/types';
import isNetworkError from '@/utils/isNetworkError';
import * as memberCounter from '@/utils/memberCounter';
import settingsCache from '@/utils/settingsCache';
import { formatGuildFeatures, resolveGuildChannelCounts, resolveGuildRoleCount } from '@/utils/guildInfoStats';
import { snowflakeToDate } from '@/utils/snowflakeDate';
import { t, normalizeLocale } from '@/i18n';
import { isArray } from '@/utils/isArray';
import { messageFromError } from '@/utils/messageFromError';

function formatCreatedDate(date: Date, lang: string): string {
  const localeForDate = lang === 'en' ? 'en-US' : lang;
  return date.toLocaleDateString(localeForDate, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

const command: Command = {
  name: 'serverinfo',
  description: 'Show server stats \u2014 owner, member count, channels, roles, and creation date',
  usage: '',
  category: 'info',
  cooldown: 5,

  async execute(message, _args, client) {
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
      const ownerId = guild.ownerId;

      const guildData = (await client.rest.get(Routes.guild(guild.id)).catch(() => null)) as APIGuild & {
        member_count?: unknown;

        // there is no indication that the Fluxer API returns a `created_at` value
        created_at?: unknown;
      };

      const [{ textChannels, voiceChannels, categories }, roleCount] = await Promise.all([
        resolveGuildChannelCounts(guild, client),
        resolveGuildRoleCount(guild, client),
      ]);

      let memberCount = 0;
      try {
        if (typeof guildData?.member_count === 'number' && guildData.member_count > 0) {
          memberCount = guildData.member_count;
        } else {
          const cached = memberCounter.get(guild.id);
          if (cached) {
            memberCount = cached;
          } else {
            let lastId: string | undefined;
            while (true) {
              const qs = `?limit=1000${lastId ? `&after=${lastId}` : ''}`;
              const list = (await client.rest.get(Routes.guildMembers(guild.id) + qs, { auth: true })) as
                APIGuildMember[] | { members?: APIGuildMember[] };
              const arr = isArray(list) ? list : (list.members ?? []);
              memberCount += arr.length;
              if (arr.length < 1000) break;
              lastId = arr[arr.length - 1]?.user?.id;
              if (!lastId) break;
            }
          }
        }
      } catch {
        memberCount = memberCounter.get(guild.id) || guild.members?.size || 0;
      }

      const createdAt =
        (typeof guildData.created_at === 'string' || typeof guildData.created_at === 'number'
          ? new Date(guildData.created_at)
          : null) ?? snowflakeToDate(guild.id);
      const createdString = createdAt ? formatCreatedDate(createdAt, lang) : '—';

      const features = formatGuildFeatures(guildData?.features ?? guild.features, t(lang, 'commands.serverinfo.none'));

      const embed = new EmbedBuilder()
        .setTitle(guild.name || guildData?.name || guild.id)
        .setDescription(`\`${guild.id}\``)
        .setColor(0x3498db)
        .setThumbnail(guild.iconURL?.() || null)
        .addFields(
          { name: t(lang, 'commands.serverinfo.fieldOwner'), value: `<@${ownerId}>`, inline: true },
          { name: t(lang, 'commands.serverinfo.fieldMembers'), value: `${memberCount}`, inline: true },
          { name: t(lang, 'commands.serverinfo.fieldRoles'), value: `${roleCount}`, inline: true },
          { name: t(lang, 'commands.serverinfo.fieldTextChannels'), value: `${textChannels}`, inline: true },
          { name: t(lang, 'commands.serverinfo.fieldVoiceChannels'), value: `${voiceChannels}`, inline: true },
          { name: t(lang, 'commands.serverinfo.fieldCategories'), value: `${categories}`, inline: true },
          { name: t(lang, 'commands.serverinfo.fieldCreated'), value: createdString, inline: true },
          {
            name: t(lang, 'commands.serverinfo.fieldFeatures'),
            value: features.substring(0, 1024) || t(lang, 'commands.serverinfo.none'),
            inline: false,
          },
        );

      await message.reply({ embeds: [embed] });
    } catch (error) {
      const guildName = guild?.name || 'Unknown Server';
      if (isNetworkError(error)) {
        console.warn(`[${guildName}] Fluxer API unreachable during !serverinfo (ECONNRESET)`);
      } else {
        console.error(`[${guildName}] Error in !serverinfo: ${messageFromError(error)}`);
        message.reply(t('en', 'commands.serverinfo.genericError')).catch(() => {});
      }
    }
  },
};

export default command;
