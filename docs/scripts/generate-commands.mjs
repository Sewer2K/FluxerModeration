#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const COMMANDS_DIR = path.join(REPO_ROOT, 'src/commands');
const OUT_DIR = path.join(REPO_ROOT, 'docs/src/commands');
const EN_LOCALE = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'src/locales/en.json'), 'utf8'));

const CATEGORY_ORDER = ['moderation', 'admin', 'info', 'general'];
const CATEGORY_LABELS = {
  moderation: 'Moderation',
  admin: 'Admin',
  info: 'Info',
  general: 'General',
};

const PERM_LABELS = {
  Administrator: 'Administrator',
  ManageGuild: 'Manage Server',
  ManageRoles: 'Manage Roles',
  ManageChannels: 'Manage Channels',
  ManageMessages: 'Manage Messages',
  ModerateMembers: 'Moderate Members',
  BanMembers: 'Ban Members',
  KickMembers: 'Kick Members',
};

const DANGEROUS_COMMANDS = {
  massban:
    'Bans every unique message author between two message IDs in the current channel. ClaudeCityMod asks for ✅/❌ confirmation first, but the wrong range can still ban many members at once.',
  roleall:
    'Assigns a role to every non-bot member in the server. Members who already have the role are skipped, but picking the wrong role affects everyone.',
  roleclear:
    'Removes a role from every member who currently has it. There is no bulk undo - you would need to run !roleall again.',
  lockdown:
    'Locks the entire server by denying Send Messages and Add Reactions for @everyone (and configured roles) in all text channels until you run !lockdown again.',
  globalban:
    'Can enable cross-server ban enforcement for your server. Owner-only subcommands add or remove users from the global ban list and support mass bans.',
  honeypot:
    'Anyone who sends a message in a honeypot channel is immediately banned, kicked, timed out, or given a role. Misconfigured channels catch normal members.',
  clear:
    'Bulk-deletes up to 1000 messages in the current channel, including the command message. Deleted messages cannot be recovered.',
  mydata:
    '!mydata delete permanently removes your personal prefix, warnings, moderation history references, ticket data, and usage stats. It cannot be undone.',
};

function walkTsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkTsFiles(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

function extractCommandBlock(content) {
  const marker = 'const command: Command = {';
  const start = content.indexOf(marker);
  if (start === -1) return null;

  const bodyStart = start + marker.length;
  const executeIdx = content.indexOf('\n  async execute', bodyStart);
  const exportIdx = content.indexOf('\nexport default command', bodyStart);
  const end = [executeIdx, exportIdx].filter((i) => i > bodyStart).sort((a, b) => a - b)[0];
  if (!end) return null;
  return content.slice(bodyStart, end);
}

const BRANDING_DOCS = {
  publicName: 'ClaudeCityMod',
  fullName: 'ClaudeCityMod',
  dataName: 'claudecitymod',
  rssUserAgentName: 'ClaudeCityModRSS',
  socialsUserAgentName: 'ClaudeCityMod',
};

function resolveBrandingPlaceholders(text) {
  return String(text).replace(/\$\{config\.branding\.(\w+)\}/g, (_, key) => BRANDING_DOCS[key] ?? 'ClaudeCityMod');
}

function stripEmDash(text) {
  return String(text)
    .replace(/\s*\u2014\s*/g, ' - ')
    .replace(/\s*\u2013\s*/g, '-')
    .replace(/\u2011/g, '-');
}

function decodeUnicode(text) {
  return String(text).replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function extractQuotedField(block, field) {
  const fieldRe = new RegExp(`${field}:\\s*(?:\\n\\s*)?`);
  const match = fieldRe.exec(block);
  if (!match) return null;

  let i = match.index + match[0].length;
  while (i < block.length && /\s/.test(block[i])) i++;
  if (i >= block.length) return null;

  const quote = block[i];
  if (!['"', "'", '`'].includes(quote)) return null;

  i++;
  let out = '';
  while (i < block.length) {
    const ch = block[i];
    if (ch === '\\') {
      const next = block[i + 1];
      if (next === 'u') {
        const hex = block.slice(i + 2, i + 6);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          out += String.fromCharCode(parseInt(hex, 16));
          i += 6;
          continue;
        }
      }
      out += next ?? '';
      i += 2;
      continue;
    }
    if (ch === quote) {
      return stripEmDash(decodeUnicode(out).trim());
    }
    out += ch;
    i++;
  }
  return null;
}

function extractArrayStringLiterals(arrayBody) {
  const parts = [];
  let i = 0;
  while (i < arrayBody.length) {
    while (i < arrayBody.length && /[\s,]/.test(arrayBody[i])) i++;
    if (i >= arrayBody.length) break;

    const quote = arrayBody[i];
    if (quote !== "'" && quote !== '"') {
      i++;
      continue;
    }

    i++;
    let out = '';
    while (i < arrayBody.length) {
      const ch = arrayBody[i];
      if (ch === '\\') {
        const next = arrayBody[i + 1];
        if (next === 'u') {
          const hex = arrayBody.slice(i + 2, i + 6);
          if (/^[0-9a-fA-F]{4}$/.test(hex)) {
            out += String.fromCharCode(parseInt(hex, 16));
            i += 6;
            continue;
          }
        }
        out += next ?? '';
        i += 2;
        continue;
      }
      if (ch === quote) {
        parts.push(stripEmDash(decodeUnicode(out)));
        i++;
        break;
      }
      out += ch;
      i++;
    }
  }
  return parts;
}

function extractFullDescription(block) {
  const quoted = extractQuotedField(block, 'description');
  if (quoted) return quoted;

  const arrayRe = /description:\s*\[([\s\S]*?)\](?:\.join\([^)]+\))?,/;
  const arrayMatch = block.match(arrayRe);
  if (arrayMatch) {
    return extractArrayStringLiterals(arrayMatch[1]).join('\n');
  }

  return '';
}

