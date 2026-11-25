import type { Client, Guild, MessageSendOptions } from '@fluxerjs/core';
import type { ILeveling } from '@/types/Leveling';
import type { LevelUpResult } from './index';
import { applyLevelRoles, renderLevelUpMessage, resolveLevelUpChannelId } from './levelUp';
import { generateRankCard } from './rankCard';
import { resolveMemberAvatarUrl, resolveMemberUsername } from './memberXp';
import LevelProfile from '@/models/LevelProfile';
import { isTextChannel } from '../isTextChannel';
import { sendMessage } from '@/utils/sendMessage';
import { messageFromError } from '@/utils/messageFromError';

export async function handleLevelUp(
  client: Client,
  guild: Guild,
  userId: string,
  result: LevelUpResult,
  leveling: ILeveling,
  messageChannelId: string | null,
): Promise<void> {
  if (!result.leveledUp) return;

  const { applied } = await applyLevelRoles(guild, userId, result.newLevel, leveling);
  const earned = applied[applied.length - 1] ?? null;
  let earnedRoleName: string | null = null;
  if (earned) {
    const role = guild.roles?.get?.(earned.roleId);
    earnedRoleName = role?.name ?? null;
  }

  if (!leveling.levelUp.enabled) return;

  const member = guild.members?.get(userId);
  const username = resolveMemberUsername(member, userId);
  const avatarURL = resolveMemberAvatarUrl(member);
  const text = renderLevelUpMessage(leveling.levelUp.template, {
    userId,
    username,
    level: result.newLevel,
    xp: result.profile.xp,
    earnedRoleId: earned?.roleId ?? null,
    earnedRoleName,
  });

  const targetId = resolveLevelUpChannelId(leveling, messageChannelId);
  if (!targetId) {
    console.warn(`[leveling] No level-up channel for ${userId} in ${guild.name}`);
    return;
  }

  const channel = guild.channels?.get(targetId) ?? (await client.channels.fetch(targetId).catch(() => null));
  if (!channel || !isTextChannel(channel)) {
    console.warn(`[leveling] Level-up channel ${targetId} is missing or not a text channel in ${guild.name}`);
    return;
  }

  const payload: MessageSendOptions = { content: text };

  if (leveling.levelUp.includeImage) {
    try {
      const rank = await LevelProfile.getRank(guild.id, userId);
      const png = await generateRankCard({
        username,
        avatarURL,
        level: result.newLevel,
        xp: result.profile.xp,
        rank,
        formula: leveling.formula,
        settings: leveling.rankCard,
      });
      payload.files = [{ name: 'levelup.png', data: png }];
    } catch {}
  }

  await sendMessage(channel, payload).catch((err: unknown) => {
    console.warn(
      `[leveling] Failed to send level-up notice in ${guild.name} to #${channel.name}: ${messageFromError(err)}`,
    );
  });
}
