import { EmbedBuilder, type GuildMember, type User } from '@fluxerjs/core';
import type { Command, IModeration } from '@/types';
import parseUserId from '@/utils/parseUserId';
import { canModerate, getMemberHighestRolePosition } from '@/utils/permissions';
import { logModAction } from '@/utils/logger';
import Warning from '@/models/Warning';
import ModerationLog from '@/models/ModerationLog';
import isNetworkError from '@/utils/isNetworkError';
import settingsCache from '@/utils/settingsCache';
import { sendUserDm } from '@/utils/sendUserDm';
import { t, normalizeLocale } from '@/i18n';
import { messageFromError } from '@/utils/messageFromError';

const command: Command = {
  name: 'warn',
  description:
    'Issue a formal warning to a user \u2014 reason is stored and can be reviewed with !warnings or cleared with !clearwarns',
  usage: '<@user or user ID> <reason>',
  category: 'moderation',
  permissions: ['ModerateMembers'],
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
      return void (await message.reply(t(lang, 'commands.moderation.warn.usage', { prefix })));
    }

    if (!args[1]) {
      return void (await message.reply(t(lang, 'commands.moderation.warn.missingReason')));
    }

    const userId = parseUserId(args[0]);
    if (!userId) {
      return void (await message.reply(t(lang, 'commands.generic.invalidUserInput')));
    }

    const reason = args.slice(1).join(' ').trim();

    let moderator = guild.members?.get(message.author.id);
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
    }

    try {
      const warningRecord = await Warning.addWarning(guild.id, userId, message.author.id, reason);
      const warningCount = warningRecord.warnings.length;

      let targetUser: Pick<User, 'id' | 'username'> | null = targetMember?.user ?? null;
      if (!targetUser) {
        try {
          targetUser = await client.users.fetch(userId);
        } catch {
          targetUser = { id: userId, username: t(lang, 'commands.userinfo.unknown') };
        }
      }

      const displayName = targetUser.username || targetUser.id;
      await message.reply(
        t(lang, 'commands.moderation.warn.success', {
          username: displayName,
          userId: targetUser.id,
          reason,
          warningCount,
        }),
      );

      try {
        const moderation: Partial<IModeration> = guildSettings?.moderation ?? {};
        const autoMuteEnabled = moderation.autoMute === true;
        const muteMethod: 'auto' | 'timeout' | 'mute_role' = moderation.muteMethod || 'auto';
        const threshold = Number.isFinite(Number(moderation.autoMuteThreshold))
          ? Math.max(1, Number(moderation.autoMuteThreshold))
          : 3;

        if (autoMuteEnabled && warningCount >= threshold && targetMember) {
          const muteRoleId = moderation.muteRoleId || guildSettings?.muteRoleId || null;
          const alreadyTimedOut =
            targetMember.communicationDisabledUntil && targetMember.communicationDisabledUntil > new Date();
          const alreadyRoleMuted = muteRoleId && targetMember.roles?.roleIds?.includes?.(muteRoleId);

          if (!alreadyTimedOut && !alreadyRoleMuted) {
            const botUserId = client.user?.id;
            let botMember: GuildMember | null = null;
            if (botUserId) {
              try {
                await guild.fetchRoles?.();
                botMember = await guild.fetchMember(botUserId);
              } catch {}
              if (!botMember) botMember = guild.members?.get?.(botUserId) ?? guild.members?.me;
            }

            let muted = false;
            const tryRole = muteMethod === 'mute_role' || muteMethod === 'auto';
            const tryTimeout = muteMethod === 'timeout' || muteMethod === 'auto';

            if (tryRole && muteRoleId && botMember) {
              const muteRole = guild.roles.get(muteRoleId);
              if (muteRole) {
                const muteRolePos = typeof muteRole.position === 'number' ? muteRole.position : 0;
                const botHighest = getMemberHighestRolePosition(botMember, guild);
                if (botHighest >= 0 && muteRolePos < botHighest) {
                  await targetMember.roles.add(muteRoleId);
                  muted = true;
                }
              }
            }

            if (!muted && tryTimeout) {
              const canBotModerate = botMember ? canModerate(botMember, targetMember).canModerate : true;
              if (canBotModerate) {
                const timeoutUntil = new Date(Date.now() + 10 * 60 * 1000);
                await targetMember.edit({
                  communicationDisabledUntil: timeoutUntil.toISOString(),
                  timeoutReason: `Auto-mute threshold reached (${warningCount}/${threshold})`,
                });
                muted = true;
              }
            }

            if (muted) {
              const autoMuteReason = t(lang, 'commands.moderation.warn.autoMuteReason', { warningCount, threshold });
              await message.reply(
                t(lang, 'commands.moderation.warn.autoMuteApplied', {
                  targetUserId: targetMember.id,
                  warningCount,
                  threshold,
                }),
              );
              await logModAction(guild, message.author, targetUser, 'mute', autoMuteReason, { client });
              await ModerationLog.logAction({
                guildId: guild.id,
                targetId: targetMember.id,
                userId: message.author.id,
                action: 'mute',
                reason: autoMuteReason,
                duration: 10 * 60 * 1000,
              });
            }
          }
        }
      } catch (autoMuteErr) {
        console.warn(`[${guild.name}] Auto-mute on warn failed: ${messageFromError(autoMuteErr)}`);
      }

      try {
        if (targetUser && targetUser.id) {
          const dmEmbed = new EmbedBuilder()
            .setTitle(t(lang, 'commands.moderation.warn.dmTitle', { guildName: guild.name }))
            .setDescription(t(lang, 'commands.moderation.warn.dmDescription', { guildName: guild.name }))
            .addFields(
              { name: t(lang, 'commands.moderation.warn.dmFieldReason'), value: reason },
              { name: t(lang, 'commands.moderation.warn.dmFieldTotalWarnings'), value: `${warningCount}` },
            )
            .setColor(0xf39c12);

          await sendUserDm(client, targetUser.id, { embeds: [dmEmbed] });
        }
      } catch (dmError) {
        console.log('Could not DM user about warning:', messageFromError(dmError));
      }

      await logModAction(guild, message.author, targetUser, 'warn', reason, {
        fields: [{ name: 'Total Warnings', value: `${warningCount}`, inline: true }],
        client,
      });

      await ModerationLog.logAction({
        guildId: guild.id,
        targetId: userId,
        userId: message.author.id,
        action: 'warn',
        reason,
        metadata: { caseNumber: warningCount },
      });
    } catch (error) {
      const guildName = guild.name;
      if (isNetworkError(error)) {
        console.warn(`[${guildName}] Fluxer API unreachable during !warn (ECONNRESET)`);
      } else {
        console.error(`[${guildName}] Error in !warn: ${messageFromError(error)}`);
        message.reply(t(lang, 'commands.moderation.warn.errors.generic')).catch(() => {});
      }
    }
  },
};

export default command;
