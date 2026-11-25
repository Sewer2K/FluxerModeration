import { PermissionFlags } from '@fluxerjs/core';
import type { Channel, Client, Guild, MessageReaction } from '@fluxerjs/core';
import { Routes } from '@fluxerjs/types';
import type { RESTPostAPIEmbed, APIEmbedField } from '@fluxerjs/types';
import isNetworkError from '@/utils/isNetworkError';
import * as moderationQueue from '@/utils/moderationQueue';
import * as embedQueue from '@/utils/embedQueue';
import { t, normalizeLocale } from '@/i18n';
import type {
  AutomodReactionSpamViolation as Violation,
  AutomodAntiReactionSpamConfig as Config,
  IAntiReactionSpamAction as IAction,
  IGuildSettings,
  IAntiReactionSpamAutomodModule,
} from '@/types';
import { isTextChannel } from '@/utils/isTextChannel';
import { messageFromError } from '@/utils/messageFromError';

const reactionTracker = new Map<string, { timestamps: number[] }>();
const violationTracker = new Map<string, { violations: number[] }>();
const processingLocks = new Set<string>();

const defaultConfig: Config = {
  maxReactions: 5,
  timeWindow: 5000,
  timeoutDuration: 600000,
  violationThreshold: 3,
  violationWindow: 1800000,
};

function antiReactionSpamT(locale: unknown, key: string, vars?: Record<string, string | number>): string {
  return t(normalizeLocale(locale), `auditCatalog.automod.modules.antiReactionSpam.${key}`, vars);
}

function checkReactionSpam(guildId: string, userId: string, maxReactions: number, windowMs: number) {
  const key = `${guildId}-${userId}`;
  const now = Date.now();

  let data = reactionTracker.get(key);
  if (!data) {
    data = { timestamps: [] };
    reactionTracker.set(key, data);
  }

  data.timestamps = data.timestamps.filter((t) => now - t < windowMs);
  data.timestamps.push(now);

  const isSpam = data.timestamps.length >= maxReactions;

  if (isSpam) {
    data.timestamps.length = 0;
  }

  if (reactionTracker.size > 1000) cleanupTrackers(windowMs);

  return { isSpam, count: data.timestamps.length };
}

function trackViolation(guildId: string, userId: string, config: Config): Violation {
  const key = `${guildId}-${userId}`;
  const now = Date.now();
  const window = config.violationWindow || defaultConfig.violationWindow;

  let data = violationTracker.get(key);
  if (!data) {
    data = { violations: [] };
    violationTracker.set(key, data);
  }

  data.violations = data.violations.filter((v) => now - v < window);
  data.violations.push(now);

  return {
    count: data.violations.length,
    shouldTimeout: data.violations.length >= config.violationThreshold,
  };
}

function clearViolations(guildId: string, userId: string): void {
  violationTracker.delete(`${guildId}-${userId}`);
}

function resetTracker(guildId: string, userId: string): void {
  reactionTracker.delete(`${guildId}-${userId}`);
}

function cleanupTrackers(windowMs: number): void {
  const now = Date.now();
  for (const [key, data] of reactionTracker) {
    data.timestamps = data.timestamps.filter((t) => now - t < windowMs);
    if (data.timestamps.length === 0) reactionTracker.delete(key);
  }
  for (const [key, data] of violationTracker) {
    data.violations = data.violations.filter((v) => now - v < defaultConfig.violationWindow);
    if (data.violations.length === 0) violationTracker.delete(key);
  }
}

