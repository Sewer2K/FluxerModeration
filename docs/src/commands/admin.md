---
outline: [2, 3]
---

# Admin commands

::: info Prefix
Examples below use the default prefix `!`. Servers can set a shared prefix with `!setprefix` (Manage Server). Anyone can set a personal prefix with `!myprefix` that only applies to their own messages.
:::

<div class="cmd-reference">

<div class="cmd-entry" id="cmd-automod">

## !automod

**Permissions:** Manage Server · **Cooldown:** 3s

**Usage:** `!automod <subcommand> [args...]`

Configure every aspect of automod for your server. Run `!automod` with no arguments to see the full subcommand guide.

**Subcommands:**

- `status` - show all current automod settings
- `level <off|minimal|medium|high>` - set the overall automod preset
- `spam <messages|window|violations|timeout> <value>` - tune spam detection thresholds
- `link <allow|deny> <domain>` - manage the link filter domain allowlist
- `ghostping <on|off>` - enable or disable ghost ping detection
- `exempt role <add|remove> <@role>` - give a role full automod immunity
- `exempt channel <add|remove> <#channel>` - disable automod in a specific channel

### Detailed reference

**!automod status**

Show all current automod settings

**!automod level &lt;off|minimal|medium|high&gt;**

- `off` - disable all
- `minimal` - anti-spam only
- `medium` - anti-spam + anti-link
- `high` - anti-spam + anti-link, strict limits

**!automod spam &lt;messages|window|timeout|violations&gt; &lt;value&gt;**

Fine-tune spam detection:
- `messages` 2-20 (default 5) - `window` 1-60 s (default 5)
- `violations` 1-10 (default 3) - `timeout` 1-60 min (default 10)

**!automod link &lt;allow|deny&gt; &lt;domain&gt;**

Manage domains exempt from the link filter
Example: `!automod link allow youtube.com`

**!automod reactionspam &lt;on|off&gt;**

Enable or disable anti-reaction spam detection

**!automod ghostping &lt;on|off&gt;**

Enable or disable ghost-ping detection

**!automod exempt role &lt;add|remove&gt; &lt;@role&gt;**

Exempt a role from all automod checks

**!automod exempt channel &lt;add|remove&gt; &lt;#channel&gt;**

Disable automod in a specific channel

</div>
<div class="cmd-entry" id="cmd-autorole">

## !autorole

**Permissions:** Manage Server · **Cooldown:** 3s

**Usage:** `!autorole set <@role> OR disable OR status>`

Automatically assign a role to every new member who joins the server

### Options

- `!autorole set <@role>`
- `!autorole disable`
- `!autorole status>`

</div>
<div class="cmd-entry" id="cmd-blacklist">

## !blacklist

**Permissions:** Manage Server · **Cooldown:** 3s

**Usage:** `!blacklist add <#channel> OR remove <#channel> OR list OR clear`

Manage channels where the bot ignores commands from non-staff

### Options

- `!blacklist add <#channel>`
- `!blacklist remove <#channel>`
- `!blacklist list`
- `!blacklist clear`

</div>
<div class="cmd-entry" id="cmd-clearprefix">

## !clearprefix

**Permissions:** Manage Server · **Cooldown:** 3s

**Usage:** `!clearprefix`

Reset the server prefix to the default

</div>
<div class="cmd-entry" id="cmd-commandperms">

## !commandperms

**Permissions:** Manage Server · **Cooldown:** 3s

**Usage:** `!commandperms add <@role> OR remove <@role> OR list OR clear`

Manage which roles are allowed to use bot commands. When roles are set, only members with those roles (plus staff/admins) can use non-admin commands.

### Options

- `!commandperms add <@role>`
- `!commandperms remove <@role>`
- `!commandperms list`
- `!commandperms clear`

</div>
<div class="cmd-entry" id="cmd-customcommand">

## !customcommand (cc)

**Permissions:** Manage Server · **Cooldown:** 3s

**Usage:** `!customcommand <add|remove|edit|embed|action|list|info> [args...]`

Create and manage custom commands with configurable responses.

### Subcommands

**!customcommand add &lt;name&gt; &lt;response&gt;**

Create a new custom command

**!customcommand remove &lt;name&gt;**

Delete a custom command

**!customcommand edit &lt;name&gt; &lt;new response&gt;**

Change the response of an existing command

