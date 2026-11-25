#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ROOT}/.env"

if [[ -f "$ENV_FILE" ]]; then
  set -a && source "$ENV_FILE" && set +a
fi

PING_URL="${HEALTHCHECKS_PING_URL:-}"
API_PORT="${API_PORT:-4000}"

if [[ -z "$PING_URL" ]]; then
  echo "Set HEALTHCHECKS_PING_URL in .env (https://hc-ping.com/<uuid>) then re-run." >&2
  exit 1
fi

CRON_FILE="/etc/cron.d/claudecitymod-health"
CRON_LINE="* * * * * root curl -fsS \"http://127.0.0.1:${API_PORT}/api/public/status\" >/dev/null && curl -fsS -m 10 --retry 2 \"${PING_URL}\" >/dev/null"

echo "$CRON_LINE" | sudo tee "$CRON_FILE" >/dev/null
sudo chmod 644 "$CRON_FILE"
echo "Installed ${CRON_FILE}"
echo "Test: curl -fsS http://127.0.0.1:${API_PORT}/api/public/status && curl -fsS ${PING_URL}"
