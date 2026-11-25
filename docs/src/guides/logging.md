# Logging

Two separate systems. Manage Server for both.

## Mod log - `!setlog`

Bans, kicks, timeouts, warns, clears, etc.

```
!setlog #channel
!setlog          # show current
!setlog clear
```

## Server log - `!setserverlog`

Joins, leaves, edits, voice, role/channel changes, reactions, server events.

```
!setserverlog #channel
!setserverlog member #channel   # per category
!setserverlog member clear
!setserverlog status
!setserverlog clear
```

Categories: `member`, `voice`, `message`, `role`, `channel`, `reaction`, `server`

Also separate: ticket log (`!ticket setup log`), verify log (`!verify log`).

The dashboard exposes the same logging settings.

- [`!setlog`](/commands/admin#cmd-setlog)
- [`!setserverlog`](/commands/admin#cmd-setserverlog)