**!customcommand embed &lt;name&gt; &lt;on|off&gt; [color] [title]**

Toggle embed mode for a command

**!customcommand list**

List all custom commands

**!customcommand info &lt;name&gt;**

Show details of a specific command

</div>
<div class="cmd-entry" id="cmd-embed">

## !embed

**Permissions:** Manage Messages · **Cooldown:** 5s

**Usage:** `!embed send #channel <json> OR webhook <url> <json>`

Build and send a Fluxer embed from JSON.

**Send as the bot:**

- `!embed send #channel {"title":"Hello","description":"World","color":"#5865f2"}`

**Send via webhook:**
`!embed webhook https://your-fluxer-api.example/webhooks/<id>/<token> {"title":"Hello"}`

Embed JSON supports `title`, `description`, `color`, `url`, `footer`, `thumbnail`, `image`, and `fields`.

</div>
<DangerGate title="!globalban" warning="Can enable cross-server ban enforcement for your server. Owner-only subcommands add or remove users from the global ban list and support mass bans.">

<div class="cmd-entry" id="cmd-globalban">

## !globalban (gban)

**Permissions:** Manage Server · **Cooldown:** 3s

**Usage:** `!globalban <on|off|status|list> OR <add|remove|check> (owner only)`

Toggle the global ban system for your server, or manage the global ban list

### Subcommands

**Server commands (Manage Server)**

- `!globalban on` - enable global ban protection
- `!globalban off` - disable global ban protection
- `!globalban status` - check current setting
- `!globalban list` - download ban list as JSON

**Ban list management (bot owner only)**

- `!globalban <userId> <reason> [--evidence <url>]` - add to global ban list
- `!globalban <id1,id2,id3,...> <reason> [--evidence <url>]` - mass ban
- `!globalban remove <userId>` - remove from list
- `!globalban check <userId>` - check if a user is banned

</div>

</DangerGate>
<div class="cmd-entry" id="cmd-goodbye">

## !goodbye

**Permissions:** Manage Server · **Cooldown:** 3s

**Usage:** `!goodbye <subcommand> [options]`

Configure goodbye messages for your server. Run `!goodbye` with no arguments for the full guide.

**Subcommands:**

- `status` - show current goodbye configuration
- `channel <#channel>` - set the goodbye channel
- `on/off` - enable or disable goodbye messages
- `message <text>` - set custom goodbye text ({user} {username} {server} {count})
- `embed on/off` - toggle a goodbye embed (title, description, color, footer)
- `test` - preview the goodbye output

</div>
<DangerGate title="!honeypot" warning="Anyone who sends a message in a honeypot channel is immediately banned, kicked, timed out, or given a role. Misconfigured channels catch normal members.">

<div class="cmd-entry" id="cmd-honeypot">

## !honeypot (hp)

**Permissions:** Manage Server · **Cooldown:** 3s

**Usage:** `!honeypot <subcommand> [args...]`

Configure honeypot channels - anyone who sends a message is immediately actioned.

**Subcommands:**

- `add <#channel> ban [days]` - ban (delete 0-7 days of messages, default 1)
- `add <#channel> kick` - kick
- `add <#channel> timeout <hours>` - timeout (1-672 hours)
- `add <#channel> role <@role>` - assign a role
- `remove <#channel>` - remove honeypot from a channel
- `action <#channel> <ban|kick|timeout|role> [param]` - change the action
- `enable <#channel>` / `disable <#channel>` - toggle without removing
- `info <#channel>` - show full config for one honeypot
- `alertrole <@role|clear>` - role to ping in mod log on every trigger
- `list` - show all configured honeypot channels

</div>

</DangerGate>
<div class="cmd-entry" id="cmd-keywords">

## !keywords

**Permissions:** Manage Server · **Cooldown:** 3s

**Usage:** `!keywords <subcommand> [args...]`

Manage the keyword auto-warning system. When a message matches a keyword the bot can delete it, warn the member, or both.

**Subcommands:**

- `list` - show all keywords
- `add <word>` - add a plain word/phrase (matches anywhere in the message)
- `add word <word>` - match only when the word stands alone
- `add any <word>` - same as add &lt;word&gt; (matches anywhere)
- `add regex <pattern>` - add a regular expression pattern
- `add action:<action> <word>` - override the action for one keyword (`warn`, `delete`, `delete+warn`, `mute`, `ban`, or `inherit`)
- `remove <number>` - remove a keyword by its list number
- `enable` / `disable` - turn the system on or off
- `action <warn|delete|delete+warn>` - set the action taken on a match
- `test <text>` - test whether a string would be caught

