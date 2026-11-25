# Tickets

Members react on the panel to open a private channel. Manage Server for setup.

## Setup

1. `!ticket setup category create` (or `!ticket setup category <id>`)
2. `!ticket setup channel create` (or `!ticket setup channel #channel`) - posts the panel
3. `!ticket setup role add @Role` (up to 10)
4. `!ticket setup log #channel` (optional)
5. `!ticket setup` - summary embed

Optional: `!ticket setup max <1-10>`, `!ticket setup message <text>`

ClaudeCityMod needs `Manage Channels` on the ticket category, plus `View Channel`, `Send Messages`, `Manage Messages`,
`Embed Links`, `Read Message History`, and `Add Reactions` in the panel channel. A server-wide `Manage Channels`
role permission is not required when the category-specific overwrite is configured.

## Panel

`!ticket panel` or `!ticket panel #channel`

## In a ticket

- `!ticket close [reason]`
- `!ticket add @user` / `!ticket remove @user`
- `!ticket claim`

[`!ticket` reference](/commands/admin#cmd-ticket)
