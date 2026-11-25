import type { Channel, Client, Guild } from '@fluxerjs/core';
import { Routes } from '@fluxerjs/types';
import type { APIChannel, APIRole } from '@fluxerjs/types';
import { isArray } from './isArray';

/** Human labels from docs.fluxer.app GuildFeatureSchema x-enumDescriptions */
const FEATURE_DESCRIPTIONS: Record<string, string> = {
  ANIMATED_ICON: 'Animated icon',
  ANIMATED_BANNER: 'Animated banner',
  BANNER: 'Banner',
  DETACHED_BANNER: 'Detached banner',
  INVITE_SPLASH: 'Invite splash',
  INVITES_DISABLED: 'Invites disabled',
  TEXT_CHANNEL_FLEXIBLE_NAMES: 'Flexible text channel names',
  MORE_EMOJI: 'Increased emoji slots',
  MORE_STICKERS: 'Increased sticker slots',
  UNLIMITED_EMOJI: 'Unlimited emoji slots',
  UNLIMITED_STICKERS: 'Unlimited sticker slots',
  EXPRESSION_PURGE_ALLOWED: 'Expression purge allowed',
  VANITY_URL: 'Vanity URL',
  VERIFIED: 'Verified',
  VIP_VOICE: 'VIP voice features',
  DISCOVERABLE: 'Discoverable',
  UNAVAILABLE_FOR_EVERYONE: 'Unavailable for everyone',
  UNAVAILABLE_FOR_EVERYONE_BUT_STAFF: 'Unavailable except for staff',
  VISIONARY: 'Visionary guild',
  OPERATOR: 'Operator guild',
  LARGE_GUILD_OVERRIDE: 'Large guild overrides',
  VERY_LARGE_GUILD: 'Increased member capacity',
  MT_MESSAGE_SCHEDULING: 'Message scheduling',
  MT_EXPRESSION_PACKS: 'Expression packs',
};

function titleCaseFeature(feature: string): string {
  return feature
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function normalizeGuildFeatures(features: unknown): string[] {
  if (!features) return [];

  if (typeof features === 'string') {
    return features
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
  }

  if (isArray(features)) {
    return features
      .flatMap((item) => {
        if (typeof item !== 'string') return [];
        if (item.includes(',')) {
          return item.split(',').map((part) => part.trim());
        }
        return [item.trim()];
      })
      .filter(Boolean);
  }

  return [];
}

export function formatGuildFeatures(features: unknown, noneLabel: string): string {
  const list = normalizeGuildFeatures(features);
  if (!list.length) return noneLabel;

  return list.map((feature) => FEATURE_DESCRIPTIONS[feature] ?? titleCaseFeature(feature)).join(', ');
}

function countChannelTypes(channels: readonly (Channel | APIChannel)[]): {
  textChannels: number;
  voiceChannels: number;
  categories: number;
} {
  let textChannels = 0;
  let voiceChannels = 0;
  let categories = 0;

  for (const channel of channels) {
    const type = channel?.type;
    if (type === 0) textChannels++;
    else if (type === 2) voiceChannels++;
    else if (type === 4) categories++;
  }

  return { textChannels, voiceChannels, categories };
}

export async function resolveGuildChannelCounts(
  guild: Guild,
  client: Client,
): Promise<{ textChannels: number; voiceChannels: number; categories: number }> {
  let channels: readonly (Channel | APIChannel)[] = [];

  if (guild.channels?.size > 0) {
    channels = [...guild.channels.values()];
  } else if (typeof guild.fetchChannels === 'function') {
    try {
      channels = await guild.fetchChannels();
    } catch {}
  }

  if (channels.length === 0) {
    try {
      const raw = (await client.rest.get(Routes.guildChannels(guild.id))) as APIChannel[] | Record<string, APIChannel>;
      channels = isArray(raw) ? raw : Object.values(raw ?? {});
    } catch {}
  }

  return countChannelTypes(channels);
}

export async function resolveGuildRoleCount(guild: Guild, client: Client): Promise<number> {
  if (guild.roles?.size > 0) return guild.roles.size;

  if (typeof guild.fetchRoles === 'function') {
    try {
      const roles = await guild.fetchRoles();
      if (roles.length > 0) return roles.length;
    } catch {}
  }

  try {
    const raw = (await client.rest.get(Routes.guildRoles(guild.id))) as APIRole[] | Record<string, APIRole>;
    const list = isArray(raw) ? raw : Object.values(raw ?? {});
    return list.length;
  } catch {
    return 0;
  }
}
