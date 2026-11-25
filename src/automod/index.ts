import type {
  AutomodLevel,
  AutomodSettings,
  AutomodSettingsPreset,
  IAntiLinkAutomodModule,
  IAntiRaidAutomodModule,
  IAntiSpamAutomodModule,
  IGuildSettings,
  IKeywordWarningAutomodModule,
} from '@/types';
import type { Client, Message } from '@fluxerjs/core';
import settingsCache from '@/utils/settingsCache';
import { hasAnyPermission } from '@/utils/permissions';

import antiLink from './modules/antiLink';
import antiSpam from './modules/antiSpam';
import antiRaid from './modules/antiRaid';
import ghostPing from './modules/ghostPing';
import keywordWarning from './modules/keywordWarning';

export const AUTOMOD_PRESETS = {
  off: { antiSpam: false, antiLink: false, antiReactionSpam: false, maxMentions: 0, maxLines: 0 },
  minimal: { antiSpam: true, antiLink: false, antiReactionSpam: false, maxMentions: 5, maxLines: 10 },
  medium: { antiSpam: true, antiLink: true, antiReactionSpam: true, maxMentions: 3, maxLines: 7 },
  high: { antiSpam: true, antiLink: true, antiReactionSpam: true, maxMentions: 2, maxLines: 5 },
} as const satisfies Record<AutomodLevel, AutomodSettingsPreset>;

const exemptCache = new Map<string, number>();
const EXEMPT_TTL = 30000;

function isKnownExempt(guildId: string, userId: string): boolean {
  const key = `${guildId}-${userId}`;
  const expiry = exemptCache.get(key);
  if (!expiry) return false;
  if (Date.now() > expiry) {
    exemptCache.delete(key);
    return false;
  }
  return true;
}

function markExempt(guildId: string, userId: string): void {
  exemptCache.set(`${guildId}-${userId}`, Date.now() + EXEMPT_TTL);
  if (exemptCache.size > 5000) {
    const now = Date.now();
    for (const [k, v] of exemptCache) {
      if (now > v) exemptCache.delete(k);
    }
  }
}

function getAutomodSettings(settings: IGuildSettings): AutomodSettings {
  const level = settings?.automod?.level || 'off';

  const preset = AUTOMOD_PRESETS[level] || AUTOMOD_PRESETS.off;

  if (level === 'off') {
    return { ...preset, level: 'off', enabled: false };
  }

  return {
    enabled: true,
    level,
    antiSpam: settings?.automod?.antiSpam ?? preset.antiSpam,
    antiReactionSpam: settings?.automod?.antiReactionSpam ?? preset.antiReactionSpam,
    antiLink: settings?.automod?.antiLink ?? preset.antiLink,
    maxMentions: settings?.automod?.maxMentions ?? preset.maxMentions,
    maxLines: settings?.automod?.maxLines ?? preset.maxLines,
  };
}

class AutomodSystem {
  modules: {
    antiLink: IAntiLinkAutomodModule;
    antiSpam: IAntiSpamAutomodModule;
    antiRaid: IAntiRaidAutomodModule;
    keywordWarning: IKeywordWarningAutomodModule;
  };

  ghostPing: typeof ghostPing;

  constructor() {
    this.modules = {
      antiLink,
      antiSpam,
      antiRaid,
      keywordWarning,
    };

    this.ghostPing = ghostPing;
  }

  async check(message: Message, client: Client): Promise<boolean> {
    if (message.author?.bot) return false;

    const guildId = message.guildId || message.guild?.id;
    if (!guildId) return false;

    const userId = message.author.id;

    if (isKnownExempt(guildId, userId)) return false;

    try {
      const settings = await settingsCache.get(guildId);
      if (!settings) return false;

      const channelId = message.channelId || message.channel?.id;
      if (channelId && settings.automod?.exemptChannels?.includes(channelId)) return false;

      const guild = message.guild || client.guilds?.get(guildId);
      if (!guild) return false;

      let member = guild.members?.get(userId) ?? null;

      if (!member) {
        try {
          member = await guild.fetchMember(userId);
        } catch {
          member = null;
        }
      }

      if (member) {
        if (hasAnyPermission(member, ['ManageMessages', 'Administrator'])) {
          markExempt(guildId, userId);
          return false;
        }

        const exemptRoles = settings.automod?.exemptRoles || [];
        if (exemptRoles.length > 0) {
          const memberRoleIds = member.roles?.roleIds ?? [];
          if (memberRoleIds.some((id: string) => exemptRoles.includes(id))) {
            markExempt(guildId, userId);
            return false;
          }
        }
      }

      let violationDetected = false;

      const kwResult = await this.modules.keywordWarning.check(message, client, settings);
      if (kwResult) violationDetected = true;

      const automodSettings = getAutomodSettings(settings);
      if (automodSettings.enabled) {
        const tasks: Promise<boolean>[] = [];

        if (automodSettings.antiLink) {
          tasks.push(this.modules.antiLink.check(message, client, settings, automodSettings));
        }
        if (automodSettings.antiSpam) {
          tasks.push(this.modules.antiSpam.check(message, client, settings, automodSettings));
        }

        tasks.push(this.modules.antiRaid.check(message, client, settings));

        if (tasks.length > 0) {
          const results = await Promise.allSettled(tasks);
          for (const r of results) {
            if (r.status === 'fulfilled' && r.value) violationDetected = true;
          }
        }
      }

      return violationDetected;
    } catch (error) {
      console.error('Error in automod check:', error);
      return false;
    }
  }

  async handleGhostPing(message: Message, client: Client): Promise<boolean> {
    const guildId = message.guildId ?? message.guild?.id;
    if (!guildId) return false;

    if (message.author?.bot) return false;

    try {
      const settings = await settingsCache.get(guildId);
      if (!settings) return false;

      const channelId = message.channelId || message.channel?.id;
      if (channelId && settings.automod?.exemptChannels?.includes(channelId)) return false;

      return await this.ghostPing.check(message, client, settings);
    } catch (error) {
      console.error('Error in ghost ping detection:', error);
      return false;
    }
  }
}

const automod = new AutomodSystem();
export default automod;