function formatDuration(ms: number): string {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} minute${mins !== 1 ? 's' : ''}`;
  const hrs = Math.round(mins / 60);
  return `${hrs} hour${hrs !== 1 ? 's' : ''}`;
}

async function applyTimeout(guild: Guild, userId: string, duration: number, locale: unknown): Promise<boolean> {
  try {
    let member = guild.members?.get(userId);
    if (!member) member = await guild.fetchMember(userId);
    if (!member) return false;
    if (member.permissions?.has?.(PermissionFlags.Administrator)) return false;

    const until = new Date(Date.now() + duration).toISOString();
    const reason = antiReactionSpamT(locale, 'timeoutReason');
    await member.edit({
      communicationDisabledUntil: until,
      timeoutReason: reason,
    });
    return true;
  } catch (error: unknown) {
    if (isNetworkError(error)) {
      moderationQueue.enqueue(guild.id, userId, 'timeout', {
        durationMs: duration,
        reason: antiReactionSpamT(locale, 'timeoutReason'),
      });
      return true;
    }
    if (
      error &&
      typeof error === 'object' &&
      (('statusCode' in error && error.statusCode === 404) || ('code' in error && error.code === 'MEMBER_NOT_FOUND'))
    )
      return false;
    console.error('[antiReactionSpam] Timeout error:', messageFromError(error));
    return false;
  }
}

const antiReactionSpam: IAntiReactionSpamAutomodModule = {
  name: 'antiReactionSpam',
  description: 'Detects and prevents reaction spam by tracking reaction frequency',

  async check(
    guild: Guild,
    userId: string,
    reaction: MessageReaction,
    client: Client,
    settings: IGuildSettings,
  ): Promise<boolean> {
    const guildId = guild.id;
    const config = {
      maxReactions: defaultConfig.maxReactions,
      timeWindow: defaultConfig.timeWindow,
      timeoutDuration: defaultConfig.timeoutDuration,
      violationThreshold: defaultConfig.violationThreshold,
      violationWindow: defaultConfig.violationWindow,
    };

    const result = checkReactionSpam(guildId, userId, config.maxReactions, config.timeWindow);
    if (!result.isSpam) return false;

    const lockKey = `${guildId}-${userId}`;
    if (processingLocks.has(lockKey)) return true;
    processingLocks.add(lockKey);

    try {
      try {
        const emojiParam = reaction.emoji.id ? `${reaction.emoji.name}:${reaction.emoji.id}` : reaction.emoji.name;
        await client.rest.delete(
          `${Routes.channelMessageReaction(reaction.channelId, reaction.messageId, emojiParam)}/${userId}`,
        );
      } catch {}

      const violation = trackViolation(guildId, userId, config);

      let timedOut = false;
      if (violation.shouldTimeout) {
        timedOut = await applyTimeout(guild, userId, config.timeoutDuration, settings?.language);
        if (timedOut) clearViolations(guildId, userId);
      }

      try {
        let channel: Channel | null = guild.channels?.get(reaction.channelId) ?? null;
        if (!channel) {
          channel = await client.channels.fetch(reaction.channelId).catch(() => null);
        }
        if (channel && isTextChannel(channel)) {
          let content: string;
          if (timedOut) {
            content = antiReactionSpamT(settings?.language, 'noticeTimedOut', {
              userId,
              duration: formatDuration(config.timeoutDuration),
            });
          } else if (violation.count >= config.violationThreshold - 1) {
            content = antiReactionSpamT(settings?.language, 'noticeFinalWarning', {
              userId,
              duration: formatDuration(config.timeoutDuration),
            });
          } else {
            content = antiReactionSpamT(settings?.language, 'noticeViolation', {
              userId,
              count: violation.count,
              threshold: config.violationThreshold,
            });
          }

          const sent = await channel.send({ content }).catch(() => null);
          if (sent) {
            const deleteAfter = timedOut ? 8000 : 4000;
            setTimeout(() => sent.delete().catch(() => {}), deleteAfter);
          }
        }
      } catch {}

      const logChannelId = settings.moderation?.logChannelId || settings.logChannelId;
      if (logChannelId) {
        this.logAction(guild, userId, reaction, client, logChannelId, {
          violation,
          config,
          timedOut,
          language: settings?.language,
        }).catch(() => {});
      }
    } finally {
      processingLocks.delete(lockKey);
    }

    return true;
  },

  async logAction(
    guild: Guild,
    userId: string,
    reaction: MessageReaction,
    client: Client,
    logChannelId: string,
    info: IAction,
  ): Promise<void> {
    try {
      let logChannel: Channel | null = guild.channels?.get(logChannelId) ?? null;
      if (!logChannel) {
        try {
          logChannel = await client.channels.fetch(logChannelId);
        } catch {
          return;
        }
      }
      if (!logChannel || !isTextChannel(logChannel)) return;

      const fields: APIEmbedField[] = [
        { name: t(info.language, 'terminology.fluxer.user'), value: `<@${userId}> (${userId})`, inline: true },
        { name: t(info.language, 'terminology.fluxer.channel'), value: `<#${reaction.channelId}>`, inline: true },
        {
          name: antiReactionSpamT(info.language, 'fieldViolations'),
          value: `${info.violation.count}/${info.config.violationThreshold}`,
          inline: true,
        },
      ];

      if (info.timedOut) {
        fields.push({
          name: antiReactionSpamT(info.language, 'fieldAction'),
          value: antiReactionSpamT(info.language, 'actionTimedOutFor', {
            duration: formatDuration(info.config.timeoutDuration),
          }),
          inline: true,
        });
      }

      const embed: RESTPostAPIEmbed = {
        title: info.timedOut
          ? antiReactionSpamT(info.language, 'logTitleTimedOut')
          : antiReactionSpamT(info.language, 'logTitleDetected'),
        description: info.timedOut
          ? antiReactionSpamT(info.language, 'logDescriptionTimedOut')
          : antiReactionSpamT(info.language, 'logDescriptionDetected'),
        fields,
        color: info.timedOut ? 0xf1c40f : 0xe74c3c,
        timestamp: new Date().toISOString(),
      };

      try {
        await logChannel.send({ embeds: [embed] });
      } catch (sendErr: unknown) {
        if (isNetworkError(sendErr)) {
          embedQueue.enqueue(guild.id, logChannelId, embed);
        }
      }
    } catch (error) {
      console.error('[antiReactionSpam] Log error:', error);
    }
  },

  checkReactionSpam,
  resetTracker,
  trackViolation,
  clearViolations,
  defaultConfig,
};

export default antiReactionSpam;
