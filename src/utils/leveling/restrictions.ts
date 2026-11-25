import type { ILeveling } from '@/types/Leveling';
import { normalizeLevelingSettings } from '@/types/Leveling';

export interface XpContext {
  channelId?: string | null;
  memberRoleIds?: readonly string[];
  isVoiceTextChannel?: boolean;
}

export function getLevelingConfig(settings: { leveling?: Partial<ILeveling> | null } | null): ILeveling {
  return normalizeLevelingSettings(settings?.leveling);
}

export function canEarnXp(leveling: ILeveling, ctx: XpContext): boolean {
  if (!leveling.enabled) return false;

  const { restrictions } = leveling;
  const channelId = ctx.channelId ?? null;

  if (channelId && restrictions.noXpChannels.length) {
    const listed = restrictions.noXpChannels.includes(channelId);
    if (restrictions.noXpChannelMode === 'blacklist' && listed) return false;
    if (restrictions.noXpChannelMode === 'whitelist' && !listed) return false;
  }

  if (restrictions.noXpRoles.length && ctx.memberRoleIds?.length) {
    if (restrictions.noXpRoles.some((r) => ctx.memberRoleIds!.includes(r))) return false;
  }

  if (ctx.isVoiceTextChannel && !restrictions.textInVoiceXp) return false;

  return true;
}