function extractPermissions(block) {
  const m = block.match(/permissions:\s*\[([^\]]*)\]/);
  if (!m) return [];
  const raw = [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]);
  return raw.map((p) => PERM_LABELS[p] ?? p);
}

function formatPermissions(perms) {
  if (!perms.length) return 'None';
  return perms.join(', ');
}

function formatUsageLine(name, usage) {
  if (!usage) return `\`!${name}\``;
  let s = stripEmDash(usage.trim()).replace(/\s\|\s/g, ' OR ');
  return `\`!${name} ${s}\``;
}

function withPrefix(text) {
  return stripEmDash(String(text).replace(/\{prefix\}/g, '!'));
}

function expandPipeUsage(name, usage) {
  if (!usage || usage.includes('<subcommand>')) return '';

  let s = stripEmDash(usage.trim());
  const angleAlt = s.match(/^<([^>]+)>(.*)$/);
  if (angleAlt && angleAlt[1].includes('|')) {
    const alts = angleAlt[1].split('|');
    const rest = angleAlt[2].trim();
    return alts
      .map((alt) => {
        const tail = rest ? ` ${rest.replace(/^\s*/, '')}` : '';
        return `- ${formatUsageLine(name, `${alt}${tail}`)}`;
      })
      .join('\n');
  }

  const segments = s.includes(' | ') ? s.split(/\s\|\s/) : s.split(/\s+OR\s+/);
  if (segments.length < 2) return '';

  return segments
    .map((part) => `- ${formatUsageLine(name, part.trim())}`)
    .join('\n');
}

function formatHelpFields(fields) {
  return fields
    .filter(([, value]) => value)
    .map(([name, value]) => `**${withPrefix(name)}**\n\n${withPrefix(value)}`)
    .join('\n\n');
}

