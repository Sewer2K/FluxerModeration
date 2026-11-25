# Verification

Captcha panel + private channel + verified role. Manage Server required.

## Setup

`!verify setup` - creates role, category, panel channel, and panel message if missing.

ClaudeCityMod's role must be above the verified role.

Manual:

- `!verify role @Role`
- `!verify category <id>`
- `!verify panel [#channel]`
- `!verify log #channel`
- `!verify status`

## Flow

1. React on the panel
2. ClaudeCityMod opens a private channel with a captcha
3. Type the code
4. Get the verified role

`!verify test` - dry run  
`!verify reset` - wipe config (does not delete channels/roles)

Hiding the rest of the server is on you: deny View Channel for @everyone, allow it for Verified on member channels.

[`!verify` reference](/commands/admin#cmd-verify)
