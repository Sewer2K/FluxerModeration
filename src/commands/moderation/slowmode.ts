import type { Command } from '@/types';
import { PermissionFlags } from '@fluxerjs/core';
import type { Channel } from '@fluxerjs/core';
import parseDuration from '@/utils/parseDuration';
import formatDuration from '@/utils/formatDuration';
import isNetworkError from '@/utils/isNetworkError';
import settingsCache from '@/utils/settingsCache';
import { t, normalizeLocale } from '@/i18n';
import { isGuildTextChannel } from '@/utils/isGuildTextChannel';

const MAX_SLOWMODE = 6 * 60 * 60; // 6 hours in seconds (21600)

const command: Command = {
  name: 'slowmode',
  description: 'Set channel slowmode. Duration format: 10s, 5m, 1h - max 6 hours',
  usage: '<duration> or "off" to disable',
  category: 'moderation',
  permissions: ['ManageChannels'],
  cooldown: 3,

  async execute(message, args, client) {
    const guildId = message.guild?.id;
    let lang: string = 'en';
    if (guildId) {
      try {
        const settings = await settingsCache.get(guildId);
        lang = normalizeLocale(settings?.language);
      } catch {}
    }
    let member = message.guild?.members?.get(message.author.id);
    if (!member && message.guild) {
      try {
        member = await message.guild.fetchMember(message.author.id);
      } catch {}
    }

    let channel: Channel;
    try {
      channel = message.channel ?? (await client.channels.fetch(message.channelId));
      if (!isGuildTextChannel(channel)) {
        return void (await message.reply(t(lang, 'commands.admin.keywords.serverOnly')));
      }
    } catch {
      return void (await message.reply(t(lang, 'auditCatalog.commands.admin.welcome.channelNotFound')));
    }

    if (member) {
      const perms = member.permissions;
      const hasManageChannels = perms?.has(PermissionFlags.ManageChannels);
      const hasAdmin = perms?.has(PermissionFlags.Administrator);
      const hasManageGuild = perms?.has(PermissionFlags.ManageGuild);

      if (!hasManageChannels && !hasAdmin && !hasManageGuild) {
        let allowed = false;
        if (guildId) {
          try {
            const settings = await settingsCache.get(guildId);
            const allowedRoles: string[] = settings?.slowmodeAllowedRoles ?? [];
            if (allowedRoles.length > 0) {
              const memberRoleIds: readonly string[] = member.roles?.roleIds ?? member.roles ?? [];
              allowed = memberRoleIds.some((rid: string) => allowedRoles.includes(rid));
            }
          } catch {}
        }

        if (!allowed) {
          return void (await message.reply(t(lang, 'commands.moderation.slowmode.permissionRequired')));
        }
      }
    }

    const currentSlowmode = channel.rateLimitPerUser || 0;

    if (!args[0]) {
      if (currentSlowmode === 0) {
        return void (await message.reply(t(lang, 'commands.moderation.slowmode.disabledInChannel')));
      }
      return void (await message.reply(
        t(lang, 'commands.moderation.slowmode.currentSlowmode', { duration: formatDuration(currentSlowmode * 1000) }),
      ));
    }

    if (args[0].toLowerCase() === 'off' || args[0] === '0') {
      try {
        await channel.edit({ rateLimitPerUser: 0 });
        await message.reply(t(lang, 'commands.moderation.slowmode.disabled'));
      } catch (error) {
        if (!isNetworkError(error)) {
          console.error('Error disabling slowmode:', error);
          return void (await message.reply(t(lang, 'commands.moderation.slowmode.failedDisable')));
        }
      }
      return;
    }

    const durationMs = parseDuration(args[0]);
    if (!durationMs || durationMs <= 0) {
      return void (await message.reply(t(lang, 'commands.moderation.slowmode.invalidDurationFormat')));
    }

    const durationSeconds = Math.floor(durationMs / 1000);

    if (durationSeconds < 1) {
      return void (await message.reply(t(lang, 'commands.moderation.slowmode.tooShort')));
    }

    if (durationSeconds > MAX_SLOWMODE) {
      return void (await message.reply(t(lang, 'commands.moderation.slowmode.tooLong')));
    }

    try {
      await channel.edit({ rateLimitPerUser: durationSeconds });
      await message.reply(t(lang, 'commands.moderation.slowmode.setSuccess', { duration: formatDuration(durationMs) }));
    } catch (error) {
      if (!isNetworkError(error)) {
        console.error('Error setting slowmode:', error);
        return void (await message.reply(t(lang, 'commands.moderation.slowmode.failedSet')));
      }
    }
  },
};

export default command;
