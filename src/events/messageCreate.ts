// i lwk want to remove this entire thing but people want it instead of tickets for some reason 🥀

import type { BotClient, BotEvent, IGuildSettings } from '@/types';
import { Channel, Client, EmbedBuilder, Message } from '@fluxerjs/core';
import automod from '@/automod';
import ghostPing from '@/automod/modules/ghostPing';
import honeypot from '@/automod/modules/honeypot';
import { handleStickyOnMessage } from '@/utils/stickyMessage';
import settingsCache from '@/utils/settingsCache';
import * as messageCache from '@/utils/messageCache';
import { formatMessageLogContent } from '@/utils/messageLogContent';
import Ticket from '@/models/Ticket';
import config from '@/config';
import { requestDMProcess } from '@/utils/dmCoordinator';
import { isBlocked, isGuildBlocked, shouldSendTerminationNotice, terminationNotice } from '@/utils/serviceBlockCache';
import { t, normalizeLocale } from '@/i18n';
import { isTextChannel } from '@/utils/isTextChannel';
import { isGuildChannel } from '@/utils/isGuildChannel';
import { isArray } from '@/utils/isArray';
import * as roleQueue from '@/utils/roleQueue';
import isNetworkError from '../utils/isNetworkError';
import { isPermDenied } from '../utils/permError';
import { messageFromError } from '@/utils/messageFromError';
import activityService from '@/services/ActivityService';
import { checkAndAlert, observeMessage, scoreMember, SUSPICIOUS_ALERT_THRESHOLD } from '@/utils/suspiciousDetector';

async function handleInboxMessage(message: Message, client: Client, settings: IGuildSettings): Promise<void> {
  message.delete().catch(() => {});

  const content = message.content?.trim();
  if (!content) return;
  const lang = normalizeLocale(settings?.language);

  if (!settings.staffChannelId) {
    console.warn(
      `[${message.guild?.name ?? message.guildId}] Report inbox received a message but no staff output channel is configured.`,
    );
    return;
  }

  const author = message.author;
  const embed = new EmbedBuilder()
    .setTitle(t(lang, 'commands.report.embedTitle'))
    .setColor(0xed4245)
    .setDescription(content)
    .addFields(
      { name: t(lang, 'commands.report.fieldReporter'), value: `${author.username} (<@${author.id}>)`, inline: true },
      { name: t(lang, 'auditCatalog.events.messageCreate.l33_addFields_name'), value: author.id, inline: true },
      {
        name: t(lang, 'auditCatalog.events.messageCreate.l34_addFields_name'),
        value: t(lang, 'auditCatalog.events.messageCreate.l34_addFields_value'),
        inline: true,
      },
    )
    .setThumbnail(author.displayAvatarURL?.() ?? author.avatarURL ?? null)
    .setFooter({ text: t(lang, 'auditCatalog.events.messageCreate.l37_setFooterReport') })
    .setTimestamp(new Date());

  const guild = message.guild;
  let staffChannel: Channel | null;
  try {
    staffChannel = guild?.channels?.get(settings.staffChannelId) ?? null;
    if (!staffChannel) {
      staffChannel = await client.channels.fetch(settings.staffChannelId).catch(() => null);
    }
  } catch {
    staffChannel = null;
  }

  if (!staffChannel) {
    console.warn(
      `[${guild?.name ?? message.guildId}] Staff output channel ${settings.staffChannelId} not found when forwarding inbox report.`,
    );
    return;
  }

  if (!isTextChannel(staffChannel)) {
    console.warn(
      `[${guild?.name ?? message.guildId}] Staff output channel ${settings.staffChannelId} found but of type ${staffChannel.type}.`,
    );
    return;
  }

  const rolePing = settings.staffRoleId ? `<@&${settings.staffRoleId}>` : null;
  try {
    await staffChannel.send({
      content: rolePing ?? undefined,
      embeds: [embed],
    });
    const reportGuildId = message.guildId || message.guild?.id;
    if (reportGuildId) activityService.recordReport(reportGuildId);
  } catch (err: unknown) {
    console.error(`[${guild?.name ?? message.guildId}] Failed to forward inbox report: ${messageFromError(err)}`);
  }
}