</div>
<div class="cmd-entry" id="cmd-language">

## !language

**Permissions:** Manage Server · **Cooldown:** 3s

**Usage:** `!language <set|list> [code]`

Set the language used for bot messages in this server.

### Subcommands

Usage: `!language set <code>` or `!language list`

</div>
<div class="cmd-entry" id="cmd-leveling">

## !leveling (levelconfig, xpconfig)

**Permissions:** Manage Server · **Cooldown:** 3s

**Usage:** `!leveling <enable|disable|toggle|status>`

Enable, disable, or check the leveling system

### Options

- `!leveling enable`
- `!leveling disable`
- `!leveling toggle`
- `!leveling status`

</div>
<DangerGate title="!lockdown" warning="Locks the entire server by denying Send Messages and Add Reactions for @everyone (and configured roles) in all text channels until you run !lockdown again.">

<div class="cmd-entry" id="cmd-lockdown">

## !lockdown

**Permissions:** None · **Cooldown:** 10s

**Usage:** `!lockdown [config]`

Lock down the entire server by denying SendMessages and AddReactions for @everyone (and configured roles) in all text channels. Run again to unlock.

### Subcommands

Run `!lockdown` with no arguments to lock or unlock the server.

**Config**

- `!lockdown config` - view current settings
- `!lockdown config addrole @Role` - add a role to lock during lockdown
- `!lockdown config removerole @Role` - remove a role from lockdown targets
- `!lockdown config allow @Role/@User` - grant lockdown command access
- `!lockdown config deny @Role/@User` - revoke lockdown command access

**Owner DM usage**

- `!lockdown start <server ID>` - lock down a server
- `!lockdown end <server ID>` - lift a lockdown

</div>

</DangerGate>
<div class="cmd-entry" id="cmd-reactionrole">

## !reactionrole (rr)

**Permissions:** Manage Server

**Usage:** `!reactionrole <post|add|remove|edit|clear|list|dm>`

Create panels where users react with an emoji to get a role. Add --text to !rr post to show the panel outside the embed.

### Subcommands

**!rr post &lt;#channel&gt; [--text] [text]**

Bot posts an embed-only reaction role panel. Add `--text` to also show the panel outside the embed.

**!rr add &lt;#channel&gt; &lt;messageId&gt; &lt;emoji&gt; &lt;@&roleId&gt;**

Map an emoji to a role on a message
Use a role ID or mention like `<@&roleId>`. Paste Unicode emoji directly, or use a custom emoji like `<:name:id>`.

**!rr addmulti &lt;#channel&gt; &lt;messageId&gt; &lt;emoji&gt; &lt;@role1&gt; &lt;@role2&gt; ...**

Map an emoji to **multiple roles** at once (up to 10)

**!rr remove &lt;#channel&gt; &lt;messageId&gt; &lt;emoji&gt;**

Remove an emoji-role mapping

**!rr edit &lt;#channel&gt; &lt;messageId&gt; [new text]**

Edit the text of an existing reaction role panel

**!rr clear &lt;messageId&gt;**

Remove all reaction roles from a message and reset it to 0/20

**!rr list**

List all configured reaction role panels

**!rr dm &lt;on|off&gt;**

Toggle DM notifications when roles are assigned/removed

**!rr switch &lt;#channel&gt; &lt;messageId&gt; &lt;emoji&gt; &lt;@removeRole&gt; &lt;@addRole&gt;**

Map an emoji to switch roles: removes one role and adds another

</div>
<DangerGate title="!roleall" warning="Assigns a role to every non-bot member in the server. Members who already have the role are skipped, but picking the wrong role affects everyone.">

<div class="cmd-entry" id="cmd-roleall">

## !roleall

**Permissions:** Manage Roles · **Cooldown:** 30s

**Usage:** `!roleall <@role or role ID>`

Assign a role to every non-bot member in the server - members who already have it are skipped

</div>

</DangerGate>
<DangerGate title="!roleclear" warning="Removes a role from every member who currently has it. There is no bulk undo - you would need to run !roleall again.">

<div class="cmd-entry" id="cmd-roleclear">

## !roleclear

