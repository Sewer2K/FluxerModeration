import type { Guild, Message } from '@fluxerjs/core';
import type { Command, IKeywordEntry, IKeywordWarnings, KeywordEntryAction } from '@/types';
import GuildSettings from '@/models/GuildSettings';
import settingsCache from '@/utils/settingsCache';
import { t, normalizeLocale } from '@/i18n';
import { KEYWORD_MAX_PER_GUILD } from '@/utils/keywordDefaults';
import { buildKeywordMatcher, keywordMatchLabel } from '@/utils/keywordMatch';
import { isInUnion } from '@/utils/isInUnion';
import { messageFromError } from '@/utils/messageFromError';

function invalidate(guildId: string) {
  settingsCache.invalidate(guildId);
}

async function showList(message: Message, guild: Guild, prefix: string) {
  const settings = await GuildSettings.getOrCreate(guild.id);
  const lang = normalizeLocale(settings?.language);
  const kw = settings.keywordWarnings;
  const keywords = kw?.keywords || [];

  const statusLine = kw?.enabled
    ? t(lang, 'commands.admin.keywords.statusEnabled')
    : t(lang, 'commands.admin.keywords.statusDisabled');
  const actionLine = t(lang, 'commands.admin.keywords.actionLine', { action: kw?.action || 'delete+warn' });

  if (!keywords.length) {
    return message.reply(t(lang, 'commands.admin.keywords.showListEmpty', { statusLine, actionLine, prefix }));
  }

  const list = keywords
    .map((k, i) => {
      const tag = k.isRegex ? '`regex`' : '`plain`';
      const match = k.isRegex ? '' : ` · ${keywordMatchLabel(k.matchType)}`;
      const lbl = k.label ? ` *(${k.label})*` : '';
      const action = k.action && k.action !== 'inherit' ? ` · action: \`${k.action}\`` : '';

      return `**${i + 1}.** ${tag} \`${k.pattern}\`${match}${lbl}${action}`;
    })
    .join('\n');

  await message.reply(
    t(lang, 'commands.admin.keywords.showList', {
      statusLine,
      actionLine,
      list,
      usedCount: keywords.length,
      max: KEYWORD_MAX_PER_GUILD,
    }),
  );
}

async function setEnabled(message: Message, guild: Guild, enabled: boolean) {
  const settings = await GuildSettings.getOrCreate(guild.id);
  const lang = normalizeLocale(settings?.language);
  settings.keywordWarnings.enabled = enabled;
  await settings.save();
  invalidate(guild.id);

  await message.reply(
    enabled
      ? t(lang, 'commands.admin.keywords.setEnabledEnabled')
      : t(lang, 'commands.admin.keywords.setEnabledDisabled'),
  );
}

async function addKeyword(message: Message, guild: Guild, args: string[], prefix: string) {
  const settings = await GuildSettings.getOrCreate(guild.id);
  const lang = normalizeLocale(settings?.language);

  if (!args.length) {
    return message.reply(t(lang, 'commands.admin.keywords.addUsage', { prefix }));
  }

  const keywordActions = ['inherit', 'warn', 'delete', 'delete+warn', 'mute', 'ban'] as const;
  let entryAction: KeywordEntryAction = 'inherit';
  let addArgs = args;
  const actionArg = addArgs[0]?.toLowerCase().startsWith('action:')
    ? addArgs[0].slice('action:'.length).toLowerCase()
    : undefined;
  if (actionArg && isInUnion(actionArg, keywordActions)) {
    entryAction = actionArg;
    addArgs = addArgs.slice(1);
  }

  let isRegex = false;
  let matchType: 'any' | 'word' = 'any';
  let pattern: string;
  let argOffset = 0;

  if (addArgs[0]?.toLowerCase() === 'word') {
    matchType = 'word';
    argOffset = 1;
  } else if (addArgs[0]?.toLowerCase() === 'any') {
    matchType = 'any';
    argOffset = 1;
  }

  const rest = addArgs.slice(argOffset);

  if (rest[0]?.toLowerCase() === 'regex') {
    isRegex = true;
    pattern = rest.slice(1).join(' ').trim();
    if (!pattern) return message.reply(t(lang, 'commands.admin.keywords.regexPatternRequired'));

    try {
      new RegExp(pattern, 'i');
    } catch (e) {
      return message.reply(t(lang, 'commands.admin.keywords.invalidRegexPattern', { error: `${messageFromError(e)}` }));
    }

    const { isSafeRegex } = await import('../../utils/safeRegex');
    const check = isSafeRegex(pattern);
    if (!check.safe) {
      return message.reply(t(lang, 'commands.admin.keywords.regexRejected', { reason: check.reason }));
    }
  } else {
    pattern = rest.join(' ').trim();
  }

  // handle unmigrated data
  settings.keywordWarnings ??= {
    // values assumed to be populated in later calls
  } as IKeywordWarnings;
  settings.keywordWarnings.keywords ??= [];

  if (settings.keywordWarnings.keywords.length >= KEYWORD_MAX_PER_GUILD) {
    return message.reply(t(lang, 'commands.admin.keywords.maxKeywordsReached', { max: KEYWORD_MAX_PER_GUILD }));
  }

  const duplicate = settings.keywordWarnings.keywords.find((k) => k.pattern === pattern && k.isRegex === isRegex);
  if (duplicate) return message.reply(t(lang, 'commands.admin.keywords.duplicatePattern'));

  const entry: IKeywordEntry = {
    pattern,
    isRegex,
    matchType,
    addedBy: message.author.id,
    label: null,
    action: entryAction,
  };
  settings.keywordWarnings.keywords.push(entry);
  settings.markModified('keywordWarnings');
  await settings.save();
  invalidate(guild.id);

  const tag = isRegex
    ? t(lang, 'commands.admin.keywords.tagRegexPattern')
    : t(lang, 'commands.admin.keywords.tagKeyword');
  await message.reply(
    t(lang, 'commands.admin.keywords.added', {
      tag,
      pattern,
      prefix,
    }),
  );
}

