# Get Started

ClaudeCityMod is a bot for [Fluxer](https://fluxer.app). Commands start with `!` by default.

## Add the bot

Use the OAuth2 invite URL for **your** Fluxer application:

```text
https://web.fluxer.app/oauth2/authorize?client_id=YOUR_CLIENT_ID&scope=bot&permissions=4504699474930806
```

Or run `!invite-me` in a server that already has ClaudeCityMod.

## Prefix

**Personal** (`!myprefix`) - only your messages, any server or DMs. `!myprefix view` / `!myprefix clear`.

**Server** (`!setprefix`, `!clearprefix`) - needs Manage Server. Dashboard can change this too.

Order: personal, then server, then default `!`.

`!help` lists categories. `!help command-name` for one command.

## Dashboard

The dashboard is served by your own deployment at the address you configured
in `DASHBOARD_URL` (default `http://localhost:4000`). Use it for automod,
leveling, welcome, tickets, logs, and the other settings.

## Support

ClaudeCityMod is self-hosted. Contact the operator of the instance you use.

## Commands

- [Moderation](/commands/moderation)
- [Admin](/commands/admin)
- [Info](/commands/info)
- [General](/commands/general)

## Guides

[Guides](/guides/)
