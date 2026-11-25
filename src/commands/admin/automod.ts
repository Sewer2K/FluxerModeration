import { EmbedBuilder, type Guild, type Message } from '@fluxerjs/core';
import type { AutomodLevel, Command, IAutomod, IAutomodSpam, IGuildSettings } from '@/types';
import { VALID_AUTOMOD_LEVELS as VALID_LEVELS } from '@/types';
import { AUTOMOD_PRESETS } from '@/automod';
import GuildSettings, { type GuildSettingsDocument } from '@/models/GuildSettings';
import settingsCache from '@/utils/settingsCache';
import isNetworkError from '@/utils/isNetworkError';
import { t, normalizeLocale } from '@/i18n';
import { isInUnion } from '@/utils/isInUnion';
import { messageFromError } from '@/utils/messageFromError';

function levelDescription(lang: string, level: AutomodLevel): string {
  return t(lang, `commands.admin.automod.levelDescriptions.${level}`);
}

function yn(bool: unknown, lang: string): string {
  return bool ? t(lang, 'commands.admin.automod.yes') : t(lang, 'commands.admin.automod.no');
}

function parseRoleId(arg?: string): string | null {
  const m = arg?.match(/^<@&(\d{17,19})>$/);
  return m && '1' in m ? m[1] : /^\d{17,19}$/.test(arg || '') ? arg! : null;
}