function getExtraHelp(cmd) {
  const en = EN_LOCALE;

  switch (cmd.name) {
    case 'automod': {
      const h = en.commands.admin.automod.help;
      return formatHelpFields([
        [h.fieldStatusName, h.fieldStatusValue],
        [h.fieldLevelName, h.fieldLevelValue],
        [h.fieldSpamName, h.fieldSpamValue],
        [h.fieldLinkName, h.fieldLinkValue],
        [h.fieldReactionSpamName, h.fieldReactionSpamValue],
        [h.fieldGhostPingName, h.fieldGhostPingValue],
        [h.fieldExemptRoleName, h.fieldExemptRoleValue],
        [h.fieldExemptChannelName, h.fieldExemptChannelValue],
      ]);
    }
    case 'ticket': {
      const t = en.commands.admin.ticket;
      const setup = t.setup;
      return [
        withPrefix(t.help.body),
        '',
        '**Setup subcommands**',
        '',
        `- ${withPrefix(setup.category.usage)}`,
        `- ${withPrefix(setup.channel.setupFirst)}`,
        `- ${withPrefix(setup.channel.created)}`,
        `- ${withPrefix(setup.role.generalListUsage)}`,
        `- ${withPrefix(setup.log.usage)}`,
        `- ${withPrefix(setup.max.usage)}`,
        `- ${withPrefix(setup.message.usage)}`,
      ].join('\n');
    }
    case 'mydata':
      return withPrefix(en.commands.mydata.info);
    case 'reactionrole': {
      const h = en.commands.admin.reactionrole.help;
      return formatHelpFields([
        [h.fieldPostName, h.fieldPostValue],
        [h.fieldAddName, h.fieldAddValue],
        [h.fieldAddMultiName, h.fieldAddMultiValue],
        [h.fieldRemoveName, h.fieldRemoveValue],
        [h.fieldEditName, h.fieldEditValue],
        [h.fieldClearName, h.fieldClearValue],
        [h.fieldListName, h.fieldListValue],
        [h.fieldDmName, h.fieldDmValue],
        [h.fieldSwitchName, h.fieldSwitchValue],
      ]);
    }
    case 'starboard':
      return [
        '**Public**',
        '',
        '- `!starboard leaderboard [#board]`',
        '- `!starboard top [#board]`',
        '- `!starboard stats [#board]`',
        '',
        '**Admin (Manage Server)**',
        '',
        '- `!starboard setup #channel`',
        '- `!starboard threshold <1-100> [#board]`',
        '- `!starboard emoji <emoji> [#board]`',
        '- `!starboard toggle [#board]`',
        '- `!starboard selfstar [#board]`',
        '- `!starboard ignorechannel #channel [#board]`',
        '- `!starboard ignorerole @role [#board]`',
        '- `!starboard settings`',
        '- `!starboard force <messageLink|messageId> [channelId]`',
        '- `!starboard remove <messageId> [#board]`',
      ].join('\n');
    case 'rss':
      return [
        '- `!rss add <#channel> <url|/rsshub/route> [@role]`',
        '- `!rss list`',
        '- `!rss remove <index|feedId>`',
        '- `!rss pause <index|feedId>`',
        '- `!rss resume <index|feedId>`',
        '- `!rss interval <minutes>`',
        '- `!rss test <index|feedId|url|/rsshub/route>`',
        '- `!rss status`',
        '- `!rss debug [index|feedId]` (owner only)',
        '- `!rss forcepoll [index|feedId]` (owner only)',
      ].join('\n');
    case 'customcommand': {
      const cc = en.auditCatalog.commands.admin.customcommand;
      return formatHelpFields([
        [cc.l223_addFields_name, cc.l223_addFields_value],
        [cc.l224_addFields_name, cc.l224_addFields_value],
        [cc.l225_addFields_name, cc.l225_addFields_value],
        [cc.l226_addFields_name, cc.l226_addFields_value],
        [cc.l227_addFields_name, cc.l227_addFields_value],
        [cc.l228_addFields_name, cc.l228_addFields_value],
      ]);
    }
    case 'globalban':
      return [
        '**Server commands (Manage Server)**',
        '',
        '- `!globalban on` - enable global ban protection',
        '- `!globalban off` - disable global ban protection',
        '- `!globalban status` - check current setting',
        '- `!globalban list` - download ban list as JSON',
        '',
        '**Ban list management (bot owner only)**',
        '',
        '- `!globalban <userId> <reason> [--evidence <url>]` - add to global ban list',
        '- `!globalban <id1,id2,id3,...> <reason> [--evidence <url>]` - mass ban',
        '- `!globalban remove <userId>` - remove from list',
        '- `!globalban check <userId>` - check if a user is banned',
      ].join('\n');
    case 'lockdown':
      return [
        'Run `!lockdown` with no arguments to lock or unlock the server.',
        '',
        '**Config**',
        '',
        '- `!lockdown config` - view current settings',
        '- `!lockdown config addrole @Role` - add a role to lock during lockdown',
        '- `!lockdown config removerole @Role` - remove a role from lockdown targets',
        '- `!lockdown config allow @Role/@User` - grant lockdown command access',
        '- `!lockdown config deny @Role/@User` - revoke lockdown command access',
        '',
        '**Owner DM usage**',
        '',
        '- `!lockdown start <server ID>` - lock down a server',
        '- `!lockdown end <server ID>` - lift a lockdown',
      ].join('\n');
    case 'language':
      return withPrefix(en.language.usage);
    default:
      return '';
  }
}

function hasSubcommandSection(text) {
  return /\*\*Subcommands:\*\*/i.test(text) || /\*\*Usage:\*\*/i.test(text) || /\*\*Send as the bot:\*\*/i.test(text);
}

