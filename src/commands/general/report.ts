import { type Channel, EmbedBuilder, type Message } from '@fluxerjs/core';
import type { Command, IGuildSettings } from '@/types';
import settingsCache from '@/utils/settingsCache';
import isNetworkError from '@/utils/isNetworkError';
import { t, normalizeLocale } from '@/i18n';
import { isGuildTextChannel } from '@/utils/isGuildTextChannel';
import { messageFromError } from '@/utils/messageFromError';
import activityService from '@/services/ActivityService';

async function tempReply(message: Message, text: string, ms = 7000): Promise<void> {
  const reply = await message.reply(text).catch(() => null);
  setTimeout(() => {
    message.delete().catch(() => {});
    reply?.delete?.().catch(() => {});
  }, ms);
}

const command: Command = {
  name: 'report',
  description: [
    'Privately alert the staff team about an issue. Your message is deleted immediately \u2014 other members will not know you reported anything.',
    '',
    '**How it works:**',
    '`!report <your message>` \u2014 your message is deleted on the spot and only staff can see it in their private channel.',
    '',
    '**Tip for server staff:** There is also a dedicated report inbox channel available (`!setstaff reportchannel`). Members can type there directly without using any command \u2014 the bot deletes every message instantly and forwards it to staff.',
    'To keep the inbox fully private, set **Read Message History** to off for `@everyone` in that channel \u2014 members will only ever see an empty channel when they open it.',
  ].join('\n'),
  usage: '<your message>',
  category: 'general',
  cooldown: 300,

  async execute(message, args, client, prefix = '!') {
    let guild = message.guild;
    if (!guild && message.guildId) guild = await client.guilds.fetch(message.guildId);
    if (!guild) return void (await message.reply(t('en', 'commands.generic.serverOnly')));

    const settingsForLang = await settingsCache.get(guild.id).catch(() => null);
    const lang = normalizeLocale(settingsForLang?.language);

    const reportContent = args.join(' ').trim();

    if (!reportContent) {
      return void (await tempReply(message, t(lang, 'commands.report.missingMessage', { prefix })));
    }

    if (reportContent.length > 1000) {
      return void (await tempReply(message, t(lang, 'commands.report.tooLong')));
    }

    // is not awaited, can fail with no consequence
    message.delete().catch(() => {});

    let settings: IGuildSettings | null = null;
    try {
      settings = await settingsCache.get(guild.id);
    } catch (err) {
      if (isNetworkError(err)) {
        console.warn(`[${guild.name}] Fluxer API unreachable during !report (ECONNRESET)`);
      } else {
        console.error(`[${guild.name}] Error loading settings in !report: ${messageFromError(err)}`);
      }
      message.author.send(t(lang, 'commands.report.submitFailedDm')).catch(() => {});
      return;
    }

    if (!settings?.staffChannelId) {
      message.author.send(t(lang, 'commands.report.notConfiguredDm')).catch(() => {});
      return;
    }

    const author = message.author;
    const embed = new EmbedBuilder()
      .setTitle(t(lang, 'commands.report.embedTitle'))
      .setColor(0xed4245)
      .setDescription(reportContent)
      .addFields(
        {
          name: t(lang, 'commands.report.fieldReporter'),
          value: `${author.username} (<@${author.id}>)\n\`${author.id}\``,
          inline: true,
        },
        {
          name: t(lang, 'terminology.fluxer.channel'),
          value: `<#${message.channelId || message.channel?.id}>`,
          inline: true,
        },
      )
      .setThumbnail(author.displayAvatarURL?.() ?? author.avatarURL ?? null);

    let staffChannel: Channel | null = null;
    try {
      const channelsMap = guild.channels;
      staffChannel =
        channelsMap?.get(settings.staffChannelId) ??
        (await client.channels.fetch(settings.staffChannelId).catch(() => null));
    } catch {
      staffChannel = null;
    }

    if (!staffChannel) {
      console.warn(`[${guild.name}] Staff channel ${settings.staffChannelId} not found during !report`);
      author.send(t(lang, 'commands.report.channelUnavailableDm', { guildName: guild.name })).catch(() => {});
      return;
    }

    if (!isGuildTextChannel(staffChannel)) {
      console.warn(
        `[${guild.name}] Staff channel ${settings.staffChannelId} found during !report but was not guild text channel`,
      );
      // sends same DM as if the channel was not configured
      author.send(t(lang, 'commands.report.channelUnavailableDm', { guildName: guild.name })).catch(() => {});
      return;
    }

    try {
      const rolePing = settings.staffRoleId ? `<@&${settings.staffRoleId}>` : null;
      await staffChannel.send({
        content: rolePing ?? undefined,
        embeds: [embed],
      });
      activityService.recordReport(guild.id);

      author.send(t(lang, 'commands.report.deliveredDm', { guildName: guild.name })).catch(() => {});
    } catch (err) {
      console.error(`[${guild.name}] Failed to send report to staff channel: ${messageFromError(err)}`);
      author.send(t(lang, 'commands.report.permissionsErrorDm', { guildName: guild.name })).catch(() => {});
    }
  },
};

export default command;
