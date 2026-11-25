import { EmbedBuilder } from '@fluxerjs/core';
import type { Channel, Client, GuildMember, MessageSendOptions } from '@fluxerjs/core';
import type { BotEvent, IGuildSettings, IWelcomeCard, IWelcomeMessage } from '@/types';
import { LogField, logServerEvent } from '@/utils/logger';
import settingsCache from '@/utils/settingsCache';
import * as memberCounter from '@/utils/memberCounter';
import { generateWelcomeCard } from '@/utils/welcomeCard';
import { recordWelcomeMessage } from '@/utils/welcomeMessageStore';
import { isTextChannel } from '@/utils/isTextChannel';
import { messageFromError } from '@/utils/messageFromError';
import WelcomeMessageRecord from '@/models/WelcomeMessageRecord';
import { sendMessage } from '@/utils/sendMessage';

function resolveWelcomeTriggerRoleId(settings: IGuildSettings, welcomeMessage: IWelcomeMessage): string | null {
  return welcomeMessage?.triggerRoleId ?? settings?.verification?.verifiedRoleId ?? settings?.autoroleId ?? null;
}

const event: BotEvent = {
  name: 'guildMemberUpdate',

  async execute(oldMember: GuildMember, newMember: GuildMember, client: Client) {
    try {
      // fluxer.js v2 hands us a null oldMember when the previous state wasn't
      // cached, and we can't diff roles without it, so bail quietly
      if (!oldMember?.roles || !newMember?.roles) return;

      const guild = newMember.guild;
      if (!guild) return;

      const oldRoles = oldMember.roles.roleIds;
      const newRoles = newMember.roles.roleIds;

      const added = newRoles.filter((r: string) => !oldRoles.includes(r));
      const removed = oldRoles.filter((r: string) => !newRoles.includes(r));

      if (added.length === 0 && removed.length === 0) return;

      const fields: LogField[] = [];

      if (added.length > 0) {
        fields.push({
          name: 'Roles Added',
          value: added.map((id: string) => `<@&${id}>`).join(', '),
          inline: false,
        });
      }

      if (removed.length > 0) {
        fields.push({
          name: 'Roles Removed',
          value: removed.map((id: string) => `<@&${id}>`).join(', '),
          inline: false,
        });
      }

      const color =
        added.length > 0 && removed.length === 0
          ? 0x2ecc71
          : removed.length > 0 && added.length === 0
            ? 0xe74c3c
            : 0xf1c40f;

      await logServerEvent(guild, 'Member Roles Updated', color, fields, client, {
        description: `<@${newMember.id}>'s roles were updated`,
        footer: `User ID: ${newMember.id}`,
        eventType: 'member_role_update',
      });

      if (added.length > 0) {
        try {
          const settings = await settingsCache.get(guild.id);
          if (!settings) return;

          const wm = settings.welcomeMessage;
          if (!wm?.enabled || !wm.channelId || wm.trigger !== 'role') return;

          const triggerRoleId = resolveWelcomeTriggerRoleId(settings, wm);
          if (!triggerRoleId || !added.includes(triggerRoleId)) return;

          const existing = await WelcomeMessageRecord.findOne({ guildId: guild.id, userId: newMember.id }).lean();
          if (existing) return;

          let welcomeChannel: Channel | null = null;
          try {
            welcomeChannel =
              guild.channels.get(wm.channelId) ?? (await client.channels.fetch(wm.channelId).catch(() => null));
          } catch {
            welcomeChannel = null;
          }
          if (!welcomeChannel || !isTextChannel(welcomeChannel)) return;

          const user = newMember.user;
          if (memberCounter.get(guild.id) === null) {
            await memberCounter.fetchAndSetMemberCount(guild.id, client);
          }
          const memberCount = memberCounter.get(guild.id) ?? 0;

          let roleName: string | null = null;
          if (wm.showRole) {
            const rid = resolveWelcomeTriggerRoleId(settings, wm);
            if (rid) {
              const role = guild.roles?.get?.(rid);
              roleName = role?.name || null;
            }
          }

          const avatarURL = user?.displayAvatarURL?.({ size: 256 }) ?? user?.avatarURL ?? '/assets/default-avatar.png';

          const safeName = (name: string) => name.replace(/@(everyone|here)/gi, '@​$1');
          const memberDisplayName = safeName(newMember.displayName || user?.username || 'Unknown');

          const sendOpts: MessageSendOptions = { allowedMentions: { parse: ['users'] } };
          let cardBuffer: Buffer | null = null;

          const replaceVars = (text: string) =>
            text
              .replace(/\\n/g, '\n')
              .replace(/\{user\}/gi, `<@${newMember.id}>`)
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
                username: newMember.displayName || user?.username || 'New Member',
                avatarURL,
                serverName: guild.name,
                memberCount: memberCount || 0,
                card: renderedCard,
                roleName,
              });
              sendOpts.files = [{ name: 'welcome.png', data: cardBuffer }];
            } catch (err: unknown) {
              console.error(
                `[welcome] Card generation failed for ${newMember.id} in ${guild.name}: ${messageFromError(err)}`,
              );
            }
          }

          if (wm.message) {
            sendOpts.content = replaceVars(wm.message);
          } else {
            sendOpts.content = `Welcome to **${guild.name}**, <@${newMember.id}>!`;
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
            const sent = await sendMessage(welcomeChannel, sendOpts).catch((err: unknown) => {
              console.error(
                `[welcome] Failed to send role-triggered welcome in ${guild.name}: ${messageFromError(err)}`,
              );
              return null;
            });
            const messageId = sent?.id;
            if (messageId) {
              void recordWelcomeMessage(guild.id, newMember.id, welcomeChannel.id ?? wm.channelId, messageId);
            }
          }
        } catch (err: unknown) {
          console.error(`[guildMemberUpdate] welcome-on-role error: ${messageFromError(err)}`);
        }
      }
    } catch (error) {
      console.error('Error in guildMemberUpdate event:', error);
    }
  },
};

export default event;
