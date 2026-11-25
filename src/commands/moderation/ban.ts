import type { GuildMember, User } from '@fluxerjs/core';
import type { Command } from '@/types';
import parseUserId from '@/utils/parseUserId';
import { canModerate } from '@/utils/permissions';
import { logModAction } from '@/utils/logger';
import ModerationLog from '@/models/ModerationLog';
import TempBan from '@/models/TempBan';
import isNetworkError from '@/utils/isNetworkError';
import { isPermDenied, permMessage } from '@/utils/permError';
import settingsCache from '@/utils/settingsCache';
import { purgeWelcomeMessage } from '@/utils/welcomeMessageStore';
import { t, normalizeLocale } from '@/i18n';
import parseDuration from '@/utils/parseDuration';
import { messageFromError } from '@/utils/messageFromError';
import { recordBanAppeal } from '@/utils/banAppeals';

export function parsePurgeDays(value: string): number | null {
  const match = /^([1-7])d$/i.exec(value.trim());
  return match ? Number(match[1]) : null;
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 604800) return `${Math.floor(s / 86400)}d`;
  return `${Math.floor(s / 604800)}w`;
}

const command: Command = {
  name: 'ban',
  description:
    'Ban a user from the server. Add a duration (e.g. 1h, 7d, 2w) for a temp ban that auto-unbans. Can ban users not in the server. Reason is logged.',
  usage: '[purge|purge=Nd] <@user or user ID> [duration] [reason]',
  category: 'moderation',
  permissions: ['BanMembers'],
  cooldown: 3,

  async execute(message, args, client, prefix = '!') {
    let guild = message.guild;
    if (!guild && message.guildId) {
      guild = await client.guilds.fetch(message.guildId);
    }

    if (!guild) {
      return void (await message.reply(t('en', 'commands.generic.serverOnly')));
    }

    const guildSettings = await settingsCache.get(guild.id).catch(() => null);
    const lang = normalizeLocale(guildSettings?.language);

    if (!args[0]) {
      return void (await message.reply(t(lang, 'commands.moderation.ban.usage', { prefix })));
    }

    const commandArgs = [...args];
    let purgeDays: number | null = null;
    const purgeArg = commandArgs[0]?.toLowerCase();
    if (purgeArg === 'purge' || purgeArg?.startsWith('purge=')) {
      const requestedWindow = purgeArg === 'purge' ? '1d' : purgeArg.slice('purge='.length);
      purgeDays = parsePurgeDays(requestedWindow);
      if (purgeDays === null) {
        return void (await message.reply(t(lang, 'commands.moderation.ban.invalidPurge')));
      }
      commandArgs.shift();
    }

    if (!commandArgs[0]) {
      return void (await message.reply(t(lang, 'commands.moderation.ban.usage', { prefix })));
    }

    const noAppeal = commandArgs.some((arg) => arg.toLowerCase() === 'noappeal');
    if (noAppeal) {
      for (let index = commandArgs.length - 1; index >= 0; index--) {
        if (commandArgs[index]?.toLowerCase() === 'noappeal') commandArgs.splice(index, 1);
      }
    }

    const userId = parseUserId(commandArgs[0]);
    if (!userId) {
      return void (await message.reply(t(lang, 'commands.generic.invalidUserInput')));
    }

    let durationMs: number | null = null;
    let reasonStartIndex = 1;
    if (commandArgs[1]) {
      const parsed = parseDuration(commandArgs[1]);
      if (parsed !== null) {
        durationMs = parsed;
        reasonStartIndex = 2;
      }
    }

    const reason = commandArgs.slice(reasonStartIndex).join(' ').trim() || t(lang, 'commands.generic.noReasonProvided');
    const purgeNotice = purgeDays ? t(lang, 'commands.moderation.ban.purgeNotice', { days: purgeDays }) : '';

    let moderator = guild.members?.get(message.author.id) ?? null;
    if (!moderator) {
      moderator = await guild.fetchMember(message.author.id);
    }

    let targetMember = guild.members?.get(userId) ?? null;
    if (!targetMember) {
      try {
        targetMember = await guild.fetchMember(userId);
      } catch {
        targetMember = null;
      }
    }

    if (targetMember) {
      const modCheck = canModerate(moderator, targetMember);
      if (!modCheck.canModerate) {
        return void (await message.reply(`${modCheck.reason}`));
      }

      const botUserId = client.user?.id;
      let botMember: GuildMember | null = null;
      if (botUserId) {
        try {
          await guild.fetchRoles?.();
          botMember = await guild.fetchMember(botUserId);
        } catch {}
        if (!botMember) botMember = guild.members?.get?.(botUserId) ?? guild.members?.me;
      }
      if (botMember) {
        const botCheck = canModerate(botMember, targetMember);
        if (!botCheck.canModerate) {
          return void (await message.reply(t(lang, 'commands.moderation.ban.cannotBanRoleHierarchy')));
        }
      }
    }

    try {
      await guild.ban(userId, {
        reason: `${message.author.username}: ${reason}${purgeNotice ? ` (${purgeNotice})` : ''}`,
        ...(purgeDays ? { deleteMessageDays: purgeDays } : {}),
      });

      await purgeWelcomeMessage(client, guild.id, userId);

      let targetUser: Pick<User, 'id' | 'username'> | null = targetMember?.user ?? null;
      if (!targetUser) {
        try {
          targetUser = await client.users.fetch(userId);
        } catch {
          targetUser = { id: userId, username: t(lang, 'commands.userinfo.unknown') };
        }
      }

      const displayName = targetUser.username || targetUser.id;
      const durationStr = durationMs ? ` for ${formatDuration(durationMs)}` : '';
      const responseReason = `${reason}${durationStr}${purgeNotice ? ` (${purgeNotice})` : ''}`;
      await message.reply(
        t(lang, 'commands.moderation.ban.success', {
          username: displayName,
          userId: targetUser.id,
          reason: responseReason,
        }),
      );

      if (durationMs) {
        const expiresAt = new Date(Date.now() + durationMs);
        await TempBan.create({
          guildId: guild.id,
          userId,
          moderatorId: message.author.id,
          reason,
          expiresAt,
        });
      }

      const logReason = `${durationMs ? `${reason} (temp: ${formatDuration(durationMs)})` : reason}${
        purgeNotice ? ` (${purgeNotice})` : ''
      }`;
      await logModAction(guild, message.author, targetUser, 'ban', logReason, { client });

      const moderationLog = await ModerationLog.logAction({
        guildId: guild.id,
        targetId: userId,
        userId: message.author.id,
        action: durationMs ? 'tempban' : 'ban',
        reason: logReason,
      });

      await recordBanAppeal(client, {
        guildId: guild.id,
        userId,
        source: 'command',
        banReason: reason,
        moderatorId: message.author.id,
        permanent: !durationMs,
        eligible: !noAppeal,
        caseNumber: moderationLog.metadata?.caseNumber,
        guildName: guild.name,
      }).catch((error: unknown) => {
        console.warn(`[${guild.name}] Failed to create ban appeal link: ${messageFromError(error)}`);
      });
    } catch (error) {
      const guildName = guild?.name || 'Unknown Server';
      if (isNetworkError(error)) {
        console.warn(`[${guildName}] Fluxer API unreachable during !ban (ECONNRESET)`);
      } else if (isPermDenied(error)) {
        message.reply(permMessage(lang, 'ban')).catch(() => {});
      } else {
        console.error(`[${guildName}] Error in !ban: ${messageFromError(error)}`);
        message.reply(t(lang, 'commands.moderation.ban.errors.generic')).catch(() => {});
      }
    }
  },
};

export default command;
