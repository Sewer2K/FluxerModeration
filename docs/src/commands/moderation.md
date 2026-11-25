---
outline: [2, 3]
---

# Moderation commands

::: info Prefix
Examples below use the default prefix `!`. Servers can set a shared prefix with `!setprefix` (Manage Server). Anyone can set a personal prefix with `!myprefix` that only applies to their own messages.
:::

<div class="cmd-reference">

<div class="cmd-entry" id="cmd-appeal">

## !appeal (appeals)

**Permissions:** Ban Members · **Cooldown:** 3s

**Usage:** `!appeal list [user ID] OR view <user ID> OR approve|deny|dismiss|blacklist <user ID> [note] OR link <user ID> OR config ...`

Review ban appeals from outside the server. Appeals are submitted through the link sent to banned users.

### Options

- `!appeal list [user ID]`
- `!appeal view <user ID>`
- `!appeal approve|deny|dismiss|blacklist <user ID> [note]`
- `!appeal link <user ID>`
- `!appeal config ...`

</div>
<div class="cmd-entry" id="cmd-ban">

## !ban

**Permissions:** Ban Members · **Cooldown:** 3s

**Usage:** `!ban [purge|purge=Nd] <@user or user ID> [duration] [reason]`

Ban a user from the server. Add a duration (e.g. 1h, 7d, 2w) for a temp ban that auto-unbans. Can ban users not in the server. Reason is logged.

</div>
<DangerGate title="!clear" warning="Bulk-deletes up to 1000 messages in the current channel, including the command message. Deleted messages cannot be recovered.">

<div class="cmd-entry" id="cmd-clear">

## !clear

**Permissions:** Manage Messages · **Cooldown:** 3s

**Usage:** `!clear <amount 1-1000>`

Bulk delete messages in the current channel - the command message is included in the count. Up to 1000 messages per run

</div>

</DangerGate>
<div class="cmd-entry" id="cmd-clearnotes">

## !clearnotes

**Permissions:** Moderate Members · **Cooldown:** 3s

**Usage:** `!clearnotes <@user or user ID>`

Clear all recorded staff notes from a user's history

</div>
<div class="cmd-entry" id="cmd-clearwarns">

## !clearwarns

**Permissions:** Moderate Members · **Cooldown:** 3s

**Usage:** `!clearwarns <@user or user ID>`

Clear all recorded warnings from a user's history

</div>
<div class="cmd-entry" id="cmd-givexp">

## !givexp (addxp)

**Permissions:** Moderate Members · **Cooldown:** 3s

**Usage:** `!givexp <@user> <amount>`

Award xp to a member

</div>
<div class="cmd-entry" id="cmd-kick">

## !kick

**Permissions:** Kick Members · **Cooldown:** 3s

**Usage:** `!kick <@user or user ID> [reason]`

Remove a member from the server - they can rejoin with an invite. Reason is logged to the mod log channel

</div>
<DangerGate title="!massban" warning="Bans every unique message author between two message IDs in the current channel. ClaudeCityMod asks for ✅/❌ confirmation first, but the wrong range can still ban many members at once.">

<div class="cmd-entry" id="cmd-massban">

## !massban

**Permissions:** Ban Members · **Cooldown:** 10s

**Usage:** `!massban [nopurge] <startMessageId> <endMessageId> [reason]`

Ban all unique message authors between two boundary messages in the current channel

</div>

</DangerGate>
<div class="cmd-entry" id="cmd-modlogs">

## !modlogs (cases, modlog)

**Permissions:** Moderate Members · **Cooldown:** 3s

**Usage:** `!modlogs [@user] [action:<type>] [mod:@moderator] OR case <number>`

Search moderation cases. Filter by user, action type, or moderator. Use "case &lt;number&gt;" to view a single case in detail.

### Options

- `!modlogs [@user] [action:<type>] [mod:@moderator]`
- `!modlogs case <number>`

</div>
<div class="cmd-entry" id="cmd-mute">

## !mute

**Permissions:** Moderate Members · **Cooldown:** 3s

**Usage:** `!mute <@user or user ID> [reason]`

Apply a 10-minute timeout to a member - they cannot send messages or join voice. Use !timeout for a custom duration

</div>
<div class="cmd-entry" id="cmd-note">

## !note

**Permissions:** Moderate Members · **Cooldown:** 3s

**Usage:** `!note <@user or user ID> <content>`

Add a private staff note to a user

</div>
<div class="cmd-entry" id="cmd-notes">

## !notes

**Permissions:** Moderate Members · **Cooldown:** 3s

**Usage:** `!notes [@user or user ID]`

View staff notes for a user

</div>
<div class="cmd-entry" id="cmd-removexp">

## !removexp (takexp)

**Permissions:** Moderate Members · **Cooldown:** 3s

**Usage:** `!removexp <@user> <amount>`

Remove xp from a member

</div>
<div class="cmd-entry" id="cmd-resetxp">

## !resetxp

**Permissions:** Moderate Members · **Cooldown:** 5s

**Usage:** `!resetxp <@user>`

Reset a member xp profile

</div>
<div class="cmd-entry" id="cmd-slowmode">

## !slowmode

**Permissions:** Manage Channels · **Cooldown:** 3s

**Usage:** `!slowmode <duration> or "off" to disable`

Set channel slowmode. Duration format: 10s, 5m, 1h - max 6 hours

</div>
<div class="cmd-entry" id="cmd-timeout">

## !timeout

**Permissions:** Moderate Members · **Cooldown:** 3s

**Usage:** `!timeout <@user or user ID> <duration> [reason]`

Apply a custom-length timeout to a member. Duration format: 1m, 30m, 2h, 7d - max 28 days

</div>
<div class="cmd-entry" id="cmd-unban">

## !unban

**Permissions:** Ban Members · **Cooldown:** 3s

**Usage:** `!unban <user ID> [reason]`

Remove a ban from a previously banned user. Requires their user ID (right-click their name &gt; Copy ID) also in logs

</div>
<div class="cmd-entry" id="cmd-unmute">

## !unmute

**Permissions:** Moderate Members · **Cooldown:** 3s

**Usage:** `!unmute <@user or user ID>`

Remove a Fluxer timeout from a member so they can send messages and join voice again

</div>
<div class="cmd-entry" id="cmd-warn">

## !warn

**Permissions:** Moderate Members · **Cooldown:** 3s

**Usage:** `!warn <@user or user ID> <reason>`

Issue a formal warning to a user - reason is stored and can be reviewed with !warnings or cleared with !clearwarns

</div>
<div class="cmd-entry" id="cmd-warnings">

## !warnings

**Permissions:** Moderate Members · **Cooldown:** 3s

**Usage:** `!warnings [@user or user ID]`

View the warning history for a user - shows who issued each warning and the reason. Leave blank to see your own

</div>

</div>
