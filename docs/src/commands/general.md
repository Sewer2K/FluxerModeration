---
outline: [2, 3]
---

# General commands

::: info Prefix
Examples below use the default prefix `!`. Servers can set a shared prefix with `!setprefix` (Manage Server). Anyone can set a personal prefix with `!myprefix` that only applies to their own messages.
:::

<div class="cmd-reference">

<div class="cmd-entry" id="cmd-help">

## !help

**Permissions:** None · **Cooldown:** 5s

**Usage:** `!help [command/category]`

Show all commands, detailed info for one command, or a specific category page.

</div>
<div class="cmd-entry" id="cmd-invite-me">

## !invite-me (inv)

**Permissions:** None · **Cooldown:** 5s

**Usage:** `!invite-me`

Get the bot invite link to add ClaudeCityMod to your server.

</div>
<div class="cmd-entry" id="cmd-leaderboard">

## !leaderboard (lb, top)

**Permissions:** None · **Cooldown:** 5s

**Usage:** `!leaderboard [weekly|monthly]`

Show the top members by xp

</div>
<DangerGate title="!mydata" warning="!mydata delete permanently removes your personal prefix, warnings, moderation history references, ticket data, and usage stats. It cannot be undone.">

<div class="cmd-entry" id="cmd-mydata">

## !mydata

**Permissions:** None · **Cooldown:** 30s

**Usage:** `!mydata <export|delete|info>`

View, export, or delete all data ClaudeCityMod stores about you

### Subcommands

**Data ClaudeCityMod stores about you:**
- Personal prefix (if set via `!myprefix`)
- Warnings you have received in servers
- Moderation actions involving you (as target or moderator)
- Ticket messages you sent in ticket channels
- Command usage statistics
- Global ban entry (if applicable)

`!mydata export` - get a file with all your data
`!mydata delete` - permanently delete all your data

</div>

</DangerGate>
<div class="cmd-entry" id="cmd-myprefix">

## !myprefix (mp)

**Permissions:** None · **Cooldown:** 5s

**Usage:** `!myprefix <prefix> OR clear OR view`

Set a personal prefix that works for you across all servers

### Options

- `!myprefix <prefix>`
- `!myprefix clear`
- `!myprefix view`

</div>
<div class="cmd-entry" id="cmd-ping">

## !ping

**Permissions:** None · **Cooldown:** 3s

**Usage:** `!ping`

Check if the bot is online and see the round-trip response time

</div>
<div class="cmd-entry" id="cmd-rank">

## !rank (level, xp)

**Permissions:** None · **Cooldown:** 3s

**Usage:** `!rank [@user]`

Check your level and xp (or someone elses)

</div>
<div class="cmd-entry" id="cmd-report">

## !report

**Permissions:** None · **Cooldown:** 300s

**Usage:** `!report <your message>`

Privately alert the staff team about an issue. Your message is deleted immediately - other members will not know you reported anything.

**How it works:**
`!report <your message>` - your message is deleted on the spot and only staff can see it in their private channel.

**Tip for server staff:** There is also a dedicated report inbox channel available (`!setstaff reportchannel`). Members can type there directly without using any command - the bot deletes every message instantly and forwards it to staff.
To keep the inbox fully private, set **Read Message History** to off for `@everyone` in that channel - members will only ever see an empty channel when they open it.

</div>

</div>
