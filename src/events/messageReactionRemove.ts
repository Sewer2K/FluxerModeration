import { EmbedBuilder } from '@fluxerjs/core';
import type { Client, MessageReactionPayload } from '@fluxerjs/core';
import { Routes } from '@fluxerjs/types';
import type { APIMessage } from '@fluxerjs/types';
import type { BotEvent } from '@/types';
import settingsCache from '@/utils/settingsCache';
import { logServerEvent } from '@/utils/logger';
import isNetworkError from '@/utils/isNetworkError';
import * as roleQueue from '@/utils/roleQueue';
import StarboardMessage from '@/models/StarboardMessage';
import { getActiveStarboards, getStarEmoji, getStarColor } from '@/utils/starboardBoards';
import { isReactionOnBotMessage } from '@/utils/reactionLogFilter';
import { resolveReactionGuildId } from '@/utils/reactionGuild';
import { reactionRoleEmojiMatches } from '@/utils/reactionRoleEmoji';
import { t } from '@/i18n';
import { messageFromError } from '@/utils/messageFromError';
import { messageJumpUrl } from '@/utils/messageLogLinks';
import { fluxerAvatarAssetUrl } from '@/utils/fluxerUrls';
import { hasAnyPermission } from '@/utils/permissions';

const event: BotEvent = {
  name: 'messageReactionRemove',

  async execute(payload: MessageReactionPayload, client: Client) {
    const { reaction, user } = payload;
    try {
      if (user.bot || user.id === client.user?.id) return;

      const guildId = await resolveReactionGuildId(client, reaction);
      if (!guildId) return;

      const guild = client.guilds.get(guildId);
      if (!guild) return;

      const settings = await settingsCache.get(guild.id);
      if (!settings) return;

      const targetMessageIsBotAuthored = await isReactionOnBotMessage(client, reaction);
      if (!targetMessageIsBotAuthored) {
        const emojiDisplay = reaction.emoji.id ? `<:${reaction.emoji.name}:${reaction.emoji.id}>` : reaction.emoji.name;

        await logServerEvent(
          guild,
          'Reaction Removed',
          0x95a5a6,
          [
            { name: 'User', value: `<@${user.id}>`, inline: true },
            { name: 'Emoji', value: emojiDisplay, inline: true },
            { name: 'Channel', value: `<#${reaction.channelId}>`, inline: true },
          ],
          client,
          {
            description: `[Jump to message](${messageJumpUrl(guildId, reaction.channelId, reaction.messageId)})`,
            footer: `Message ID: ${reaction.messageId}`,
            eventType: 'reaction_remove',
          },
        ).catch(() => {});
      }

      const starboards = getActiveStarboards(settings);
      if (starboards.length > 0) {
        const starEmojiRaw = reaction.emoji.id
          ? `${reaction.emoji.name}:${reaction.emoji.id}`
          : String(reaction.emoji.name ?? '');
        const stripVS = (s: string) => s.replace(/[\uFE00-\uFE0F\u200D]/g, '').trim();

        for (const board of starboards) {
          const configEmoji = board.emoji ?? '⭐';
          const emojiMatches = reaction.emoji.id
            ? starEmojiRaw === configEmoji ||
              `<:${starEmojiRaw}>` === configEmoji ||
              `<a:${starEmojiRaw}>` === configEmoji
            : stripVS(starEmojiRaw) === stripVS(configEmoji);

          if (!emojiMatches) continue;

          try {
            const entry = await StarboardMessage.findOne({
              guildId: guild.id,
              messageId: reaction.messageId,
              starboardChannelId: { $in: [board.channelId, null] },
            });

            if (entry) {
              entry.reactors = entry.reactors.filter((id: string) => id !== user.id);
              entry.starCount = entry.reactors.length;
              if (!entry.starboardChannelId && board.channelId) entry.starboardChannelId = board.channelId;
              await entry.save();

              const threshold = board.threshold ?? 3;
              if (entry.starCount < threshold) {
                if (entry.starboardMessageId && board.channelId) {
                  try {
                    await client.rest.delete(Routes.channelMessage(board.channelId, entry.starboardMessageId));
                  } catch {}
                  entry.starboardMessageId = null;
                  await entry.save();
                }
              } else if (entry.starboardMessageId && board.channelId) {
                try {
                  const origMsg = (await client.rest.get(
                    Routes.channelMessage(reaction.channelId, reaction.messageId),
                  )) as APIMessage;
                  if (origMsg) {
                    const content =
                      origMsg.content?.length > 1024
                        ? origMsg.content.substring(0, 1021) + '...'
                        : origMsg.content || '';

                    const starEmoji = getStarEmoji(entry.starCount);
                    const starColor = getStarColor(entry.starCount);

                    const starEmbed = new EmbedBuilder()
                      .setAuthor({
                        name: origMsg.author?.username ?? t('en', 'commands.userinfo.unknown'),
                        iconURL: origMsg.author?.avatar
                          ? fluxerAvatarAssetUrl(origMsg.author.id, origMsg.author.avatar)
                          : undefined,
                      })
                      .setColor(starColor)
                      .setTimestamp(new Date(origMsg.timestamp ?? Date.now()));

                    if (content) starEmbed.setDescription(content);

                    starEmbed.addFields(
                      {
                        name: t('en', 'auditCatalog.events.messageReactionRemove.l113_addFields_name'),
                        value: `[${t('en', 'commands.generic.jumpToMessageHyperlink')}](${messageJumpUrl(guild.id, reaction.channelId, reaction.messageId)})`,
                        inline: true,
                      },
                      {
                        name: t('en', 'terminology.fluxer.channel'),
                        value: `<#${reaction.channelId}>`,
                        inline: true,
                      },
                    );
                    starEmbed.setFooter({
                      text: t('en', 'auditCatalog.events.messageReactionRemove.l116_setFooter', {
                        'reaction.messageId': reaction.messageId,
                      }),
                    });

                    if (origMsg.attachments?.length) {
                      const img = origMsg.attachments.find((a) => a.content_type?.startsWith('image/'));
                      if (img?.url) starEmbed.setImage(img.url);
                    }

                    await client.rest.patch(Routes.channelMessage(board.channelId, entry.starboardMessageId), {
                      body: {
                        content: `${starEmoji} **${entry.starCount}** | <#${reaction.channelId}>`,
                        embeds: [starEmbed.toJSON()],
                      },
                    });
                  }
                } catch {}
              }
            }
          } catch (sbErr: unknown) {
            console.error(`[starboard] Error processing reaction remove in ${guild.name}: ${messageFromError(sbErr)}`);
          }
        }
      }

      const reactionRoles = settings.reactionRoles;
      if (!reactionRoles || reactionRoles.length === 0) return;

      const reactionConfig = reactionRoles.find(
        (rr) => rr.messageId === reaction.messageId && rr.channelId === reaction.channelId,
      );
      if (!reactionConfig) return;

      const roleMapping = reactionConfig.roles.find((r) => reactionRoleEmojiMatches(r.emoji, reaction.emoji));
      if (!roleMapping) return;

      let member = guild.members?.get(user.id);
      if (!member) {
        try {
          member = await guild.fetchMember(user.id);
        } catch (error: unknown) {
          if (
            error &&
            typeof error === 'object' &&
            (('code' in error && error.code === 'MEMBER_NOT_FOUND') ||
              ('cause' in error &&
                error.cause &&
                typeof error.cause === 'object' &&
                'code' in error.cause &&
                error.cause.code === 'UNKNOWN_MEMBER'))
          )
            return;
          console.error('Failed to fetch member:', error);
          return;
        }
      }
      if (!member) return;

      let botMember = guild.members?.me;
      if (!botMember && client.user?.id) {
        botMember = guild.members?.get(client.user.id) ?? (await guild.fetchMember(client.user.id).catch(() => null));
      }
      if (!botMember || !hasAnyPermission(botMember, ['ManageRoles', 'Administrator'])) {
        console.warn(`[rr] Skipping role remove in ${guild.name}: bot is missing Manage Roles`);
        return;
      }

      const role = guild.roles?.get(roleMapping.roleId);

      let roleChangesSucceeded = true;

      try {
        if (roleMapping.removeRoleId) {
          try {
            await member.roles.add(roleMapping.removeRoleId);
          } catch (err: unknown) {
            roleChangesSucceeded = false;
            if (isNetworkError(err)) {
              roleQueue.enqueue(guild.id, user.id, roleMapping.removeRoleId, 'add');
            } else {
              console.error(`Failed to re-add switched role: ${messageFromError(err)}`);
            }
          }
        }

        const rolesToRemove: string[] = roleMapping.roleIds?.length ? roleMapping.roleIds : [roleMapping.roleId];
        for (const rid of rolesToRemove) {
          try {
            await member.roles.remove(rid);
          } catch (error: unknown) {
            roleChangesSucceeded = false;
            if (isNetworkError(error)) {
              roleQueue.enqueue(guild.id, user.id, rid, 'remove');
            } else {
              console.error(`Failed to remove reaction role ${rid}: ${messageFromError(error)}`);
            }
          }
        }
      } catch (error: unknown) {
        roleChangesSucceeded = false;
        if (isNetworkError(error)) {
          roleQueue.enqueue(guild.id, user.id, roleMapping.roleId, 'remove');
        } else {
          console.error(`Failed to remove reaction role: ${messageFromError(error)}`);
        }
        return;
      }

      if (roleChangesSucceeded && settings.reactionRoleDMEnabled) {
        const roleName = role ? role.name : roleMapping.roleId;
        let dmMsg = `The **${roleName}** role has been removed in **${guild.name}**.`;
        if (roleMapping.removeRoleId) {
          const restoredRole = guild.roles?.get(roleMapping.removeRoleId);
          const restoredName = restoredRole?.name || roleMapping.removeRoleId;
          dmMsg = `Your role has been switched back from **${roleName}** to **${restoredName}** in **${guild.name}**.`;
        }
        user.send(dmMsg).catch(() => {});
      }
    } catch (error) {
      console.error('Error in messageReactionRemove event:', error);
    }
  },
};

export default event;
