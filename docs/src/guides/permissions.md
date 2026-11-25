# Permissions

## Bot permissions (invite)

Use your own application's invite link:

```text
https://web.fluxer.app/oauth2/authorize?client_id=YOUR_CLIENT_ID&scope=bot&permissions=4504699474930806
```

It requests what ClaudeCityMod needs for moderation, logging, tickets,
channels, and roles. If a command fails with a missing-permission error,
re-invite with that link.

## Who can run admin commands

Most setup commands need **Manage Server** on the person running them: `!automod`, `!welcome`, `!ticket setup`, `!verify`, `!leveling`, etc.

## Who can run mod commands

ClaudeCityMod must have the permission for the action (ban, kick, timeout, manage roles, ...).

The person running the command must be **above** the target in the role list, unless they have **Administrator**.

`!help command-name` on Fluxer lists requirements for a specific command.

## ClaudeCityMod's role position

ClaudeCityMod's highest role should be **above** any role it needs to hand out: verified, ticket support, level rewards, autorole, and similar. If role assign fails, drag ClaudeCityMod up in the server role list.

## Restricting command access

`!commandperms` limits which roles can use non-admin bot commands. Staff/admins still get through. See [`!commandperms`](/commands/admin#cmd-commandperms).
