---
outline: [2, 3]
---

# Info commands

::: info Prefix
Examples below use the default prefix `!`. Servers can set a shared prefix with `!setprefix` (Manage Server). Anyone can set a personal prefix with `!myprefix` that only applies to their own messages.
:::

<div class="cmd-reference">

<div class="cmd-entry" id="cmd-botinfo">

## !botinfo

**Permissions:** None · **Cooldown:** 5s

**Usage:** `!botinfo`

Show bot stats - version, uptime, memory usage, and how many servers it is in

</div>
<div class="cmd-entry" id="cmd-inrole">

## !inrole

**Permissions:** None · **Cooldown:** 10s

**Usage:** `!inrole <@role or role ID> [starting page]`

List every member who has a specific role

</div>
<div class="cmd-entry" id="cmd-roleinfo">

## !roleinfo

**Permissions:** None · **Cooldown:** 3s

**Usage:** `!roleinfo <@role or role ID>`

Show details about a role - ID, color, position, hoisted, and mentionable status

</div>
<div class="cmd-entry" id="cmd-rolelist">

## !rolelist

**Permissions:** None · **Cooldown:** 5s

**Usage:** `!rolelist`

Show all roles in this server sorted by position

</div>
<div class="cmd-entry" id="cmd-serverinfo">

## !serverinfo

**Permissions:** None · **Cooldown:** 5s

**Usage:** `!serverinfo`

Show server stats - owner, member count, channels, roles, and creation date

</div>
<div class="cmd-entry" id="cmd-starboard">

## !starboard (sb)

**Permissions:** None · **Cooldown:** 3s

**Usage:** `!starboard <subcommand> [args]`

Configure up to three starboards for your server.
Subcommands: setup, threshold, emoji, toggle, selfstar, ignorechannel, ignorerole, settings, leaderboard, top, stats, force, remove

### Subcommands

**Public**

- `!starboard leaderboard [#board]`
- `!starboard top [#board]`
- `!starboard stats [#board]`

**Admin (Manage Server)**

- `!starboard setup #channel`
- `!starboard threshold <1-100> [#board]`
- `!starboard emoji <emoji> [#board]`
- `!starboard toggle [#board]`
- `!starboard selfstar [#board]`
- `!starboard ignorechannel #channel [#board]`
- `!starboard ignorerole @role [#board]`
- `!starboard settings`
- `!starboard force <messageLink|messageId> [channelId]`
- `!starboard remove <messageId> [#board]`

</div>
<div class="cmd-entry" id="cmd-uptime">

## !uptime

**Permissions:** None · **Cooldown:** 5s

**Usage:** `!uptime`

Show how long the bot has been running since its last restart

</div>
<div class="cmd-entry" id="cmd-userinfo">

## !userinfo

**Permissions:** None · **Cooldown:** 5s

**Usage:** `!userinfo [@user or user ID]`

Show profile info for a user - account age, server join date, roles, and timeout status. Leave blank for your own info

</div>

</div>
