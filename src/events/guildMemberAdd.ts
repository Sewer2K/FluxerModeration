import type { Channel, Client, Guild, GuildMember, MessageSendOptions } from '@fluxerjs/core';
import { EmbedBuilder } from '@fluxerjs/core';
import type { BotEvent, IWelcomeCard } from '@/types';
import settingsCache from '@/utils/settingsCache';
import isNetworkError from '@/utils/isNetworkError';
import * as autoroleQueue from '@/utils/autoroleQueue';
import { LogField, logServerEvent } from '@/utils/logger';
import * as memberCounter from '@/utils/memberCounter';
import { generateWelcomeCard } from '@/utils/welcomeCard';
import { retrySend } from '@/utils/retrySend';
import GlobalBan, { type GlobalBanDocument } from '@/models/GlobalBan';
import GlobalBanPrompt from '@/models/GlobalBanPrompt';
import { recordJoin, sendRaidAlert, isRaidActive, lockInvitesForRaid, getAccountAgeDays } from '@/utils/raidDetector';
import { assessMember, checkAndAlert, SUSPICIOUS_ALERT_THRESHOLD } from '@/utils/suspiciousDetector';
import { recordWelcomeMessage, purgeWelcomeMessage } from '@/utils/welcomeMessageStore';
import { t } from '@/i18n';
import { sendMessage } from '@/utils/sendMessage';
import config from '@/config';
import { isTextChannel } from '@/utils/isTextChannel';
import { messageFromError } from '@/utils/messageFromError';
import activityService from '@/services/ActivityService';
import { snowflakeToDate } from '@/utils/snowflakeDate';
import { recordBanAppeal } from '@/utils/banAppeals';

const welcomeFailCooldowns = new Map<string, number>();
const WELCOME_FAIL_COOLDOWN = 5 * 60 * 1000;

async function handleGlobalBan(
  member: GuildMember,
  guild: Guild,
  client: Client,
  ban: GlobalBanDocument,
): Promise<boolean> {
  try {
    try {
      const user = member.user || member;
      await user.send({
        embeds: [
          new EmbedBuilder()
            .setTitle(t('en', 'auditCatalog.events.guildMemberAdd.l24_setTitle'))
            .setDescription(
              `You have been banned from **${guild.name}** because your account is on the ${config.branding.publicName} global ban list.

**Reason:** ${ban.reason}${
                ban.evidence
                  ? `
**Evidence:** ${ban.evidence}`
                  : ''
              }`,
            )
            .setColor(0xe74c3c)
            .setFooter({ text: t('en', 'auditCatalog.events.guildMemberAdd.l31_setFooter') })
            .setTimestamp(new Date())
            .toJSON(),
        ],
      });
    } catch {}

    await guild.ban(member.id || member.user?.id, {
      reason: `[${config.branding.publicName} Global Ban] ${ban.reason}`,
    });

    await purgeWelcomeMessage(client, guild.id, member.id || member.user?.id);

    await logServerEvent(
      guild,
      t('en', 'auditCatalog.events.guildMemberAdd.l65_setTitle'),
      0xe74c3c,
      [
        { name: 'User', value: `<@${member.id}> (\`${member.id}\`)`, inline: true },
        { name: 'Reason', value: ban.reason, inline: false },
        ...(ban.evidence ? [{ name: 'Evidence', value: ban.evidence, inline: false }] : []),
      ],
      client,
      {
        description: `This user was automatically banned because they are on the ${config.branding.publicName} global ban list.`,
        footer: `Banned by ${config.branding.publicName} Global Protection • Disable with the globalban toggle command`,
        eventType: 'global_ban',
      },
    ).catch(() => {});

    const ownerId = guild.ownerId;
    if (ownerId) {
      try {
        const owner = client.users.get(ownerId) || (await client.users.fetch(ownerId).catch(() => null));
        if (owner) {
          await owner.send({
            embeds: [
              new EmbedBuilder()
                .setTitle(t('en', 'auditCatalog.events.guildMemberAdd.l65_setTitle'))
                .setDescription(
                  `A user was automatically banned from **${guild.name}** because they are on the ${config.branding.publicName} global ban list.

**User:** <@${member.id}> (\`${member.id}\`)
**Reason:** ${ban.reason}${
                    ban.evidence
                      ? `
**Evidence:** ${ban.evidence}`
                      : ''
                  }

You can disable this with \`globalban off\` in your server.`,
                )
                .setColor(0xe74c3c)
                .setTimestamp(new Date())
                .toJSON(),
            ],
          });
        }
      } catch {}
    }

    return true;
  } catch (err) {
    console.error(`[globalban] Failed to enforce ban for ${member.id} in ${guild.name}: ${messageFromError(err)}`);
    return false;
  }
}

