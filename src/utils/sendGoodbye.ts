import { EmbedBuilder } from '@fluxerjs/core';
import type { Client, Guild, GuildMember, MessageSendOptions, PartialGuildMember } from '@fluxerjs/core';
import * as memberCounter from './memberCounter';
import { resolveGuildChannel, sendWithPermRefresh } from './channelSend';
import isNetworkError from './isNetworkError';
import { retrySend } from './retrySend';
import { IGuildSettings } from '@/types';
import { messageFromError } from './messageFromError';

export default async function sendGoodbye(
  member: GuildMember | PartialGuildMember,
  guild: Guild,
  settings: IGuildSettings,
  client: Client,
): Promise<void> {
  const gm = settings.goodbyeMessage;
  if (!gm?.enabled || !gm.channelId) return;

  const goodbyeChannel = await resolveGuildChannel(guild, gm.channelId, client);
  if (!goodbyeChannel) return;

  const user = member.user;
  const memberCount = memberCounter.get(guild.id) ?? 0;

  const safeName = (name: string) => name.replace(/@(everyone|here)/gi, '@​$1');

  const replaceVars = (text: string) =>
    text
      .replace(/\\n/g, '\n')
      .replace(/\{user\}/gi, `<@${member.id}>`)
      .replace(/\{username\}/gi, safeName(user?.username || 'Unknown'))
      .replace(/\{server\}/gi, guild.name)
      .replace(/\{count\}/gi, String(memberCount || 0));

  const sendOpts: MessageSendOptions = {};

  if (gm.message) {
    sendOpts.content = replaceVars(gm.message);
  } else if (!gm.embed?.enabled) {
    sendOpts.content = `**${safeName(user?.username || 'Someone')}** has left **${guild.name}**.`;
  }

  if (gm.embed?.enabled) {
    const embConf = gm.embed;
    const embed = new EmbedBuilder();
    if (embConf.title) embed.setTitle(replaceVars(embConf.title));
    if (embConf.description) embed.setDescription(replaceVars(embConf.description));
    if (embConf.color) embed.setColor(parseInt(embConf.color.replace('#', ''), 16));
    if (embConf.footer) embed.setFooter({ text: replaceVars(embConf.footer) });
    embed.setTimestamp(new Date());
    sendOpts.embeds = [embed];
  }

  sendOpts.allowedMentions = { parse: ['users'] };

  if (sendOpts.content || sendOpts.embeds) {
    try {
      await sendWithPermRefresh(guild, gm.channelId, goodbyeChannel, sendOpts, client);
    } catch (err: unknown) {
      if (isNetworkError(err)) {
        try {
          await retrySend(goodbyeChannel, sendOpts, 'goodbye');
          return;
        } catch (retryErr: unknown) {
          console.error(`[goodbye] Failed to send goodbye in ${guild.name}: ${messageFromError(retryErr)}`);
          return;
        }
      }
      console.error(`[goodbye] Failed to send goodbye in ${guild.name}: ${messageFromError(err)}`);
    }
  }
}