function parseChannelId(arg?: string): string | null {
  const m = arg?.match(/^<#(\d{17,19})>$/);
  return m && '1' in m ? m[1] : /^\d{17,19}$/.test(arg || '') ? arg! : null;
}

async function showStatus(message: Message, guild: Guild, settings: IGuildSettings, lang: string) {
  // handle unmigrated data
  const am = (settings.automod ??
    {
      // values assumed to be populated in later calls
    }) as IAutomod;
  const spam = (am.spam ??
    {
      // values assumed to be populated in later calls
    }) as IAutomodSpam;

  const exemptRoles =
    (am.exemptRoles || []).map((id: string) => `<@&${id}>`).join(', ') || t(lang, 'commands.admin.automod.status.none');
  const exemptChannels =
    (am.exemptChannels || []).map((id: string) => `<#${id}>`).join(', ') ||
    t(lang, 'commands.admin.automod.status.none');
  const customDomains = (am.allowedDomains || []).join(', ') || t(lang, 'commands.admin.automod.status.none');
  const level = am.level || 'off';

  const embed = new EmbedBuilder()
    .setTitle(t(lang, 'commands.admin.automod.status.title', { guildName: guild.name }))
    .setColor(0x5865f2)
    .addFields(
      {
        name: t(lang, 'commands.admin.automod.status.fieldLevel'),
        value: t(lang, 'commands.admin.automod.status.levelValue', {
          level,
          description: levelDescription(lang, level),
        }),
      },
      { name: t(lang, 'commands.admin.automod.status.fieldAntiSpam'), value: yn(am.antiSpam, lang), inline: true },
      { name: t(lang, 'commands.admin.automod.status.fieldAntiLink'), value: yn(am.antiLink, lang), inline: true },
      {
        name: t(lang, 'commands.admin.automod.status.fieldAntiReactionSpam'),
        value: yn(am.antiReactionSpam, lang),
        inline: true,
      },
      { name: t(lang, 'commands.admin.automod.status.fieldGhostPing'), value: yn(am.ghostPing, lang), inline: true },
      {
        name: t(lang, 'commands.admin.automod.status.fieldSpamThresholds'),
        value: t(lang, 'commands.admin.automod.status.spamThresholdsValue', {
          maxMessages: spam.maxMessages ?? 5,
          timeWindow: spam.timeWindow ?? 5,
          violationThreshold: spam.violationThreshold ?? 3,
          timeoutDuration: spam.timeoutDuration ?? 10,
        }),
      },
      { name: t(lang, 'commands.admin.automod.status.fieldAllowedDomains'), value: customDomains },
      { name: t(lang, 'commands.admin.automod.status.fieldExemptRoles'), value: exemptRoles },
      { name: t(lang, 'commands.admin.automod.status.fieldExemptChannels'), value: exemptChannels },
    )
    .setFooter({ text: t(lang, 'commands.admin.automod.status.footer') });

  return void (await message.reply({ embeds: [embed] }));
}

const SUBCOMMAND_LITERALS = ['status', 'level', 'spam', 'link', 'reactionspam', 'ghostping', 'exempt'] as const;

const subcommands: Record<
  (typeof SUBCOMMAND_LITERALS)[number],
  (message: Message, args: string[], guild: Guild, settings: GuildSettingsDocument) => Promise<void>
> = {
  async status(message, _args, guild, settings) {
    const lang = normalizeLocale(settings?.language);
    return showStatus(message, guild, settings, lang);
  },

  async level(message, args, guild, settings) {
    const lang = normalizeLocale(settings?.language);
    const lvl = args[0]?.toLowerCase();
    if (!lvl || !isInUnion(lvl, VALID_LEVELS)) {
      return void (await message.reply(
        t(lang, 'commands.admin.automod.level.validLevels', { levels: VALID_LEVELS.join('`, `') }),
      ));
    }

    Object.assign(settings.automod, {
      ...AUTOMOD_PRESETS[lvl],
      level: lvl,
    });

    settings.markModified('automod');
    await settings.save();
    settingsCache.invalidate(guild.id);

    return void (await message.reply(
      t(lang, 'commands.admin.automod.level.setDone', { level: lvl, description: levelDescription(lang, lvl) }),
    ));
  },

  async spam(message, args, guild, settings) {
    const lang = normalizeLocale(settings?.language);
    const [sub, rawVal] = args;
    const val = typeof rawVal === 'string' ? parseInt(rawVal, 10) : NaN;

    // handle unmigrated data
    settings.automod.spam ??= {
      // values assumed to be populated in later calls
    } as IAutomodSpam;

    switch (sub) {
      case 'messages': {
        if (isNaN(val) || val < 2 || val > 20) {
          return void (await message.reply(t(lang, 'commands.admin.automod.spam.messagesRange')));
        }
        settings.automod.spam.maxMessages = val;
        break;
      }
      case 'window': {
        if (isNaN(val) || val < 1 || val > 60) {
          return void (await message.reply(t(lang, 'commands.admin.automod.spam.windowRange')));
        }
        settings.automod.spam.timeWindow = val;
        break;
      }
      case 'timeout': {
        if (isNaN(val) || val < 1 || val > 60) {
          return void (await message.reply(t(lang, 'commands.admin.automod.spam.timeoutRange')));
        }
        settings.automod.spam.timeoutDuration = val;
        break;
      }
      case 'violations': {
        if (isNaN(val) || val < 1 || val > 10) {
          return void (await message.reply(t(lang, 'commands.admin.automod.spam.violationsRange')));
        }
        settings.automod.spam.violationThreshold = val;
        break;
      }
      default:
        return void (await message.reply(t(lang, 'commands.admin.automod.spam.usage')));
    }

    settings.markModified('automod');
    await settings.save();
    settingsCache.invalidate(guild.id);

    const spam = settings.automod.spam;
    return void (await message.reply(
      t(lang, 'commands.admin.automod.spam.updated', {
        maxMessages: spam.maxMessages ?? 5,
        timeWindow: spam.timeWindow ?? 5,
        violationThreshold: spam.violationThreshold ?? 3,
        timeoutDuration: spam.timeoutDuration ?? 10,
      }),
    ));
  },

  async link(message, args, guild, settings) {
    const lang = normalizeLocale(settings?.language);
    const [action, domain] = args;

    if (!domain || !isInUnion(action, ['allow', 'deny'])) {
      return void (await message.reply(t(lang, 'commands.admin.automod.link.usage')));
    }

    const clean = domain
      .replace(/^https?:\/\//i, '')
      .replace(/\/$/, '')
      .toLowerCase();

    // handle unmigrated data
    settings.automod.allowedDomains ??= [];

    if (action === 'allow') {
      if (settings.automod.allowedDomains.includes(clean)) {
        return void (await message.reply(t(lang, 'commands.admin.automod.link.alreadyAllowed', { domain: clean })));
      }
      settings.automod.allowedDomains.push(clean);
      settings.markModified('automod');
      await settings.save();
      settingsCache.invalidate(guild.id);
      return void (await message.reply(t(lang, 'commands.admin.automod.link.added', { domain: clean })));
    } else {
      const idx = settings.automod.allowedDomains.indexOf(clean);
      if (idx === -1)
        return void (await message.reply(t(lang, 'commands.admin.automod.link.notAllowed', { domain: clean })));
      settings.automod.allowedDomains.splice(idx, 1);
      settings.markModified('automod');
      await settings.save();
      settingsCache.invalidate(guild.id);
      return void (await message.reply(t(lang, 'commands.admin.automod.link.removed', { domain: clean })));
    }
  },

  async reactionspam(message, args, guild, settings) {
    const lang = normalizeLocale(settings?.language);
    const val = args[0]?.toLowerCase();
    if (!val || !isInUnion(val, ['on', 'off'] as const)) {
      return void (await message.reply(t(lang, 'commands.admin.automod.reactionspam.usage')));
    }

    settings.automod.antiReactionSpam = val === 'on';

    if (val === 'on' && (!settings.automod.level || settings.automod.level === 'off')) {
      settings.automod.level = 'minimal';
    }

    settings.markModified('automod');
    await settings.save();
    settingsCache.invalidate(guild.id);

    const status = settings.automod.antiReactionSpam ? 'enabled' : 'disabled';
    let reply = t(lang, 'commands.admin.automod.reactionspam.base', { status });
    if (settings.automod.antiReactionSpam && settings.automod.level === 'minimal') {
      reply += ' ' + t(lang, 'commands.generic.automodSuffixLevelMinimal');
    }
    return void (await message.reply(reply));
  },

  async ghostping(message, args, guild, settings) {
    const lang = normalizeLocale(settings?.language);
    const val = args[0]?.toLowerCase();
    if (!val || !['on', 'off'].includes(val)) {
      return void (await message.reply(t(lang, 'commands.admin.automod.ghostping.usage')));
    }

    settings.automod.ghostPing = val === 'on';
    settings.markModified('automod');
    await settings.save();
    settingsCache.invalidate(guild.id);

    const status = settings.automod.ghostPing ? 'enabled' : 'disabled';

    let reply = t(lang, 'commands.admin.automod.ghostping.base', { status });
    if (settings.automod.ghostPing && settings.automod.level === 'off') {
      reply += t(lang, 'commands.admin.automod.ghostping.noteLevelOff');
    }
    return void (await message.reply(reply));
  },

  async exempt(message, args, guild, settings) {
    const lang = normalizeLocale(settings?.language);
    const [type, action, target] = args;

    if (!target || !isInUnion(type, ['role', 'channel'] as const) || !isInUnion(action, ['add', 'remove'] as const)) {
      return void (await message.reply(t(lang, 'commands.admin.automod.exempt.usage')));
    }

    if (type === 'role') {
      const roleId = parseRoleId(target);
      if (!roleId) {
        return void (await message.reply(t(lang, 'commands.generic.invalidRoleInput')));
      }

      // handle unmigrated data
      settings.automod.exemptRoles ??= [];

      if (action === 'add') {
        if (settings.automod.exemptRoles.includes(roleId)) {
          return void (await message.reply(t(lang, 'commands.admin.automod.exempt.roleAlreadyExempt')));
        }
        settings.automod.exemptRoles.push(roleId);
        settings.markModified('automod');
        await settings.save();
        settingsCache.invalidate(guild.id);
        return void (await message.reply(t(lang, 'commands.admin.automod.exempt.roleNowExempt', { roleId })));
      } else {
        const idx = settings.automod.exemptRoles.indexOf(roleId);
        if (idx === -1) return void (await message.reply(t(lang, 'commands.admin.automod.exempt.roleNotExempt')));
        settings.automod.exemptRoles.splice(idx, 1);
        settings.markModified('automod');
        await settings.save();
        settingsCache.invalidate(guild.id);
        return void (await message.reply(t(lang, 'commands.admin.automod.exempt.roleNoLongerExempt', { roleId })));
      }
    }

    if (type === 'channel') {
      const channelId = parseChannelId(target);
      if (!channelId) return void (await message.reply(t(lang, 'commands.generic.invalidChannelInput')));

      // handle unmigrated data
      settings.automod.exemptChannels ??= [];

      if (action === 'add') {
        if (settings.automod.exemptChannels.includes(channelId)) {
          return void (await message.reply(t(lang, 'commands.admin.automod.exempt.channelAlreadyExempt')));
        }
        settings.automod.exemptChannels.push(channelId);
        settings.markModified('automod');
        await settings.save();
        settingsCache.invalidate(guild.id);
        return void (await message.reply(t(lang, 'commands.admin.automod.exempt.channelNowDisabled', { channelId })));
      } else {
        const idx = settings.automod.exemptChannels.indexOf(channelId);
        if (idx === -1) return void (await message.reply(t(lang, 'commands.admin.automod.exempt.channelNotExempt')));
        settings.automod.exemptChannels.splice(idx, 1);
        settings.markModified('automod');
        await settings.save();
        settingsCache.invalidate(guild.id);
        return void (await message.reply(t(lang, 'commands.admin.automod.exempt.channelReEnabled', { channelId })));
      }
    }
  },
};

async function showHelp(message: Message, lang: string) {
  const embed = new EmbedBuilder()
    .setTitle(t(lang, 'commands.admin.automod.help.title'))
    .setColor(0x5865f2)
    .addFields(
      {
        name: t(lang, 'commands.admin.automod.help.fieldStatusName'),
        value: t(lang, 'commands.admin.automod.help.fieldStatusValue'),
      },
      {
        name: t(lang, 'commands.admin.automod.help.fieldLevelName'),
        value: t(lang, 'commands.admin.automod.help.fieldLevelValue'),
      },
      {
        name: t(lang, 'commands.admin.automod.help.fieldSpamName'),
        value: t(lang, 'commands.admin.automod.help.fieldSpamValue'),
      },
      {
        name: t(lang, 'commands.admin.automod.help.fieldLinkName'),
        value: t(lang, 'commands.admin.automod.help.fieldLinkValue'),
      },
      {
        name: t(lang, 'commands.admin.automod.help.fieldReactionSpamName'),
        value: t(lang, 'commands.admin.automod.help.fieldReactionSpamValue'),
      },
      {
        name: t(lang, 'commands.admin.automod.help.fieldGhostPingName'),
        value: t(lang, 'commands.admin.automod.help.fieldGhostPingValue'),
      },
      {
        name: t(lang, 'commands.admin.automod.help.fieldExemptRoleName'),
        value: t(lang, 'commands.admin.automod.help.fieldExemptRoleValue'),
      },
      {
        name: t(lang, 'commands.admin.automod.help.fieldExemptChannelName'),
        value: t(lang, 'commands.admin.automod.help.fieldExemptChannelValue'),
      },
    )
    .setFooter({ text: t(lang, 'commands.admin.automod.help.footer') });

  return void (await message.reply({ embeds: [embed] }));
}

const command: Command = {
  name: 'automod',
  description: [
    'Configure every aspect of automod for your server. Run `!automod` with no arguments to see the full subcommand guide.',
    '',
    '**Subcommands:**',
    '`status` - show all current automod settings',
    '`level <off|minimal|medium|high>` - set the overall automod preset',
    '`spam <messages|window|violations|timeout> <value>` - tune spam detection thresholds',
    '`link <allow|deny> <domain>` - manage the link filter domain allowlist',
    '`ghostping <on|off>` - enable or disable ghost ping detection',
    '`exempt role <add|remove> <@role>` - give a role full automod immunity',
    '`exempt channel <add|remove> <#channel>` - disable automod in a specific channel',
  ].join('\n'),
  usage: '<subcommand> [args...]',
  category: 'admin',
  permissions: ['ManageGuild'],
  cooldown: 3,

  async execute(message, args, client): Promise<void> {
    let guild = message.guild;
    if (!guild && message.guildId) guild = await client.guilds.fetch(message.guildId);
    if (!guild) return void (await message.reply(t('en', 'commands.generic.serverOnly')));

    try {
      const settings = await GuildSettings.getOrCreate(guild.id);
      const lang = normalizeLocale(settings.language);
      const sub: string | undefined = args[0]?.toLowerCase();

      if (!isInUnion(sub, SUBCOMMAND_LITERALS) || !subcommands[sub]) {
        return void (await showHelp(message, lang));
      }

      // handle unmigrated data
      settings.automod ??= {
        // values assumed to be populated in later calls
      } as IAutomod;

      await subcommands[sub](message, args.slice(1), guild, settings);
    } catch (error) {
      const guildName = guild?.name || 'Unknown Server';
      if (isNetworkError(error)) {
        console.warn(`[${guildName}] Fluxer API unreachable during !automod (ECONNRESET)`);
      } else {
        console.error(`[${guildName}] Error in !automod: ${messageFromError(error)}`);
        const cached = await settingsCache.get(guild.id).catch(() => null);
        const lang = normalizeLocale(cached?.language);
        message.reply(t(lang, 'commands.admin.automod.errorGeneric')).catch(() => {});
      }
    }
  },
};

export default command;