const event: BotEvent = {
  name: 'guildMemberAdd',

  async execute(member: GuildMember, client: Client) {
    try {
      const guild = member.guild;
      if (!guild) return;

      if (member.user?.bot !== true) activityService.recordMemberJoin(guild.id);

      const settings = await settingsCache.get(guild.id);

      const userId = member.id || member.user?.id;

      const isBot = member.user?.bot === true;
      if (isBot && settings?.automod?.raid?.kickBots) {
        try {
          await guild.kick(userId);
          activityService.recordAutomodAction(guild.id);
          await logServerEvent(
            guild,
            'Bot Auto-Kicked',
            0xe67e22,
            [{ name: 'Bot', value: `<@${userId}> (\`${userId}\`)`, inline: false }],
            client,
            {
              description: 'A bot was automatically kicked (kickBots is enabled).',
              footer: `User ID: ${userId}`,
              eventType: 'bot_kick',
            },
          ).catch(() => {});
        } catch {}
        return;
      }

      const minAccountAgeDays = settings?.automod?.raid?.minAccountAgeDays ?? 0;
      if (userId && !isBot && minAccountAgeDays > 0) {
        const ageDays = getAccountAgeDays(userId);
        if (ageDays !== null && ageDays < minAccountAgeDays) {
          const ageAction = settings?.automod?.raid?.accountAgeAction ?? 'kick';
          let actionTaken = 'alerted';
          try {
            if (ageAction === 'ban') {
              await guild.ban(userId, {
                reason: `[${config.branding.publicName}] Account younger than minimum age (${Math.floor(ageDays)}d < ${minAccountAgeDays}d)`,
              });
              await purgeWelcomeMessage(client, guild.id, userId);
              await recordBanAppeal(client, {
                guildId: guild.id,
                userId,
                source: 'automod',
                banReason: `[${config.branding.publicName}] Account younger than minimum age (${Math.floor(ageDays)}d < ${minAccountAgeDays}d)`,
                moderatorId: 'automod',
                permanent: true,
                guildName: guild.name,
              }).catch(() => {});
              actionTaken = 'banned';
            } else if (ageAction === 'kick') {
              await guild.kick(userId);
              actionTaken = 'kicked';
            }
          } catch {}

          await logServerEvent(
            guild,
            'New Account Blocked',
            0xe67e22,
            [
              { name: 'User', value: `<@${userId}> (\`${userId}\`)`, inline: false },
              { name: 'Account Age', value: `${Math.floor(ageDays)} day(s)`, inline: true },
              { name: 'Minimum Required', value: `${minAccountAgeDays} day(s)`, inline: true },
              { name: 'Action', value: actionTaken, inline: true },
            ],
            client,
            {
              description: `A member's account is younger than the configured minimum age and was ${actionTaken}.`,
              footer: `${config.branding.publicName} Anti-Raid • Configure minAccountAgeDays in the dashboard under Automod`,
              eventType: 'account_age_gate',
            },
          ).catch(() => {});

          activityService.recordAutomodAction(guild.id);
          if (actionTaken !== 'alerted') return;
        }
      }

      if (userId) {
        const raid = recordJoin(guild.id, userId, settings);
        if (raid?.detected) {
          activityService.recordAutomodAction(guild.id);
          sendRaidAlert(client, guild, raid.joinCount, raid.userIds).catch(() => {});

          if (settings?.automod?.raid?.autoLockdownInvites) {
            lockInvitesForRaid(client, guild)
              .then((locked) => {
                if (locked) {
                  return logServerEvent(guild, 'Raid Invite Lockdown', 0xe74c3c, [], client, {
                    description:
                      'Server invites have been automatically disabled due to raid detection. They will be re-enabled automatically in 5 minutes.',
                    footer: `${config.branding.publicName} Anti-Raid • Configure autoLockdownInvites in the dashboard under Automod`,
                    eventType: 'raid_invite_lock',
                  });
                }
              })
              .catch(() => {});
          }

          const raidAction = settings?.automod?.raid?.action ?? 'alert';
          if (raidAction === 'kick' || raidAction === 'ban') {
            const actioned: string[] = [];
            for (const raidUserId of raid.userIds) {
              try {
                if (raidAction === 'ban') {
                  await guild.ban(raidUserId, {
                    reason: `[${config.branding.publicName}] Raid auto-ban (${raid.joinCount} joins detected)`,
                  });
                  await purgeWelcomeMessage(client, guild.id, raidUserId);
                  await recordBanAppeal(client, {
                    guildId: guild.id,
                    userId: raidUserId,
                    source: 'automod',
                    banReason: `[${config.branding.publicName}] Raid auto-ban (${raid.joinCount} joins detected)`,
                    moderatorId: 'automod',
                    permanent: true,
                    guildName: guild.name,
                  }).catch(() => {});
                } else {
                  await guild.kick(raidUserId);
                }
                actioned.push(raidUserId);
              } catch {}
            }
            if (actioned.length > 0) {
              logServerEvent(
                guild,
                raidAction === 'ban' ? 'Raid Auto-Ban' : 'Raid Auto-Kick',
                raidAction === 'ban' ? 0x8b0000 : 0xe67e22,
                [
                  { name: 'Action', value: raidAction === 'ban' ? 'Banned' : 'Kicked', inline: true },
                  { name: 'Users', value: `${actioned.length}`, inline: true },
                  {
                    name: 'User IDs',
                    value: `\`\`\`\n${actioned.join(', ').slice(0, 900)}\n\`\`\``,
                    inline: false,
                  },
                ],
                client,
                {
                  description: `Automatically ${raidAction === 'ban' ? 'banned' : 'kicked'} ${actioned.length} user(s) after raid detection.`,
                  footer: `${config.branding.publicName} Anti-Raid • Change action in dashboard under Automod`,
                  eventType: `raid_auto_${raidAction}`,
                },
              ).catch(() => {});
            }
          }
        }
      }

      const suspect = await assessMember(client, guild, member);
      if (suspect.score >= SUSPICIOUS_ALERT_THRESHOLD) {
        checkAndAlert(client, guild, member, suspect.score, suspect.reasons, suspect.accountAgeDays);
      }

      if (!settings) return;

      if (settings.globalBanEnabled === true) {
        try {
          const userId = member.id || member.user?.id;
          const ban = await GlobalBan.isGlobalBanned(userId);
          if (ban) {
            const declined = await GlobalBanPrompt.guildDeclinedBan(guild.id, userId);
            if (!declined) {
              const handled = await handleGlobalBan(member, guild, client, ban);
              if (handled) return;
            }
          }
        } catch (err) {
          console.error(`[globalban] Check failed for ${member.id}: ${messageFromError(err)}`);
        }
      }

      if (settings.autoroleId) {
        if (settings.raidDisableAutorole && isRaidActive(guild.id)) {
          console.log(`[autorole] Skipping autorole for ${member.id} in ${guild.name} - raid detected`);
        } else {
          const botMember = guild.members?.me;
          const targetRole = guild.roles?.get(settings.autoroleId);
          const botHighest = botMember
            ? Math.max(0, ...(botMember.roles?.roleIds ?? []).map((id: string) => guild.roles?.get(id)?.position || 0))
            : Infinity;

          if (targetRole && targetRole.position >= botHighest) {
            console.warn(`[autorole] Skipping ${guild.name}: bot role is below ${targetRole.name}`);
          } else {
            try {
              await member.roles.add(settings.autoroleId);
            } catch (err) {
              if (isNetworkError(err)) {
                autoroleQueue.enqueue(guild.id, member.id, settings.autoroleId);
              } else {
                console.error(
                  `[autorole] Failed to assign role ${settings.autoroleId} to ${member.id} in ${guild.name}: ${messageFromError(err)}`,
                );
              }
            }
          }
        }
      }

      const user = member.user;
      const createdAt = snowflakeToDate(user?.id);
      const createdEpoch = createdAt ? Math.floor(createdAt.getTime() / 1000) : null;

      if (memberCounter.get(guild.id) === null) {
        await memberCounter.fetchAndSetMemberCount(guild.id, client);
      }
      const memberCount = memberCounter.increment(guild.id);

      const joinFields: LogField[] = [];
      if (createdEpoch) {
        joinFields.push({ name: 'Account Age', value: `<t:${createdEpoch}:R>`, inline: true });
      }
      if (memberCount) {
        joinFields.push({ name: 'Members', value: memberCount.toLocaleString(), inline: true });
      }

      await logServerEvent(guild, 'Member Joined', 0x2ecc71, joinFields, client, {
        description: `<@${member.id}> joined the server`,
        footer: `User ID: ${member.id}`,
        eventType: 'member_join',
      }).catch(() => {});

      const wm = settings.welcomeMessage;
      if (!wm?.enabled || !wm.channelId) return;

      if (wm.trigger === 'role') return;

      const lastFail = welcomeFailCooldowns.get(guild.id);
      if (lastFail && Date.now() - lastFail < WELCOME_FAIL_COOLDOWN) return;

      let welcomeChannel: Channel | null;
      try {
        const channelsMap = guild.channels;
        welcomeChannel =
          channelsMap?.get(wm.channelId) ?? (await client.channels.fetch(wm.channelId).catch(() => null));
      } catch {
        welcomeChannel = null;
      }
      if (!welcomeChannel) return;

      if (!isTextChannel(welcomeChannel)) {
        welcomeFailCooldowns.set(guild.id, Date.now());
        return;
      }

      let roleName: string | null = null;
      if (wm.showRole && settings.autoroleId) {
        const role = guild.roles?.get?.(settings.autoroleId);
        roleName = role?.name || null;
      }

      const avatarURL = user.displayAvatarURL?.({ size: 256 }) ?? user.avatarURL ?? '/assets/default-avatar.png';

      const safeName = (name: string) => name.replace(/@(everyone|here)/gi, '@​$1');
      const memberDisplayName = safeName(member.displayName || user.username || 'Unknown');

      const sendOpts: MessageSendOptions = { allowedMentions: { parse: ['users'] } };
      let cardBuffer: Buffer | null = null;

      const replaceVars = (text: string) =>
        text
          .replace(/\\n/g, '\n')
          .replace(/\{user\}/gi, `<@${member.id}>`)
          .replace(/\{username\}/gi, memberDisplayName)
          .replace(/\{server\}/gi, guild.name)
          .replace(/\{count\}/gi, String(memberCount || 0))
          .replace(/\{role\}/gi, roleName || 'None');

      const replaceCardVars = (text: string) =>
        text
          .replace(/\\n/g, '\n')
          .replace(/\{user\}/gi, memberDisplayName)
          .replace(/\{username\}/gi, memberDisplayName)
          .replace(/\{server\}/gi, guild.name)
          .replace(/\{count\}/gi, String(memberCount || 0))
          .replace(/\{role\}/gi, roleName || 'None');

      if (wm.imageEnabled !== false) {
        try {
          const baseCard = (wm.card || ({} as IWelcomeCard)) as IWelcomeCard;
          const renderedCard: IWelcomeCard = {
            ...baseCard,
            greetingText: baseCard.greetingText ? replaceCardVars(baseCard.greetingText) : baseCard.greetingText,
            subtitle: baseCard.subtitle ? replaceCardVars(baseCard.subtitle) : baseCard.subtitle,
          };
          cardBuffer = await generateWelcomeCard({
            username: member.displayName || user.username || 'New Member',
            avatarURL,
            serverName: guild.name,
            memberCount: memberCount || 0,
            card: renderedCard,
            roleName,
          });
          sendOpts.files = [{ name: 'welcome.png', data: cardBuffer }];
        } catch (err) {
          console.error(`[welcome] Card generation failed for ${user.id} in ${guild.name}: ${messageFromError(err)}`);
        }
      }

      if (wm.message) {
        sendOpts.content = replaceVars(wm.message);
      } else if (!wm.embed?.enabled) {
        sendOpts.content = `Welcome to **${guild.name}**, <@${member.id}>!`;
      }

      if (wm.embed?.enabled) {
        const embConf = wm.embed;
        const embed = new EmbedBuilder();
        if (embConf.title) embed.setTitle(replaceVars(embConf.title));
        if (embConf.description) embed.setDescription(replaceVars(embConf.description));
        if (embConf.color) embed.setColor(parseInt(embConf.color.replace('#', ''), 16));
        if (embConf.footer) embed.setFooter({ text: replaceVars(embConf.footer) });
        if (embConf.thumbnail) {
          const iconURL = guild.iconURL?.({ size: 256 }) || null;
          if (iconURL) embed.setThumbnail(iconURL);
        }
        embed.setTimestamp(new Date());
        sendOpts.embeds = [embed];
      }

      if (sendOpts.content || sendOpts.files || sendOpts.embeds) {
        try {
          const sent = await retrySend(welcomeChannel, sendOpts, 'welcome');
          welcomeFailCooldowns.delete(guild.id);
          const messageId = sent?.id;
          if (messageId) {
            void recordWelcomeMessage(guild.id, member.id, welcomeChannel.id ?? wm.channelId, messageId);
          }
        } catch (err) {
          welcomeFailCooldowns.set(guild.id, Date.now());
          console.error(
            `[welcome] Failed to send welcome in ${guild.name}: ${messageFromError(err)} (suppressing for 5m)`,
          );
        }
      }

      if (wm.dm?.enabled) {
        try {
          const dmOpts: MessageSendOptions = {};

          if (wm.dm.message) {
            dmOpts.content = replaceVars(wm.dm.message);
          } else if (wm.message) {
            dmOpts.content = replaceVars(wm.message);
          } else {
            dmOpts.content = `Welcome to **${guild.name}**!`;
          }

          if (wm.dm.imageEnabled && cardBuffer) {
            dmOpts.files = [{ name: 'welcome.png', data: cardBuffer }];
          }

          await sendMessage(member.user, dmOpts).catch(() => {});
        } catch (err) {
          console.error(`[welcome] Failed to send DM to ${member.id}: ${messageFromError(err)}`);
        }
      }
    } catch (error) {
      console.error('Error in guildMemberAdd event:', error);
    }
  },
};

export default event;
