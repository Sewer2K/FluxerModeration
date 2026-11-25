import { EmbedBuilder } from '@fluxerjs/core';
import type { Client, Guild } from '@fluxerjs/core';
import { Routes } from '@fluxerjs/types';
import type { APIGuild } from '@fluxerjs/types';
import config from '@/config';
import GuildSettings from '@/models/GuildSettings';
import { logServerEvent } from './logger';
import { sendUserDm } from './sendUserDm';
import { t } from '@/i18n';
import type { IGuildSettings } from '@/types';
import { messageFromError } from './messageFromError';
import settingsCache from './settingsCache';

const DEFAULT_JOIN_THRESHOLD = 10;
const DEFAULT_TIME_WINDOW_MS = 15_000;
const ALERT_COOLDOWN = 5 * 60_000;
const RAID_ACTIVE_DURATION = 5 * 60_000;
const MAX_TIMER_DELAY = 2_147_483_647;
const RAID_INVITE_RETRY_DELAY = 60_000;

const joinTimestamps = new Map<string, { times: number[]; userIds: string[] }>();
const lastAlert = new Map<string, number>();
const activeRaids = new Map<string, number>();

export function isRaidActive(guildId: string): boolean {
  const ts = activeRaids.get(guildId);
  if (!ts) return false;
  if (Date.now() - ts > RAID_ACTIVE_DURATION) {
    activeRaids.delete(guildId);
    return false;
  }
  return true;
}

export function recordJoin(
  guildId: string,
  userId: string,
  settings?: IGuildSettings | null,
): {
  detected: boolean;
  joinCount: number;
  userIds: string[];
} | null {
  const now = Date.now();

  const raidConfig = settings?.automod?.raid;
  const joinThreshold = raidConfig?.userThreshold || DEFAULT_JOIN_THRESHOLD;
  const timeWindowMs = (raidConfig?.timeWindow || DEFAULT_TIME_WINDOW_MS / 1000) * 1000;

  let tracking = joinTimestamps.get(guildId);
  if (!tracking) {
    tracking = { times: [], userIds: [] };
    joinTimestamps.set(guildId, tracking);
  }

  tracking.times.push(now);
  tracking.userIds.push(userId);

  const cutoff = now - timeWindowMs;
  while ('0' in tracking.times && tracking.times[0] < cutoff) {
    tracking.times.shift();
    tracking.userIds.shift();
  }

  if (tracking.times.length >= joinThreshold) {
    const lastAlertTime = lastAlert.get(guildId);
    if (lastAlertTime && now - lastAlertTime < ALERT_COOLDOWN) {
      return null;
    }

    lastAlert.set(guildId, now);
    activeRaids.set(guildId, now);

    const result = {
      detected: true,
      joinCount: tracking.times.length,
      userIds: [...tracking.userIds],
    };

    tracking.times = [];
    tracking.userIds = [];

    return result;
  }

  return null;
}

const invitesLockedGuilds = new Set<string>();

async function persistRaidInviteLock(guildId: string, unlockAt: number): Promise<void> {
  await GuildSettings.updateOne(
    { guildId },
    {
      $set: {
        raidInvitesWereDisabled: true,
        raidInviteUnlockAt: new Date(unlockAt),
      },
    },
    { upsert: true },
  );
  settingsCache.invalidate(guildId);
}

async function clearRaidInviteLock(guildId: string): Promise<void> {
  await GuildSettings.updateOne(
    { guildId },
    {
      $set: {
        raidInvitesWereDisabled: false,
        raidInviteUnlockAt: null,
      },
    },
  );
  settingsCache.invalidate(guildId);
  invitesLockedGuilds.delete(guildId);
}

function scheduleRaidInviteUnlock(client: Client, guildId: string, unlockAt: number): void {
  const delay = unlockAt - Date.now();
  setTimeout(
    () => {
      void unlockRaidInvites(client, guildId);
    },
    Math.min(Math.max(0, delay), MAX_TIMER_DELAY),
  ).unref?.();
}

async function unlockRaidInvites(client: Client, guildId: string): Promise<void> {
  try {
    const state = await GuildSettings.findOne({ guildId }).lean();
    if (!state) {
      invitesLockedGuilds.delete(guildId);
      return;
    }
    const unlockAt = state?.raidInviteUnlockAt?.getTime();
    if (!unlockAt) {
      invitesLockedGuilds.delete(guildId);
      return;
    }

    if (unlockAt > Date.now()) {
      scheduleRaidInviteUnlock(client, guildId, unlockAt);
      return;
    }

    const guildData = (await client.rest.get(Routes.guild(guildId))) as APIGuild;
    const features: string[] = guildData?.features || [];
    if (state.raidInvitesWereDisabled !== true || !features.includes('INVITES_DISABLED')) {
      await clearRaidInviteLock(guildId);
      return;
    }

    await client.rest.patch(Routes.guild(guildId), {
      body: { features: features.filter((feature: string) => feature !== 'INVITES_DISABLED') },
    });
    await clearRaidInviteLock(guildId);

    const guild = client.guilds.get(guildId);
    if (guild) {
      await logServerEvent(guild, 'Raid Invite Lockdown Lifted', 0x2ecc71, [], client, {
        description: 'Server invites have been automatically re-enabled after the raid cooldown.',
        footer: `${config.branding.publicName} Anti-Raid`,
        eventType: 'raid_invite_unlock',
      }).catch(() => {});
    }
  } catch (err: unknown) {
    console.warn(`[raid-detect] Failed to re-enable invites for ${guildId}: ${messageFromError(err)}`);
    scheduleRaidInviteUnlock(client, guildId, Date.now() + RAID_INVITE_RETRY_DELAY);
  }
}