async function handleMention(message: Message, client: BotClient): Promise<void> {
  const guildId = message.guildId || message.guild?.id;

  let prefix = config.prefix;
  let lang = 'en';
  if (guildId) {
    try {
      const settings = await settingsCache.get(guildId);
      if (settings?.prefixes?.length && '0' in settings.prefixes) prefix = settings.prefixes[0];
      lang = normalizeLocale(settings?.language);
    } catch {}
  }

  const categories = client.commandHandler?.getCommandsByCategory() ?? {};

  const embed = new EmbedBuilder()
    .setTitle(t(lang, 'auditCatalog.events.messageCreate.l79_setTitle'))
    .setDescription(
      `My prefix in this server is **\`${prefix}\`**\n` +
        `Use \`${prefix}help\` to see all commands, or \`${prefix}help <command>\` for details on a specific one.\n\n` +
        (config.branding.docsUrl ? `**📖 [Full Documentation](${config.branding.docsUrl})**` : ''),
    )
    .setColor(0x6c72f8)
    .setTimestamp(new Date())
    .setFooter({
      text: t(lang, 'auditCatalog.events.messageCreate.l87_setFooter', {
        version: config.appVersion,
      }),
    });

  for (const [category, commands] of Object.entries(categories)) {
    if (category === 'owner') continue;
    const visible = commands.filter((c) => !c.hidden);
    if (!visible.length) continue;
    const label = category.charAt(0).toUpperCase() + category.slice(1);
    embed.addFields({
      name: label,
      value: visible.map((c) => `\`${c.name}\``).join('  '),
      inline: false,
    });
  }

  await message.reply({ embeds: [embed] }).catch(() => {
    message.reply(t(lang, 'auditCatalog.events.messageCreate.l103_reply', { prefix })).catch(() => {});
  });
}

