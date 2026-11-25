#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ROOT}/.env"
CHECK="${ROOT}/scripts/ntfy-uptime-check.sh"

chmod +x "$CHECK"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing ${ENV_FILE}" >&2
  exit 1
fi

source "$ENV_FILE"

if [[ -z "${NTFY_TOPIC:-}" ]]; then
  TOPIC="claudecitymod-$(openssl rand -hex 4)"
  echo "" >>"$ENV_FILE"
  echo "# ntfy.sh - subscribe in the ntfy app to this topic" >>"$ENV_FILE"
  echo "NTFY_TOPIC=${TOPIC}" >>"$ENV_FILE"
  echo "CCM_STATUS_URL=http://127.0.0.1:4000/api/public/status" >>"$ENV_FILE"
  echo "NTFY_SERVER=https://ntfy.sh" >>"$ENV_FILE"
  echo "Wrote NTFY_TOPIC=${TOPIC} to .env"
fi

CRON_FILE="/etc/cron.d/claudecitymod-ntfy"
CRON_LINE="*/2 * * * * root ${CHECK} >> ${ROOT}/logs/ntfy-uptime.log 2>&1"

echo "$CRON_LINE" | sudo tee "$CRON_FILE" >/dev/null
sudo chmod 644 "$CRON_FILE"

echo "Installed ${CRON_FILE} (every 2 minutes)"
echo "Test notification:"
"$CHECK" || true
source "$ENV_FILE"
echo ""
echo "On your phone: install ntfy app → Subscribe to topic → ${NTFY_TOPIC}"
echo "Server: ${NTFY_SERVER:-https://ntfy.sh}"