export async function restoreRaidInviteLocks(client: Client): Promise<void> {
  const pending = await GuildSettings.find({ raidInviteUnlockAt: { $ne: null } }).lean();
  for (const state of pending) {
    const unlockAt = state.raidInviteUnlockAt?.getTime();
    if (unlockAt) scheduleRaidInviteUnlock(client, state.guildId, unlockAt);
  }
}

export async function lockInvitesForRaid(client: Client, guild: Guild): Promise<boolean> {
  if (invitesLockedGuilds.has(guild.id)) return false;
  try {
    const guildData = (await client.rest.get(Routes.guild(guild.id))) as APIGuild;
    const features: string[] = guildData?.features || [];
    if (features.includes('INVITES_DISABLED')) return false;

    const unlockAt = Date.now() + RAID_ACTIVE_DURATION;
    await persistRaidInviteLock(guild.id, unlockAt);
    await client.rest.patch(Routes.guild(guild.id), {
      body: { features: [...features, 'INVITES_DISABLED'] },
    });
    invitesLockedGuilds.add(guild.id);
    scheduleRaidInviteUnlock(client, guild.id, unlockAt);

    return true;
  } catch (err: unknown) {
    console.warn(`[raid-detect] Failed to disable invites for ${guild.name}: ${messageFromError(err)}`);
    return false;
  }
}

export function getAccountAgeDays(userId: string): number | null {
  try {
    const createdMs = Number(BigInt(userId) >> 22n) + 1420070400000;
    return (Date.now() - createdMs) / 86_400_000;
  } catch {
    return null;
  }
}

export async function sendRaidAlert(client: Client, guild: Guild, joinCount: number, userIds: string[]): Promise<void> {
  const idList = userIds.map((id) => `\`${id}\``).join(', ');
  const idListForBan = userIds.join(',');
  const mentionList = userIds
    .slice(0, 20)
    .map((id) => `<@${id}>`)
    .join(' ');

  const embed = new EmbedBuilder()
    .setTitle(t('en', 'auditCatalog.utils.raidDetector.embedTitle'))
    .setDescription(
      `**${joinCount}** users joined **${guild.name}** within a short time window.\n\n` +
        `This may be a raid. Review the user(s) below and take action if needed.`,
    )
    .addFields(
      {
        name: t('en', 'auditCatalog.utils.raidDetector.l91_addFields_name'),
        value: `${guild.name} (\`${guild.id}\`)`,
        inline: false,
      },
      {
        name: t('en', 'auditCatalog.utils.raidDetector.userIds', { 'userIds.length': userIds.length }),
        value: idList.length > 1024 ? idList.slice(0, 1000) + '...' : idList,
        inline: false,
      },
      {
        name: t('en', 'auditCatalog.utils.raidDetector.userIdsCopyable'),
        value: `\`\`\`
  ${idListForBan.length > 900 ? idListForBan.slice(0, 900) + '...' : idListForBan}
  \`\`\``,
        inline: false,
      },
    )
    .setColor(0xff0000)
    .setTimestamp(new Date());

  const alertPayload = { embeds: [embed] };

  try {
    await logServerEvent(
      guild,
      '🚨 Raid Detected',
      0xff0000,
      [
        { name: 'Joins', value: `**${joinCount}** in rapid succession`, inline: true },
        {
          name: 'Users',
          value: mentionList + (userIds.length > 20 ? `\n...and ${userIds.length - 20} more` : ''),
          inline: false,
        },
        {
          name: 'User IDs (copyable)',
          value: `\`\`\`\n${idListForBan.length > 900 ? idListForBan.slice(0, 900) + '...' : idListForBan}\n\`\`\``,
          inline: false,
        },
      ],
      client,
      {
        description: 'A possible raid has been detected. Review the accounts below and take action.',
        footer: `${config.branding.publicName} Anti-Raid • Configure thresholds in the dashboard under Automod`,
        eventType: 'raid_detected',
      },
    );
  } catch {}

  if (config.ownerId) {
    await sendUserDm(client, config.ownerId, alertPayload).catch(() => {});
  }

  const guildOwnerId = guild.ownerId;
  if (guildOwnerId && guildOwnerId !== config.ownerId) {
    await sendUserDm(client, guildOwnerId, {
      embeds: [
        new EmbedBuilder()
          .setTitle(t('en', 'auditCatalog.utils.raidDetector.embedTitle'))
          .setDescription(
            `**${joinCount}** users joined **${guild.name}** in rapid succession.\n\n` +
              `This may be a raid. Check your server and consider enabling lockdown if needed.`,
          )
          .addFields({
            name: t('en', 'auditCatalog.utils.raidDetector.userIds', {
              'userIds.length': userIds.length,
            }),
            value: idList.length > 1024 ? idList.slice(0, 1000) + '...' : idList,
            inline: false,
          })
          .setColor(0xff0000)
          .setTimestamp(new Date()),
      ],
    }).catch(() => {});
  }

  console.warn(`[raid-detect] ALERT: ${joinCount} joins in ${guild.name} (${guild.id})`);
}
