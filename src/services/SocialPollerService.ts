import type { Channel, Client } from '@fluxerjs/core';
import GuildSettings from '@/models/GuildSettings';
import SocialState from '@/models/SocialState';
import log from '@/utils/consoleLogger';
import config from '@/config';
import { fluxerWebBaseUrl } from '@/utils/fluxerUrls';
import { messageFromError } from '@/utils/messageFromError';
import type { ISocialNotification } from '@/types';
import { isTextChannel } from '@/utils/isTextChannel';

const YOUTUBE_FEED = (channelId: string) => `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
const TIKTOK_FEED = (username: string) => `https://rsshub.app/tiktok/user/${username}`;

const DEFAULT_POLL_INTERVAL_MS = 10 * 60 * 1000;

interface FeedItem {
  id: string;
  title: string;
  link: string;
}

async function fetchFeedItems(url: string): Promise<FeedItem[]> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': `${config.branding.socialsUserAgentName}/1.0 (+${fluxerWebBaseUrl()})` },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return [];
    const text = await res.text();

    const items: FeedItem[] = [];
    const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
    let m: RegExpExecArray | null;
    while ((m = entryRe.exec(text)) !== null && '1' in m) {
      const block = m[1];
      const idMatch = /<yt:videoId>(.*?)<\/yt:videoId>/.exec(block) || /<id>(.*?)<\/id>/.exec(block);
      const titleMatch = /<title>(.*?)<\/title>/.exec(block);
      const linkMatch = /<link[^>]+href="([^"]+)"/.exec(block) || /<link>(.*?)<\/link>/.exec(block);

      if (idMatch && titleMatch && '1' in idMatch && '1' in titleMatch) {
        items.push({
          id: idMatch[1].trim(),
          title: titleMatch[1].trim(),
          link: linkMatch?.[1]?.trim() ?? '',
        });
      }
    }

    if (items.length === 0) {
      const itemRe = /<item>([\s\S]*?)<\/item>/g;
      while ((m = itemRe.exec(text)) !== null && '1' in m) {
        const block = m[1];
        const idMatch = /<guid[^>]*>(.*?)<\/guid>/.exec(block);
        const titleMatch = /<title>(.*?)<\/title>/.exec(block);
        const linkMatch = /<link>(.*?)<\/link>/.exec(block);
        if (idMatch && titleMatch && '1' in idMatch && '1' in titleMatch) {
          items.push({
            id: idMatch[1].trim(),
            title: titleMatch[1].trim(),
            link: linkMatch?.[1]?.trim() ?? '',
          });
        }
      }
    }

    return items;
  } catch {
    return [];
  }
}

class SocialPollerService {
  private client: Client | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  start(client: Client): void {
    if (this.timer) return;
    this.client = client;
    this.timer = setInterval(() => this.poll(), DEFAULT_POLL_INTERVAL_MS);
    setTimeout(() => this.poll(), 30000);
    log.ok('Social', 'Poller started');
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async poll(): Promise<void> {
    if (!this.client) return;
    const client = this.client;

    try {
      const allSettings = await GuildSettings.find({ 'socialNotifications.0': { $exists: true } }).lean();

      for (const settings of allSettings) {
        const guildId = settings.guildId;
        const notifications = settings.socialNotifications ?? [];

        for (const notif of notifications) {
          if (!notif.enabled) continue;
          try {
            await this.processNotification(client, guildId, notif);
          } catch (err: unknown) {
            console.error(
              `[social] Error processing ${notif.platform}/${notif.channelOrUsername} in ${guildId}: ${messageFromError(err)}`,
            );
          }
        }
      }
    } catch (err: unknown) {
      log.warn('Social', `Poll error: ${messageFromError(err)}`);
    }
  }

  private async processNotification(client: Client, guildId: string, notif: ISocialNotification): Promise<void> {
    const feedUrl =
      notif.platform === 'youtube' ? YOUTUBE_FEED(notif.channelOrUsername) : TIKTOK_FEED(notif.channelOrUsername);

    const stateKey = `${notif.platform}:${notif.channelOrUsername}`;
    const items = await fetchFeedItems(feedUrl);
    if (!items.length || !('0' in items)) return;

    const state = await SocialState.findOne({ guildId, key: stateKey });
    const lastSeenId = state?.lastSeenId ?? null;

    const newest = items[0];

    if (lastSeenId === null) {
      await SocialState.findOneAndUpdate(
        { guildId, key: stateKey },
        { $set: { lastSeenId: newest.id } },
        { upsert: true, new: true },
      );
      return;
    }

    if (newest.id === lastSeenId) return;

    const unseen: FeedItem[] = [];
    for (const item of items) {
      if (item.id === lastSeenId) break;
      unseen.push(item);
    }

    if (!unseen.length) return;

    let channel: Channel | null = client.channels?.get(notif.postChannelId) ?? null;
    if (!channel) {
      channel = await client.channels.fetch(notif.postChannelId).catch(() => null);
    }
    if (!channel || !isTextChannel(channel)) return;

    for (const item of unseen.reverse()) {
      const text = notif.message
        ? notif.message.replace(/\{title\}/gi, item.title).replace(/\{url\}/gi, item.link)
        : `${item.title}\n${item.link}`;
      await channel.send({ content: text }).catch(() => {});
    }

    await SocialState.findOneAndUpdate(
      { guildId, key: stateKey },
      {
        $set: {
          lastSeenId:
            // `unseen` is length-checked above
            unseen[unseen.length - 1]!.id,
        },
      },
      { upsert: true, new: true },
    );
  }
}

const socialPollerService = new SocialPollerService();
export default socialPollerService;