const event: BotEvent = {
  name: 'messageCreate',

  async execute(message: Message, client: BotClient) {
    const guildId = message.guildId || message.guild?.id;

    if (guildId && message.id) {
      const logContent = formatMessageLogContent(message);
      if (logContent) {
        messageCache.store(message.id, logContent);
        if (!message.author?.bot && message.content) ghostPing.storeMessage(message);
      }
    }

    if (message.author?.bot) return;

    if (guildId && message.author?.id) {
      activityService.recordMessage(guildId, message.author.id, message.channelId || message.channel?.id);
    }

    if (!guildId) {
      const granted = await requestDMProcess(message.id);
      if (!granted) return;
    }

    // service termination (ToS section 7): terminated guilds/users get no side
    // effects (automod, tickets, leveling, mention help). they still get a
    // refusal when they actually engage the bot, handled here for mentions and
    // in the command handler for prefix commands. owner always bypasses.
    const authorId = message.author?.id;
    if (authorId && authorId !== config.ownerId && (await isBlocked({ guildId, userId: authorId }))) {
      const trimmed = message.content?.trim() ?? '';
      const mentioned =
        !!client.user &&
        [`<@${client.user.id}>`, `<@!${client.user.id}>`].some((m) => trimmed === m || trimmed.startsWith(m + ' '));

      if (mentioned) {
        if (shouldSendTerminationNotice(guildId, authorId)) {
          const kind = (await isGuildBlocked(guildId)) ? 'guild' : 'user';
          await message.reply(terminationNotice(kind)).catch(() => {});
        }
        return;
      }

      // let the command handler issue the refusal for prefix commands, but skip
      // every guild side effect above
      if (client.commandHandler) await client.commandHandler.handleMessage(message);
      return;
    }

    if (message.content && client.user) {
      const mentionPatterns = [`<@${client.user.id}>`, `<@!${client.user.id}>`];
      const trimmed = message.content.trim();
      if (mentionPatterns.some((m: string) => trimmed === m || trimmed.startsWith(m + ' '))) {
        await handleMention(message, client);
        return;
      }
    }

    if (guildId) {
      let settings: IGuildSettings | null = null;
      try {
        settings = await settingsCache.get(guildId);
      } catch (err: unknown) {
        console.error(`Failed to fetch settings for guild ${guildId} in messageCreate event: ${messageFromError(err)}`);
      }

      const channelId = message.channelId || message.channel?.id;

      if (channelId) {
        try {
          const { verificationSessions, hashVerificationCode, persistVerificationSession, removeVerificationSession } =
            await import('../commands/admin/verify');
          const session = verificationSessions.get(channelId);

          if (session && message.author.id === session.userId && message.content) {
            const answer = message.content.trim().toUpperCase();
            const lang = normalizeLocale(settings?.language);

            if (hashVerificationCode(answer) === session.codeHash) {
              let verifiedRoleAdded = false;

              const verification = settings?.verification;
              if (verification?.verifiedRoleId) {
                try {
                  const guild = message.guild || (message.guildId ? await client.guilds.fetch(message.guildId) : null);
                  if (guild) {
                    let member = guild.members?.get(message.author.id);
                    if (!member) {
                      try {
                        member = await guild.fetchMember(message.author.id);
                      } catch {}
                    }
                    if (member) {
                      try {
                        await member.roles.add(verification.verifiedRoleId);
                        verifiedRoleAdded = true;
                        console.log(`[verification] Granted verified role to ${message.author.id} in ${guild.name}`);
                      } catch (roleErr: unknown) {
                        if (isNetworkError(roleErr)) {
                          roleQueue.enqueue(guild.id, message.author.id, verification.verifiedRoleId, 'add');
                          console.log(`[verification] Queued verified role for ${message.author.id} (network error)`);
                        } else if (isPermDenied(roleErr)) {
                          // bot lacks ManageRoles or sits below the verified role; guild misconfig
                          console.warn(`[verification] Missing permissions to add verified role in ${guild.name}`);
                        } else {
                          console.error(`[verification] Failed to add verified role: ${messageFromError(roleErr)}`);
                        }
                      }

                      const autoroleId = settings?.autoroleId;
                      if (autoroleId && autoroleId !== verification.verifiedRoleId) {
                        const { isRaidActive } = await import('../utils/raidDetector');
                        const raidBlocked = settings?.raidDisableAutorole && isRaidActive(guild.id);
                        if (!raidBlocked) {
                          try {
                            await member.roles.add(autoroleId);
                          } catch (arErr: unknown) {
                            if (isNetworkError(arErr)) {
                              roleQueue.enqueue(guild.id, message.author.id, autoroleId, 'add');
                            }
                          }
                        }
                      }
                    }
                  }
                } catch (err: unknown) {
                  if (isPermDenied(err)) {
                    console.warn(
                      `[verification] Missing permissions to add verified role in ${message.guild?.name ?? message.guildId}`,
                    );
                  } else {
                    console.error(`[verification] Failed to add verified role: ${messageFromError(err)}`);
                  }
                }
              }

              if (!verifiedRoleAdded) {
                try {
                  const failedEmbed = new EmbedBuilder()
                    .setTitle(t(lang, 'verification.result.roleFailedTitle'))
                    .setDescription(t(lang, 'verification.result.roleFailedDescription'))
                    .setColor(0xe74c3c);
                  await message.reply({ embeds: [failedEmbed] });
                } catch {}
                return;
              }

              await removeVerificationSession(channelId);

              try {
                const successEmbed = new EmbedBuilder()
                  .setTitle(t(lang, 'verification.result.passedTitle'))
                  .setDescription(t(lang, 'verification.result.passedDescription'))
                  .setColor(0x2ecc71);
                await message.reply({ embeds: [successEmbed] });
              } catch {}

              if (verification?.logChannelId) {
                try {
                  const guild = message.guild || (message.guildId ? await client.guilds.fetch(message.guildId) : null);
                  if (guild) {
                    const logChannel =
                      guild.channels?.get(verification.logChannelId) ||
                      (await client.channels.fetch(verification.logChannelId).catch(() => null));
                    if (logChannel && isTextChannel(logChannel)) {
                      const logEmbed = new EmbedBuilder()
                        .setTitle(t(lang, 'verification.log.passedTitle'))
                        .setDescription(t(lang, 'verification.log.passedDescription', { userId: message.author.id }))
                        .setColor(0x2ecc71)
                        .setTimestamp(new Date());
                      await logChannel.send({ embeds: [logEmbed] });
                    }
                  }
                } catch {}
              }

              setTimeout(async () => {
                try {
                  const ch =
                    message.guild?.channels?.get(channelId) ||
                    (await client.channels.fetch(channelId).catch(() => null));
                  if (ch && isGuildChannel(ch)) await ch.delete();
                } catch {}
              }, 3000);

              return;
            } else {
              session.attempts++;
              await persistVerificationSession(session);

              if (session.attempts >= session.maxAttempts) {
                await removeVerificationSession(channelId);

                try {
                  const failEmbed = new EmbedBuilder()
                    .setTitle(t(lang, 'verification.result.failedTitle'))
                    .setDescription(t(lang, 'verification.result.failedDescription'))
                    .setColor(0xe74c3c);
                  await message.reply({ embeds: [failEmbed] });
                } catch {}

                const verification = settings?.verification;
                if (verification?.logChannelId) {
                  try {
                    const guild =
                      message.guild || (message.guildId ? await client.guilds.fetch(message.guildId) : null);
                    if (guild) {
                      const logChannel =
                        guild.channels?.get(verification.logChannelId) ||
                        (await client.channels.fetch(verification.logChannelId).catch(() => null));
                      if (logChannel && isTextChannel(logChannel)) {
                        const logEmbed = new EmbedBuilder()
                          .setTitle(t(lang, 'verification.log.failedTitle'))
                          .setDescription(t(lang, 'verification.log.failedDescription', { userId: message.author.id }))
                          .setColor(0xe74c3c)
                          .setTimestamp(new Date());
                        await logChannel.send({ embeds: [logEmbed] });
                      }
                    }
                  } catch {}
                }

                if (session.panelChannelId && session.panelMessageId) {
                  try {
                    const { Routes } = await import('@fluxerjs/types');
                    await client.rest.delete(
                      `${Routes.channelMessageReaction(session.panelChannelId, session.panelMessageId, '✅')}/${message.author.id}`,
                    );
                  } catch {}
                }

                setTimeout(async () => {
                  try {
                    const ch =
                      message.guild?.channels?.get(channelId) ||
                      (await client.channels.fetch(channelId).catch(() => null));
                    if (ch && isGuildChannel(ch)) await ch.delete();
                  } catch {}
                }, 3000);

                return;
              } else {
                const remaining = session.maxAttempts - session.attempts;
                try {
                  const retryEmbed = new EmbedBuilder()
                    .setTitle(t(lang, 'verification.result.incorrectTitle'))
                    .setDescription(t(lang, 'verification.result.incorrectDescription', { remaining }))
                    .setColor(0xf39c12);
                  await message.reply({ embeds: [retryEmbed] });
                } catch {}
                return;
              }
            }
          }
        } catch {}
      }

      const messageSuspicion = observeMessage(guildId, message.author.id, {
        content: message.content,
        hasAttachment: (message.attachments?.size ?? 0) > 0,
      });
      if (messageSuspicion.score >= 20) {
        const guild = message.guild || client.guilds?.get(guildId);
        if (guild) {
          let member = guild.members?.get(message.author.id) ?? null;
          if (!member) member = await guild.fetchMember(message.author.id).catch(() => null);
          if (member) {
            const memberSuspicion = scoreMember(member);
            const totalScore = memberSuspicion.score + messageSuspicion.score;
            if (totalScore >= SUSPICIOUS_ALERT_THRESHOLD) {
              checkAndAlert(
                client,
                guild,
                member,
                totalScore,
                [...memberSuspicion.reasons, ...messageSuspicion.reasons],
                memberSuspicion.accountAgeDays,
              );
            }
          }
        }
      }

      if (channelId && (message.content || message.attachments?.size)) {
        Ticket.findOneAndUpdate(
          { channelId, status: 'open' },
          {
            $push: {
              transcript: {
                authorId: message.author.id,
                authorName: message.author.username || message.author.id,
                avatarURL: message.author.avatarURL?.() || message.author.avatar || null,
                content: message.content,
                attachments: message.attachments?.values?.()
                  ? [...message.attachments.values()].map((a) => ({
                      url: a.url,
                      name: a.filename || a.title || 'file',
                    }))
                  : [],
                timestamp: new Date(),
              },
            },
          },
        ).catch(() => {});
      }

      if (settings?.staffInboxChannelId && channelId === settings.staffInboxChannelId) {
        await handleInboxMessage(message, client, settings);
        return;
      }

      const honeypotTriggered = await honeypot.check(message, client, settings);
      if (honeypotTriggered) {
        activityService.recordAutomodAction(guildId);
        return;
      }

      await handleStickyOnMessage(message, client, settings);

      const violationDetected = await automod.check(message, client);
      if (violationDetected) {
        activityService.recordAutomodAction(guildId);
        return;
      }

      if (settings?.activityRole?.enabled && settings.activityRole.roleId) {
        const { increment: actIncrement } = await import('../utils/activityTracker');
        const guild = message.guild || (message.guildId ? client.guilds?.get(message.guildId) : null);
        if (guild) {
          const count = actIncrement(guild.id, message.author.id);
          if (count === settings.activityRole.messageThreshold) {
            try {
              let member = guild.members?.get(message.author.id) ?? null;
              if (!member) member = await guild.fetchMember(message.author.id).catch(() => null);
              if (member && !member.roles?.roleIds?.includes(settings.activityRole.roleId)) {
                await member.roles.add(settings.activityRole.roleId);
              }
            } catch {}
          }
        }
      }

      if (settings?.leveling?.enabled) {
        try {
          const { trackMessageXp, getLevelingConfig } = await import('../utils/leveling');
          const { handleLevelUp } = await import('../utils/leveling/levelUpHandler');
          const leveling = getLevelingConfig(settings);
          const guild = message.guild || client.guilds?.get(guildId);
          const member = guild?.members?.get(message.author.id);
          const roleIds: readonly string[] = member?.roles?.roleIds ?? [];
          const chType = message.channel?.type;
          const isVoiceTextChannel = chType === 2;

          const content = message.content?.trim() ?? '';
          const prefixes = settings.prefixes?.length ? settings.prefixes : [config.prefix];
          const isCommand = prefixes.some((prefix: string) => content.startsWith(prefix));
          const wordCount = content ? content.split(/\s+/).filter(Boolean).length : 0;
          const attachments = message.attachments;
          const stickers = message.stickers;
          const hasAttachments = isArray(attachments) ? attachments.length > 0 : attachments?.size > 0;
          const hasStickers = stickers.length > 0;

          const result = await trackMessageXp(settings, guildId, message.author.id, {
            channelId,
            memberRoleIds: roleIds,
            wordCount,
            isVoiceTextChannel,
            content,
            isCommand,
            hasAttachments,
            hasStickers,
          });

          if (result?.leveledUp && guild) {
            await handleLevelUp(client, guild, message.author.id, result, leveling, channelId ?? null);
          }
        } catch (err: unknown) {
          console.error(`[leveling] Failed to track xp in ${guildId}: ${messageFromError(err)}`);
        }
      }
    }

    if (client.commandHandler) {
      await client.commandHandler.handleMessage(message);
    }
  },
};

export default event;