function escapeVueAngles(text) {
  const parts = String(text).split('`');
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part;
      return part.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    })
    .join('`');
}

const LIST_SECTION_HEADING =
  /^\*\*(Subcommands|Usage|Send as the bot|Categories|Setup subcommands|Public|Admin|Server commands|Ban list management|Config|Owner DM usage|Options):\*\*$/i;

const LIST_SECTION_BOLD = /^\*\*(Public|Admin \(Manage Server\))\*\*$/;

function isSubcommandLine(line) {
  return /^`/.test(line) || /^!\w/.test(line);
}

function toBullet(line) {
  const trimmed = line.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('- ')) return trimmed;
  return `- ${trimmed}`;
}

function formatMarkdownContent(text) {
  const lines = escapeVueAngles(text.trim()).split('\n');
  const out = [];
  let listMode = false;
  let detailBlock = false;

  for (const raw of lines) {
    const line = raw.trim();

    if (!line) {
      if (out.length && out[out.length - 1] !== '') out.push('');
      listMode = false;
      continue;
    }

    if (LIST_SECTION_HEADING.test(line) || LIST_SECTION_BOLD.test(line)) {
      detailBlock = false;
      if (out.length && out[out.length - 1] !== '') out.push('');
      out.push(line);
      out.push('');
      listMode = true;
      continue;
    }

    if (line.startsWith('**Server') || line.startsWith('**Ban list') || line.startsWith('**Config') || line.startsWith('**Owner')) {
      detailBlock = false;
      if (out.length && out[out.length - 1] !== '') out.push('');
      out.push(line);
      out.push('');
      listMode = true;
      continue;
    }

    if (line.startsWith('**!')) {
      if (out.length && out[out.length - 1] !== '') out.push('');
      out.push(line);
      out.push('');
      detailBlock = true;
      listMode = false;
      continue;
    }

    if ((listMode || detailBlock) && isSubcommandLine(line)) {
      out.push(toBullet(line));
      continue;
    }

    if (line.startsWith('- `') || line.startsWith('- !')) {
      detailBlock = false;
      out.push(line);
      listMode = true;
      continue;
    }

    if (detailBlock) {
      out.push(line);
      continue;
    }

    listMode = false;
    out.push(line);
  }

  return out.join('\n');
}

function escapeHtmlAttr(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function commandHref(name, category) {
  return `/commands/${category}#cmd-${name}`;
}

function commandLink(name, category) {
  return `[\`!${name}\`](${commandHref(name, category)})`;
}

function renderCommandSection(cmd) {
  const title = cmd.aliases.length ? `!${cmd.name} (${cmd.aliases.join(', ')})` : `!${cmd.name}`;
  const gateTitle = cmd.aliases.length ? `!${cmd.name}` : `!${cmd.name}`;
  const meta = [];
  meta.push(`**Permissions:** ${formatPermissions(cmd.permissions)}`);
  if (cmd.cooldown) meta.push(`**Cooldown:** ${cmd.cooldown}s`);

  const parts = [
    `## ${title}`,
    '',
    meta.join(' · '),
    '',
    `**Usage:** ${formatUsageLine(cmd.name, cmd.usage)}`,
    '',
  ];

  const body = cmd.description.trim();
  if (body) {
    parts.push(formatMarkdownContent(body), '');
  }

  const extra = getExtraHelp(cmd);
  if (extra) {
    if (!hasSubcommandSection(body)) {
      parts.push('### Subcommands', '', formatMarkdownContent(extra), '');
    } else if (cmd.name === 'automod' || cmd.name === 'starboard') {
      parts.push('### Detailed reference', '', formatMarkdownContent(extra), '');
    }
  }

  const pipeOptions = expandPipeUsage(cmd.name, cmd.usage);
  if (pipeOptions && !hasSubcommandSection(body) && !extra) {
    parts.push('### Options', '', pipeOptions, '');
  }

  const inner = `<div class="cmd-entry" id="cmd-${cmd.name}">\n\n${parts.join('\n').trimEnd()}\n\n</div>`;
  const dangerWarning = DANGEROUS_COMMANDS[cmd.name];
  if (!dangerWarning) return inner;

  return `<DangerGate title="${escapeHtmlAttr(gateTitle)}" warning="${escapeHtmlAttr(dangerWarning)}">\n\n${inner}\n\n</DangerGate>`;
}

function parseCommandFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const block = extractCommandBlock(content);
  if (!block) return null;

  const name = extractQuotedField(block, 'name');
  const category = extractQuotedField(block, 'category');
  if (!name || !category) return null;

  const ownerOnly = /ownerOnly:\s*true/.test(block);
  const hidden = /hidden:\s*true/.test(block);
  if (ownerOnly || hidden) return null;

  const usage = extractQuotedField(block, 'usage') ?? '';
  const description = extractFullDescription(block);
  const permissions = extractPermissions(block);
  const aliases = [];
  const aliasMatch = block.match(/aliases:\s*\[([^\]]*)\]/);
  if (aliasMatch) {
    for (const a of aliasMatch[1].matchAll(/['"]([^'"]+)['"]/g)) aliases.push(a[1]);
  }

  const cooldownMatch = block.match(/cooldown:\s*(\d+)/);
  const cooldown = cooldownMatch ? Number(cooldownMatch[1]) : 0;

  return {
    name,
    category,
    usage,
    description: resolveBrandingPlaceholders(description),
    permissions,
    aliases,
    cooldown,
  };
}