async function removeKeyword(message: Message, guild: Guild, numArg: string, prefix: string) {
  const num = parseInt(numArg, 10);
  const settings = await GuildSettings.getOrCreate(guild.id);
  const lang = normalizeLocale(settings?.language);
  const keywords = settings.keywordWarnings?.keywords || [];

  if (isNaN(num) || num < 1 || num > keywords.length) {
    return message.reply(t(lang, 'commands.admin.keywords.removeInvalidNumber', { max: keywords.length, prefix }));
  }

  const removed = keywords.splice(num - 1, 1)[0]!; /* definitely contains the element */
  settings.markModified('keywordWarnings');
  await settings.save();
  invalidate(guild.id);

  await message.reply(t(lang, 'commands.admin.keywords.removed', { num, pattern: removed.pattern }));
}

async function setAction(message: Message, guild: Guild, action: string) {
  const VALID_ACTIONS = ['warn', 'delete', 'delete+warn'] as const;
  const actionLower = action.toLowerCase();
  if (!action || !isInUnion(actionLower, VALID_ACTIONS)) {
    return message.reply(t('en', 'commands.admin.keywords.validActions'));
  }

  const settings = await GuildSettings.getOrCreate(guild.id);
  const lang = normalizeLocale(settings?.language);
  settings.keywordWarnings.action = actionLower;
  settings.markModified('keywordWarnings');
  await settings.save();
  invalidate(guild.id);

  const descriptions: Record<string, string> = {
    warn: t(lang, 'commands.admin.keywords.actionWarn'),
    delete: t(lang, 'commands.admin.keywords.actionDelete'),
    'delete+warn': t(lang, 'commands.admin.keywords.actionDeleteWarn'),
  };

  await message.reply(
    t(lang, 'commands.admin.keywords.actionSetDone', {
      action: actionLower,
      description: descriptions[actionLower],
    }),
  );
}

async function testKeywords(message: Message, guild: Guild, text: string, prefix: string) {
  const settings = await GuildSettings.getOrCreate(guild.id);
  const lang = normalizeLocale(settings?.language);
  if (!text) return message.reply(t(lang, 'commands.admin.keywords.testMissingText', { prefix }));
  const keywords = settings.keywordWarnings?.keywords || [];
  if (!keywords.length) return message.reply(t(lang, 'commands.admin.keywords.noKeywordsConfigured'));

  const hits = keywords
    .map((k, i) => {
      const matched = buildKeywordMatcher(k)(text);
      return matched ? `**${i + 1}.** \`${k.pattern}\`` : null;
    })
    .filter(Boolean);

  if (!hits.length) {
    const preview = text.slice(0, 100);
    return message.reply(t(lang, 'commands.admin.keywords.noKeywordsMatched', { preview }));
  }
  return message.reply(
    t(lang, 'commands.admin.keywords.testMatches', { hitsCount: hits.length, hits: hits.join('\n') }),
  );
}

const command: Command = {
  name: 'keywords',
  description: [
    'Manage the keyword auto-warning system. When a message matches a keyword the bot can delete it, warn the member, or both.',
    '',
    '**Subcommands:**',
    '`list` - show all keywords',
    '`add <word>` - add a plain word/phrase (matches anywhere in the message)',
    '`add word <word>` - match only when the word stands alone',
    '`add any <word>` - same as add <word> (matches anywhere)',
    '`add regex <pattern>` - add a regular expression pattern',
    '`add action:<action> <word>` - override the action for one keyword (`warn`, `delete`, `delete+warn`, `mute`, `ban`, or `inherit`)',
    '`remove <number>` - remove a keyword by its list number',
    '`enable` / `disable` - turn the system on or off',
    '`action <warn|delete|delete+warn>` - set the action taken on a match',
    '`test <text>` - test whether a string would be caught',
  ].join('\n'),
  usage: '<subcommand> [args...]',
  category: 'admin',
  permissions: ['ManageGuild'],
  cooldown: 3,

  async execute(message, args, _client, prefix = '!') {
    const guild = message.guild;
    if (!guild) return void (await message.reply(t('en', 'commands.generic.serverOnly')));

    const sub = args[0]?.toLowerCase();

    if (!sub || sub === 'list') return void (await showList(message, guild, prefix));
    if (sub === 'enable') return void (await setEnabled(message, guild, true));
    if (sub === 'disable') return void (await setEnabled(message, guild, false));
    if (sub === 'add') return void (await addKeyword(message, guild, args.slice(1), prefix));
    if (sub === 'remove' && '1' in args) return void (await removeKeyword(message, guild, args[1], prefix));
    if (sub === 'action' && '1' in args) return void (await setAction(message, guild, args[1]));
    if (sub === 'test') return void (await testKeywords(message, guild, args.slice(1).join(' '), prefix));

    await message.reply(t('en', 'commands.admin.keywords.unknownSubcommand', { prefix }));
  },
};

export default command;
