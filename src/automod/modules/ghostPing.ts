import type { Channel, Client, Message, User } from '@fluxerjs/core';
import isNetworkError from '@/utils/isNetworkError';
import * as embedQueue from '@/utils/embedQueue';
import { t, normalizeLocale } from '@/i18n';
import type { IGuildSettings } from '@/types';
import { isTextChannel } from '@/utils/isTextChannel';

interface CachedMessageData {
  content: string;
  author: User;
  authorId: string;
  userMentions: string[];
  roleMentions: string[];
  channelId: string;
  guildId: string | null;
  timestamp?: number;
}

const recentMessages = new Map<string, CachedMessageData>();

const mentionRegex = /<@!?(\d{17,19})>/g;
const roleMentionRegex = /<@&(\d{17,19})>/g;
const everyoneRegex = /@everyone/gi;
const hereRegex = /@here/gi;

function ghostPingT(locale: unknown, key: string, vars?: Record<string, string | number>): string {
  return t(normalizeLocale(locale), `auditCatalog.automod.modules.ghostPing.${key}`, vars);
}

function extractUserMentions(content: string): string[] {
  const mentions: string[] = [];
  let match: RegExpExecArray | null = null;

  while ((match = mentionRegex.exec(content)) !== null) {
    if ('1' in match && !mentions.includes(match[1])) {
      mentions.push(match[1]);
    }
  }

  if (everyoneRegex.test(content)) {
    mentions.push('everyone');
  }
  if (hereRegex.test(content)) {
    mentions.push('here');
  }

  return mentions;
}

function extractRoleMentions(content: string): string[] {
  const mentions: string[] = [];
  let match: RegExpExecArray | null = null;

  while ((match = roleMentionRegex.exec(content)) !== null) {
    if ('1' in match && !mentions.includes(match[1])) {
      mentions.push(match[1]);
    }
  }

  return mentions;
}

function storeMessage(message: Message): void {
  if (!message.content || message.author?.bot) return;

  const userMentions = extractUserMentions(message.content);
  const roleMentions = extractRoleMentions(message.content);

  if (userMentions.length === 0 && roleMentions.length === 0) return;

  const messageData: CachedMessageData = {
    content: message.content,
    author: message.author,
    authorId: message.author.id,
    userMentions,
    roleMentions,
    channelId: message.channelId,
    guildId: message.guildId ?? message.guild?.id ?? null,
    timestamp: Date.now(),
  };

  recentMessages.set(message.id, messageData);

  setTimeout(() => {
    recentMessages.delete(message.id);
  }, 30000);
}

function getCachedMessage(messageId: string) {
  return recentMessages.get(messageId) || null;
}

function clearCachedMessage(messageId: string): void {
  recentMessages.delete(messageId);
}

const ghostPing = {
  name: 'ghostPing',
  description: 'Detects deleted messages that contained mentions',

  async check(message: Message, client: Client, settings: IGuildSettings): Promise<boolean> {
    if (!message.content || message.author?.bot || (!message.guild && !message.guildId)) {
      return false;
    }

    const ghostPingEnabled = settings?.automod?.ghostPing ?? settings?.antiGhostPing ?? false;
    if (!ghostPingEnabled) return false;

    let cachedData = getCachedMessage(message.id);

    if (!cachedData) {
      const userMentions = extractUserMentions(message.content);
      const roleMentions = extractRoleMentions(message.content);

      if (userMentions.length === 0 && roleMentions.length === 0) {
        return false;
      }

      cachedData = {
        content: message.content,
        author: message.author,
        authorId: message.author?.id,
        userMentions,
        roleMentions,
        channelId: message.channelId,
        guildId: message.guildId,
        timestamp: Date.now(),
      };
    }

    if (cachedData.userMentions.length === 0 && cachedData.roleMentions.length === 0) {
      return false;
    }

    await this.execute(message, client, settings, cachedData);
    return true;
  },

  async execute(
    message: Message,
    client: Client,
    settings: IGuildSettings,
    cachedData: CachedMessageData,
  ): Promise<void> {
    try {
      const userMentionList = cachedData.userMentions
        .map((id: string) => {
          if (id === 'everyone') return '@everyone';
          if (id === 'here') return '@here';
          return `<@${id}>`;
        })
        .join(', ');

      const roleMentionList = cachedData.roleMentions.map((id: string) => `<@&${id}>`).join(', ');

      const allMentions = [userMentionList, roleMentionList].filter(Boolean).join(', ');

      let channel: Channel | null = message.channel;
      if (!channel && message.channelId) {
        const guild = message.guild;
        const channels = guild?.channels;
        channel = channels?.get?.(message.channelId) ?? null;
        if (!channel) {
          channel = await client.channels.fetch(message.channelId).catch(() => null);
        }
      }

      let alertMsg: Message | null = null;
      if (channel && isTextChannel(channel)) {
        alertMsg = await channel
          .send({
            content: ghostPingT(settings?.language, 'alertMessage', {
              authorId: cachedData.authorId,
              mentions: allMentions,
            }),
          })
          .catch(() => null);
      }

      if (alertMsg) {
        setTimeout(() => alertMsg.delete().catch(() => {}), 30000);
      }

      if (settings && settings.logChannelId) {
        await this.logAction(message, client, settings, cachedData, allMentions);
      }

      clearCachedMessage(message.id);
    } catch (error) {
      console.error('Error in ghost ping detection:', error);
    }
  },

  async logAction(
    message: Message,
    client: Client,
    settings: IGuildSettings,
    cachedData: CachedMessageData,
    allMentions: string,
  ): Promise<void> {
    try {
      const guildId = cachedData.guildId || message.guildId;
      if (!guildId) return;
      const guild = message.guild || (await client.guilds.fetch(guildId));
      if (!guild) return;

      const logChannel = settings.logChannelId && guild.channels?.get(settings.logChannelId);
      if (!logChannel || !isTextChannel(logChannel)) return;

      const embed = {
        title: ghostPingT(settings?.language, 'logTitle'),
        description: ghostPingT(settings?.language, 'logDescription'),
        fields: [
          { name: ghostPingT(settings?.language, 'fieldSender'), value: `<@${cachedData.authorId}>`, inline: true },
          {
            name: t(settings?.language, 'terminology.fluxer.channel'),
            value: `<#${cachedData.channelId}>`,
            inline: true,
          },
          { name: ghostPingT(settings?.language, 'fieldMentioned'), value: allMentions },
          {
            name: ghostPingT(settings?.language, 'fieldMessageContent'),
            value: cachedData.content.substring(0, 1000) || ghostPingT(settings?.language, 'noContent'),
          },
        ],
        color: 0x9b59b6, // Purple
        timestamp: new Date().toISOString(),
      };
      try {
        await logChannel.send({ embeds: [embed] });
      } catch (sendErr: unknown) {
        if (isNetworkError(sendErr)) {
          if (settings.logChannelId) embedQueue.enqueue(guildId, settings.logChannelId, embed);
        }
      }
    } catch (error) {
      console.error('Error logging ghost ping:', error);
    }
  },

  storeMessage,
  getCachedMessage,
  clearCachedMessage,
  extractUserMentions,
  extractRoleMentions,
};

export default ghostPing;