**Permissions:** Manage Roles · **Cooldown:** 30s

**Usage:** `!roleclear <@role or role ID>`

Remove a role from every member who currently has it

</div>

</DangerGate>
<div class="cmd-entry" id="cmd-rss">

## !rss

**Permissions:** Manage Server · **Cooldown:** 3s

**Usage:** `!rss <add|list|remove|pause|resume|interval|test|status|debug|forcepoll> ...`

Manage RSS subscriptions for this server.

### Subcommands

- `!rss add <#channel> <url|/rsshub/route> [@role]`
- `!rss list`
- `!rss remove <index|feedId>`
- `!rss pause <index|feedId>`
- `!rss resume <index|feedId>`
- `!rss interval <minutes>`
- `!rss test <index|feedId|url|/rsshub/route>`
- `!rss status`
- `!rss debug [index|feedId]` (owner only)
- `!rss forcepoll [index|feedId]` (owner only)

</div>
<div class="cmd-entry" id="cmd-setlog">

## !setlog

**Permissions:** Manage Server · **Cooldown:** 3s

**Usage:** `!setlog [#channel or channel ID]`

Set the channel where moderation actions are logged. Run with no argument to view the current setting

</div>
<div class="cmd-entry" id="cmd-setprefix">

## !setprefix

**Permissions:** Manage Server · **Cooldown:** 3s

**Usage:** `!setprefix <prefix>`

Set a custom prefix for this server

</div>
<div class="cmd-entry" id="cmd-setserverlog">

## !setserverlog

**Permissions:** Manage Server · **Cooldown:** 3s

**Usage:** `!setserverlog [category] [#channel OR clear]`

Set the channel where server events are logged. You can also split logs into separate channels by category.

**Usage:**

- `!setserverlog #channel` - set the default log channel for all events
- `!setserverlog <category> #channel` - send a specific category to a different channel
- `!setserverlog <category> clear` - remove a category override (falls back to default)
- `!setserverlog status` - show all configured log channels
- `!setserverlog clear` - remove the default log channel

**Categories:** `member`, `voice`, `message`, `role`, `channel`, `reaction`, `server`

</div>
<div class="cmd-entry" id="cmd-setstaff">

## !setstaff

**Permissions:** Manage Server · **Cooldown:** 3s

**Usage:** `!setstaff <channel|role|reportchannel|status> [value|clear]`

Configure the staff report system.

**Subcommands:**

- `channel <#channel>` this will set the channel where `!report` submissions are posted
- `channel clear` this will remove the staff output channel
- `role <@role>`this will set the role pinged on every new report
- `role clear` removes the role ping
- `reportchannel <#channel>` used to set a dedicated inbox channel: any message sent there is silently deleted and forwarded to staff (no command needed)
- `reportchannel clear` removes the inbox channel
- `status` shows the current configuration

</div>
<div class="cmd-entry" id="cmd-slowmodeperms">

## !slowmodeperms

**Permissions:** Manage Server · **Cooldown:** 3s

**Usage:** `!slowmodeperms add <@role> OR remove <@role> OR list OR clear`

Manage which roles can use the slowmode command without needing Manage Channels permission.

### Options

- `!slowmodeperms add <@role>`
- `!slowmodeperms remove <@role>`
- `!slowmodeperms list`
- `!slowmodeperms clear`

</div>
<div class="cmd-entry" id="cmd-status">

## !status

**Permissions:** Manage Server · **Cooldown:** 3s

**Usage:** `!status`

Show all bot settings for this server, automod, anti-link, anti-spam, ghost ping, log channel, autorole, and more

</div>
<div class="cmd-entry" id="cmd-sticky">

## !sticky

**Permissions:** Manage Server · **Cooldown:** 3s

**Usage:** `!sticky add <#channel> [message] OR message <#channel> <text> OR remove <#channel> OR on/off <#channel> OR list OR test <#channel>`

Pin a message to the bottom of a channel. Reposts after each new message.

### Options

- `!sticky add <#channel> [message]`
- `!sticky message <#channel> <text>`
- `!sticky remove <#channel>`
- `!sticky on/off <#channel>`
- `!sticky list`
- `!sticky test <#channel>`

</div>
<div class="cmd-entry" id="cmd-ticket">

## !ticket

**Permissions:** None · **Cooldown:** 3s

**Usage:** `!ticket <close|add|remove|panel|setup> [options]`

