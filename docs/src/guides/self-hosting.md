# Self-hosting

ClaudeCityMod runs as a single Node.js process (bot + dashboard + API) with
MongoDB for storage. Docker Compose is the recommended deployment.

```text
Fluxer gateway/API
        |
   ClaudeCityMod  ---- MongoDB
        |
   dashboard in your browser
```

The dashboard is optional. The bot itself only needs `TOKEN` and `MONGO_URI`.

## Requirements

- Docker and Docker Compose (recommended), or Node.js 24+, pnpm 12+, MongoDB
- A Fluxer bot token and OAuth application

## Create the Fluxer application

1. In Fluxer, open **User Settings → Install → Applications**.
2. Create an application named **ClaudeCityMod**.
3. Copy the bot token and the OAuth client ID/secret.
4. Add `http://localhost:4000/auth/callback` as a redirect URI (change the
   host if you use a domain).

## Docker Compose

```bash
cp .env.docker.example .env
```

Set at least:

```env
TOKEN=your_fluxer_bot_token
OWNER_ID=your_fluxer_user_id

API_ADMIN_TOKEN=replace_with_a_long_random_value
APPEAL_SIGNING_SECRET=replace_with_a_long_random_value

DASHBOARD_URL=http://localhost:4000
FLUXER_OAUTH_CLIENT_ID=your_oauth_client_id
FLUXER_OAUTH_CLIENT_SECRET=your_oauth_client_secret
FLUXER_OAUTH_REDIRECT_URI=http://localhost:4000/auth/callback
```

Start the stack:

```bash
docker compose up -d --build
```

The dashboard is served on port `4000`. MongoDB is only reachable inside the
Compose network.

### Private single-server mode

Set `ALLOWED_GUILD_ID` to keep the bot on one server:

```env
ALLOWED_GUILD_ID=your_server_id
DASHBOARD_ALLOWED_USER_IDS=trusted_user_id,another_user_id
```

The bot leaves any other server it is added to, ignores commands from them, and
the dashboard only shows the allowed server. Dashboard login is limited to
`OWNER_ID`, the extra IDs above, and members with Administrator or Manage
Server on the allowed server. Keep the application private/unlisted in Fluxer
as well if you do not want the invite link to be discoverable.

Persistent data is bind-mounted to the host:

```text
data/
├── mongo/   # database
└── bot/     # gateway session and bot state
```

Back up and restore:

```bash
docker compose exec -T mongo mongodump --archive --db=claudecitymod > backup.archive
cat backup.archive | docker compose exec -T mongo mongorestore --archive
```

## Manual install

```bash
pnpm install --frozen-lockfile
cp .env.example .env
# edit .env: TOKEN, MONGO_URI, API_ADMIN_TOKEN, DASHBOARD_URL, OAuth values
pnpm --filter claudecitymod-dashboard build
pnpm build
pnpm start
```

For development use `pnpm dev`. The production API serves the built dashboard
from `dashboard/dist`, so Vite does not need to run in production.

## Using another Fluxer instance

Set the instance endpoints before building the dashboard:

```env
VITE_FLUXER_INSTANCE_API=https://api.my-fluxer.example
VITE_FLUXER_INSTANCE_WEB=https://web.my-fluxer.example
VITE_FLUXER_INSTANCE_MEDIA=https://cdn.my-fluxer.example
VITE_FLUXER_CLIENT_ID=your_oauth_client_id
```

Then build the dashboard and the bot as usual.

## Dashboard login and HTTPS

Create the OAuth application and add the exact redirect URI from
`FLUXER_OAUTH_REDIRECT_URI`. The dashboard URL and redirect URI are different
values. Use the same OAuth client ID for `FLUXER_OAUTH_CLIENT_ID` and
`VITE_FLUXER_CLIENT_ID`:

```env
DASHBOARD_URL=https://bot.example.com
FLUXER_OAUTH_CLIENT_ID=your_oauth_client_id
FLUXER_OAUTH_REDIRECT_URI=https://bot.example.com/auth/callback
```

Put the dashboard behind HTTPS if it is reachable from the internet. A minimal
Caddy site:

```text
bot.example.com {
  reverse_proxy 127.0.0.1:4000
}
```

## Process modes

`CCM_PROCESS=all` (default) runs the gateway, dashboard, and API in one
process and is what the Compose stack uses.

The split modes are still available for larger deployments:

- `CCM_PROCESS=bot` - gateway only
- `CCM_PROCESS=web` - dashboard + API, run with
  `node build/api/standalone.js`

In split mode, both processes need the same `MONGO_URI` and
`API_ADMIN_TOKEN`, and the web process needs `BOT_INTERNAL_URL` pointing at
the bot's internal API.

## Troubleshooting

- **Bot does not connect** - check `TOKEN`, and check the container logs with
  `docker compose logs -f claudecitymod`.
- **Dashboard login fails** - the redirect URI in the Fluxer application must
  exactly match `FLUXER_OAUTH_REDIRECT_URI`.
- **Dashboard loads but shows the bot offline** - make sure only one process
  is running the gateway, and that `API_ADMIN_TOKEN` is identical in split
  deployments.
- **Mongo connection errors** - wait for the `mongo` health check, or verify
  `MONGO_URI` if you use an external database.
