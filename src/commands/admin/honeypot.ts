import type { Channel, Client, Guild, Message } from '@fluxerjs/core';
import type { Command, IHoneypotEntry, HoneypotAction } from '@/types';
import GuildSettings from '@/models/GuildSettings';
import settingsCache from '@/utils/settingsCache';
import { canManageRole } from '@/utils/permissions';
import { t, normalizeLocale } from '@/i18n';
import { isInUnion } from '@/utils/isInUnion';

const MAX_HONEYPOTS = 10;
const VALID_ACTIONS = ['ban', 'kick', 'timeout', 'role'] as const;

async function resolveChannel(arg: string, guild: Guild, client: Client): Promise<Channel | null> {
  const idMatch = /^<#(\d+)>$/.exec(arg) || /^(\d+)$/.exec(arg);
  if (idMatch && '1' in idMatch) {
    const id = idMatch[1];
    let ch: Channel | undefined = guild.channels.get(id);
    if (!ch) {
      try {
        ch = await client.channels.resolve(id);
      } catch {}
    }
    return ch || null;
  }
  const name = arg.replace(/^#/, '').toLowerCase();
  for (const ch of guild.channels.values()) {
    if (ch.name && ch.name.toLowerCase() === name) return ch;
  }
  return null;
}

function parseRoleId(str: string): string | null {
  const match = /^<@&(\d+)>$/.exec(str) || /^(\d+)$/.exec(str);
  return match?.[1] ?? null;
}

function saveEntry(entry: Partial<IHoneypotEntry>, action: HoneypotAction, param: string) {
  entry.action = action;
  if (action === 'ban') {
    const days = parseInt(param, 10);
    entry.banDeleteDays = !isNaN(days) && days >= 0 && days <= 7 ? days : 1;
  } else if (action === 'timeout') {
    entry.timeoutHours = parseInt(param, 10);
  } else if (action === 'role') {
    entry.roleId = param;
  }
}

function formatEntry(h: IHoneypotEntry): string {
  let detail = '';
  if (h.action === 'ban') detail = ` - delete \`${h.banDeleteDays ?? 1}\` day(s) of messages`;
  if (h.action === 'timeout') detail = ` - \`${h.timeoutHours ?? 24}\` hour(s)`;
  if (h.action === 'role') detail = h.roleId ? ` - <@&${h.roleId}>` : ' - (no role set)';
  const status = h.enabled === false ? ' `disabled`' : '';
  return `\`${h.action}\`${detail}${status}`;
}

async function showList(message: Message, guild: Guild, prefix = '!') {
  const settings = await GuildSettings.getOrCreate(guild.id);
  const honeypots = settings.honeypotChannels || [];
  const alertRole = settings.honeypotAlertRoleId;

  if (!honeypots.length) {
    return void (await message.reply(
      `**Honeypot Channels** - None configured.

Use \`${prefix}honeypot add <#channel> <ban|kick|timeout|role>\` to create one.`,
    ));
  }

  const lines = honeypots.map((h, i) => `**${i + 1}.** <#${h.channelId}> - ${formatEntry(h)}`).join('\n');

  const footer = alertRole
    ? `Alert role: <@&${alertRole}>`
    : `No alert role set. Use \`${prefix}honeypot alertrole <@role>\` to configure one.`;

  await message.reply(
    `**Honeypot Channels** (${honeypots.length}/${MAX_HONEYPOTS})

${lines}

${footer}`,
  );
}

async function showInfo(message: Message, guild: Guild, client: Client, args: string[], prefix = '!') {
  const [channelArg] = args;
  const settings = await GuildSettings.getOrCreate(guild.id);
  const lang = normalizeLocale(settings?.language);
  if (!channelArg) return message.reply(t(lang, 'auditCatalog.commands.admin.honeypot.l85_reply', { prefix }));

  const channel = await resolveChannel(channelArg, guild, client);
  if (!channel) return message.reply(t(lang, 'commands.admin.reactionrole.common.channelNotFound'));

  const entry = (settings.honeypotChannels || []).find((h) => h.channelId === channel.id);
  if (!entry) {
    return message.reply(
      t(lang, 'auditCatalog.commands.admin.honeypot.unconfiguredError', { 'channel.id': channel.id }),
    );
  }

  const lines = [
    `**Honeypot Info - <#${channel.id}>**`,
    '',
    `**Status:** ${entry.enabled === false ? 'Disabled' : 'Enabled'}`,
    `**Action:** \`${entry.action}\``,
  ];

  if (entry.action === 'ban') {
    lines.push(`**Message Purge:** ${entry.banDeleteDays ?? 1} day(s)`);
  } else if (entry.action === 'timeout') {
    lines.push(`**Timeout Duration:** ${entry.timeoutHours ?? 24} hour(s)`);
  } else if (entry.action === 'role') {
    lines.push(
      `**Role:** ${entry.roleId ? `<@&${entry.roleId}>` : `(none set - use \`${prefix}honeypot action #channel role @role\`)`}`,
    );
  }

  const alertRole = settings.honeypotAlertRoleId;
  lines.push(`**Alert Role:** ${alertRole ? `<@&${alertRole}>` : 'None'}`);

  return message.reply(lines.join('\n'));
}

async function upsertHoneypot(
  message: Message,
  guild: Guild,
  client: Client,
  args: string[],
  requireExisting: boolean,
  prefix = '!',
) {
  const settings = await GuildSettings.getOrCreate(guild.id);
  const lang = normalizeLocale(settings?.language);
  const [channelArg, actionArg, paramArg] = args;
  const subName = requireExisting ? 'action' : 'add';

  if (!channelArg || !actionArg) {
    return message.reply(
      `Usage:
\`${prefix}honeypot ${subName} <#channel> ban [delete_days]\`
\`${prefix}honeypot ${subName} <#channel> kick\`
\`${prefix}honeypot ${subName} <#channel> timeout <hours>\`
\`${prefix}honeypot ${subName} <#channel> role <@role>\``,
    );
  }

  const action = actionArg.toLowerCase();
  if (!isInUnion(action, VALID_ACTIONS)) {
    return message.reply(t(lang, 'auditCatalog.commands.admin.honeypot.l131_reply'));
  }

  let resolvedParam: string | null = null;
  if (action === 'timeout') {
    let hours: number;
    // assigns `hours` within if statement
    if (paramArg === undefined || ((hours = parseInt(paramArg, 10)), isNaN(hours)) || hours < 1 || hours > 672) {
      return message.reply(t(lang, 'auditCatalog.commands.admin.honeypot.l138_reply', { prefix }));
    }

    resolvedParam = paramArg;
  } else if (action === 'role') {
    const roleId = parseRoleId(paramArg || '');
    if (!roleId) {
      return message.reply(t(lang, 'auditCatalog.commands.admin.honeypot.l144_reply', { prefix }));
    }
    let targetRole = guild.roles?.get(roleId);
    if (!targetRole) {
      try {
        targetRole = await guild.fetchRole(roleId);
      } catch {}
    }
    if (targetRole) {
      let commandMember = guild.members?.get(message.author.id);
      if (!commandMember) {
        try {
          commandMember = await guild.fetchMember(message.author.id);
        } catch {}
      }
      if (commandMember) {
        const check = canManageRole(commandMember, targetRole, guild);
        if (!check.allowed) return void (await message.reply(check.reason));
      }
    }
    resolvedParam = roleId;
  } else if (action === 'ban' && paramArg) {
    const days = parseInt(paramArg, 10);
    if (isNaN(days) || days < 0 || days > 7) {
      return message.reply(t(lang, 'auditCatalog.commands.admin.honeypot.l164_reply'));
    }
    resolvedParam = paramArg;
  }

  const channel = await resolveChannel(channelArg, guild, client);
  if (!channel) return message.reply(t(lang, 'commands.admin.reactionrole.common.channelNotFound'));

  if (!settings.honeypotChannels) settings.honeypotChannels = [];

  const existing = settings.honeypotChannels.find((h) => h.channelId === channel.id);
  const previousEntry: Readonly<IHoneypotEntry> | undefined = existing ? { ...existing } : undefined;

  if (requireExisting && !existing) {
    return message.reply(
      t(lang, 'auditCatalog.commands.admin.honeypot.unconfiguredErrorWithSuggestion', {
        'channel.id': channel.id,
        prefix,
      }),
    );
  }

  if (!requireExisting && !existing && settings.honeypotChannels.length >= MAX_HONEYPOTS) {
    return message.reply(t(lang, 'auditCatalog.commands.admin.honeypot.l182_reply', { MAX_HONEYPOTS }));
  }

  if (resolvedParam) {
    if (existing) {
      saveEntry(existing, action, resolvedParam);
    } else {
      const newEntry: IHoneypotEntry = { channelId: channel.id, action, enabled: true, roleId: null };
      saveEntry(newEntry, action, resolvedParam);
      settings.honeypotChannels.push(newEntry);
    }
  }

  settings.markModified('honeypotChannels');
  await settings.save();
  settingsCache.invalidate(guild.id);

  await message.reply(
    t(lang, 'auditCatalog.commands.admin.honeypot.l198_reply', {
      'channel.id': channel.id,
      existing: existing !== undefined,
      formattedEntry: previousEntry ? formatEntry(previousEntry) : 'no previous entry',
    }),
  );
}

async function removeHoneypot(message: Message, guild: Guild, client: Client, args: string[], prefix = '!') {
  const settings = await GuildSettings.getOrCreate(guild.id);
  const lang = normalizeLocale(settings?.language);
  const [channelArg] = args;
  if (!channelArg) return message.reply(t(lang, 'auditCatalog.commands.admin.honeypot.l206_reply', { prefix }));

  const channel = await resolveChannel(channelArg, guild, client);
  if (!channel) return message.reply(t(lang, 'commands.admin.reactionrole.common.channelNotFound'));

  const before = (settings.honeypotChannels || []).length;
  settings.honeypotChannels = (settings.honeypotChannels || []).filter((h) => h.channelId !== channel.id);

  if (settings.honeypotChannels.length === before) {
    return message.reply(
      t(lang, 'auditCatalog.commands.admin.honeypot.unconfiguredError', { 'channel.id': channel.id }),
    );
  }

  settings.markModified('honeypotChannels');
  await settings.save();
  settingsCache.invalidate(guild.id);

  return message.reply(t(lang, 'auditCatalog.commands.admin.honeypot.l225_reply', { 'channel.id': channel.id }));
}

async function toggleHoneypot(
  message: Message,
  guild: Guild,
  client: Client,
  args: string[],
  enabled: boolean,
  prefix = '!',
) {
  const settings = await GuildSettings.getOrCreate(guild.id);
  const lang = normalizeLocale(settings?.language);
  const [channelArg] = args;
  if (!channelArg) {
    return message.reply(t(lang, 'auditCatalog.commands.admin.honeypot.l231_reply', { prefix, enabled }));
  }

  const channel = await resolveChannel(channelArg, guild, client);
  if (!channel) return message.reply(t(lang, 'commands.admin.reactionrole.common.channelNotFound'));

  const entry = (settings.honeypotChannels || []).find((h) => h.channelId === channel.id);

  if (!entry) {
    return message.reply(
      t(lang, 'auditCatalog.commands.admin.honeypot.unconfiguredErrorWithSuggestion', {
        'channel.id': channel.id,
        prefix,
      }),
    );
  }

  entry.enabled = enabled;
  settings.markModified('honeypotChannels');
  await settings.save();
  settingsCache.invalidate(guild.id);

  return message.reply(
    `Honeypot in <#${channel.id}> is now **${enabled ? 'enabled' : 'disabled'}**.` +
      (!enabled ? ' It will not take action until re-enabled.' : ''),
  );
}

async function setAlertRole(message: Message, guild: Guild, args: string[], prefix = '!') {
  const settings = await GuildSettings.getOrCreate(guild.id);
  const lang = normalizeLocale(settings?.language);
  const [roleArg] = args;
  if (!roleArg) {
    return message.reply(t(lang, 'auditCatalog.commands.admin.honeypot.l258_reply', { prefix }));
  }

  if (roleArg.toLowerCase() === 'clear') {
    settings.honeypotAlertRoleId = null;
    await settings.save();
    settingsCache.invalidate(guild.id);
    return message.reply(t(lang, 'auditCatalog.commands.admin.honeypot.l267_reply'));
  }

  const roleId = parseRoleId(roleArg);
  if (!roleId) return message.reply(t(lang, 'auditCatalog.commands.admin.honeypot.l271_reply'));

  let role = guild.roles?.get(roleId);
  if (!role) {
    try {
      role = await guild.fetchRole(roleId);
    } catch {}
  }
  if (!role) return message.reply(t(lang, 'commands.generic.roleNotFound'));

  settings.honeypotAlertRoleId = roleId;
  await settings.save();
  settingsCache.invalidate(guild.id);

  return message.reply(t(lang, 'auditCatalog.commands.admin.honeypot.l283_reply', { roleId }));
}

const command: Command = {
  name: 'honeypot',
  aliases: ['hp'],
  description: [
    'Configure honeypot channels - anyone who sends a message is immediately actioned.',
    '',
    '**Subcommands:**',
    '`add <#channel> ban [days]` - ban (delete 0–7 days of messages, default 1)',
    '`add <#channel> kick` - kick',
    '`add <#channel> timeout <hours>` - timeout (1–672 hours)',
    '`add <#channel> role <@role>` - assign a role',
    '`remove <#channel>` - remove honeypot from a channel',
    '`action <#channel> <ban|kick|timeout|role> [param]` - change the action',
    '`enable <#channel>` / `disable <#channel>` - toggle without removing',
    '`info <#channel>` - show full config for one honeypot',
    '`alertrole <@role|clear>` - role to ping in mod log on every trigger',
    '`list` - show all configured honeypot channels',
  ].join('\n'),
  usage: '<subcommand> [args...]',
  category: 'admin',
  permissions: ['ManageGuild'],
  cooldown: 3,

  async execute(message, args, client, prefix = '!') {
    const guild = message.guild;
    if (!guild) return void (await message.reply(t('en', 'commands.generic.serverOnly')));

    const sub: string | undefined = args[0]?.toLowerCase();

    if (!sub || sub === 'list') return void (await showList(message, guild, prefix));
    if (sub === 'add') return void (await upsertHoneypot(message, guild, client, args.slice(1), false, prefix));
    if (sub === 'action') return void (await upsertHoneypot(message, guild, client, args.slice(1), true, prefix));
    if (sub === 'remove') return void (await removeHoneypot(message, guild, client, args.slice(1), prefix));
    if (sub === 'enable') return void (await toggleHoneypot(message, guild, client, args.slice(1), true, prefix));
    if (sub === 'disable') return void (await toggleHoneypot(message, guild, client, args.slice(1), false, prefix));
    if (sub === 'info') return void (await showInfo(message, guild, client, args.slice(1), prefix));
    if (sub === 'alertrole') return void (await setAlertRole(message, guild, args.slice(1), prefix));

    await message.reply(t('en', 'auditCatalog.commands.admin.honeypot.l324_reply', { prefix }));
  },
};

export default command;