Support ticket system - create, manage, and close tickets.

### Subcommands

**Ticket System**
`!ticket claim` - claim this ticket (shows you're handling it)
`!ticket close [reason]` - close the current ticket
`!ticket add <@user or user ID>` - add a user to the ticket
`!ticket remove <@user or user ID>` - remove a user from the ticket
`!ticket panel [#channel]` - post the ticket reaction panel
`!ticket setup` - configure the ticket system (admin)

*To create a ticket, react to the ticket panel message in the designated channel.*

**Setup subcommands**

- Usage: `!ticket setup category <categoryId>`
Provide the ID of an existing category channel, or `create` to make one.
- Set up a ticket category first: `!ticket setup category <id|create>`
- Ticket channel created: &lt;#{channelId}&gt; - users can now react to create tickets!
- Usage:
`!ticket setup role add <@role>` - add a support role
`!ticket setup role remove <@role>` - remove a support role
`!ticket setup role clear` - remove all
`!ticket setup role` - list current roles
- Usage: `!ticket setup log <#channel>`
- Usage: `!ticket setup max <1-10>` - max open tickets per user.
- Usage: `!ticket setup message <text>` or `!ticket setup message clear`
Variables: `{user}` `{server}` `{ticket}`

</div>
<div class="cmd-entry" id="cmd-toggle-antilink">

## !toggle-antilink

**Permissions:** Manage Server · **Cooldown:** 3s

**Usage:** `!toggle-antilink`

Block messages containing URLs; moderators and admins are exempt

</div>
<div class="cmd-entry" id="cmd-toggle-antireactionspam">

## !toggle-antireactionspam

**Permissions:** Manage Server · **Cooldown:** 3s

**Usage:** `!toggle-antireactionspam`

Toggle anti-reaction spam detection - prevents users from rapidly adding reactions

</div>
<div class="cmd-entry" id="cmd-toggle-antispam">

## !toggle-antispam

**Permissions:** Manage Server · **Cooldown:** 3s

**Usage:** `!toggle-antispam`

Mute members who send many messages in quick succession - triggers after repeated rapid messages

</div>
<div class="cmd-entry" id="cmd-toggle-automod">

## !toggle-automod

**Permissions:** Manage Server · **Cooldown:** 3s

**Usage:** `!toggle-automod`

Enable or disable the entire automod system - overrides all individual filter toggles

</div>
<div class="cmd-entry" id="cmd-toggle-ghostping">

## !toggle-ghostping

**Permissions:** Manage Server · **Cooldown:** 3s

**Usage:** `!toggle-ghostping`

Detect and alert when a member pings someone then immediately deletes the message

</div>
<div class="cmd-entry" id="cmd-verify">

## !verify

**Permissions:** Manage Server · **Cooldown:** 5s

**Usage:** `!verify <subcommand> [options]`

Set up manual captcha verification for your server.

**Subcommands:**

- `setup` - auto-create category, channel, role, and panel
- `panel [#channel]` - (re-)post the verification panel embed
- `role <@role>` - set the verified role
- `category <id>` - set the verification category
- `log <#channel>` - set a verification log channel
- `status` - show current verification config
- `reset` - disable and clear settings
- `test` - test verification with a temp channel

</div>
<div class="cmd-entry" id="cmd-welcome">

## !welcome

**Permissions:** Manage Server · **Cooldown:** 3s

**Usage:** `!welcome <subcommand> [options]`

Configure the welcome message system for your server. Run `!welcome` with no arguments for the full guide.

**Subcommands:**

- `status` - show current welcome configuration
- `channel <#channel>` - set the welcome channel
- `on/off` - enable or disable welcome messages
- `image on/off` - toggle the welcome card image
- `message <text>` - set custom welcome text ({user} {username} {server} {count} {role})
- `card preset <name>` - apply a theme (dark, light, ocean, sunset, midnight, forest)
- `card color/bgcolor/textcolor <hex>` - customize card colors
- `card greeting <text>` - replace "WELCOME" text on the card (emoji supported)
- `card background <url>` - set a custom background image
- `embed on/off` - toggle a welcome embed (title, description, color, footer, thumbnail)
- `dm on/off` - toggle DM welcome messages
- `role on/off` - show auto-role name on the card
- `trigger join/role` - trigger on member join or role assignment
- `test` - preview the welcome output

</div>

</div>