function renderCategoryPage(category, commands) {
  const label = CATEGORY_LABELS[category] ?? category;
  const sorted = [...commands].sort((a, b) => a.name.localeCompare(b.name));
  const sections = sorted.map(renderCommandSection).join('\n');

  return `---
outline: [2, 3]
---

# ${label} commands

::: info Prefix
Examples below use the default prefix \`!\`. Servers can set a shared prefix with \`!setprefix\` (Manage Server). Anyone can set a personal prefix with \`!myprefix\` that only applies to their own messages.
:::

<div class="cmd-reference">

${sections}

</div>
`;
}

function renderIndex(counts) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const lines = CATEGORY_ORDER.map((cat) => {
    const n = counts[cat] ?? 0;
    const label = CATEGORY_LABELS[cat];
    return `- [${label}](/commands/${cat}) - ${n}`;
  }).join('\n');

  return `---
outline: deep
---

# Command reference

${total} public commands. Owner-only commands omitted.

${lines}

## Examples

| Category | Examples |
| - | - |
| [Moderation](/commands/moderation) | ${commandLink('ban', 'moderation')}, ${commandLink('warn', 'moderation')}, ${commandLink('clear', 'moderation')}, ${commandLink('timeout', 'moderation')} |
| [Admin](/commands/admin) | ${commandLink('automod', 'admin')}, ${commandLink('welcome', 'admin')}, ${commandLink('ticket', 'admin')}, ${commandLink('leveling', 'admin')} |
| [Info](/commands/info) | ${commandLink('serverinfo', 'info')}, ${commandLink('userinfo', 'info')}, ${commandLink('starboard', 'info')} |
| [General](/commands/general) | ${commandLink('help', 'general')}, ${commandLink('rank', 'general')}, ${commandLink('leaderboard', 'general')}, ${commandLink('ping', 'general')} |
`;
}

function main() {
  const files = walkTsFiles(COMMANDS_DIR);
  const byCategory = Object.fromEntries(CATEGORY_ORDER.map((c) => [c, []]));
  const skipped = [];

  for (const file of files) {
    const cmd = parseCommandFile(file);
    if (!cmd) {
      skipped.push(path.relative(COMMANDS_DIR, file));
      continue;
    }
    if (!byCategory[cmd.category]) {
      console.warn(`Unknown category "${cmd.category}" for ${cmd.name} (${file})`);
      continue;
    }
    byCategory[cmd.category].push(cmd);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const counts = {};
  for (const cat of CATEGORY_ORDER) {
    counts[cat] = byCategory[cat].length;
    const outPath = path.join(OUT_DIR, `${cat}.md`);
    const page = renderCategoryPage(cat, byCategory[cat]);
    if (page.includes('${config.branding')) {
      console.error(`Unresolved branding placeholder in ${outPath}`);
      process.exit(1);
    }
    fs.writeFileSync(outPath, page);
    console.log(`Wrote ${outPath} (${counts[cat]} commands)`);
  }

  fs.writeFileSync(path.join(OUT_DIR, 'index.md'), renderIndex(counts));

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(`\nTotal: ${total} commands`);
  if (skipped.length) {
    console.log(`Skipped ${skipped.length} files (no command export or owner/hidden): ${skipped.join(', ')}`);
  }

  if (total < 60) {
    console.error(`Expected at least 60 commands, got ${total}`);
    process.exit(1);
  }
}

main();
