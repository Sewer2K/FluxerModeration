#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ROOT}/.env"
STATE_FILE="${ROOT}/.ntfy-alert-state"

# Consecutive failed checks before paging (cron is every 2 min → ~6 min).
FAIL_THRESHOLD="${NTFY_FAIL_THRESHOLD:-3}"

if [[ -f "$ENV_FILE" ]]; then
  set -a && source "$ENV_FILE" && set +a
fi

STATUS_URL="${CCM_STATUS_URL:-http://127.0.0.1:4000/api/public/status}"
NTFY_TOPIC="${NTFY_TOPIC:-}"
NTFY_SERVER="${NTFY_SERVER:-https://ntfy.sh}"

if [[ -z "$NTFY_TOPIC" ]]; then
  echo "NTFY_TOPIC not set in .env" >&2
  exit 1
fi

NTFY_URL="${NTFY_SERVER%/}/${NTFY_TOPIC}"

notify() {
  local title="$1"
  local body="$2"
  local priority="${3:-default}"
  curl -fsS -m 15 \
    -H "Title: ${title}" \
    -H "Priority: ${priority}" \
    -H "Tags: robot" \
    -d "$body" \
    "$NTFY_URL" >/dev/null
}

is_healthy() {
  local body
  body="$(curl -fsS --max-time 20 "$STATUS_URL" 2>/dev/null)" || return 1
  echo "$body" | grep -q '"online"[[:space:]]*:[[:space:]]*true'
}

read_state() {
  fails=0
  alerted=0
  if [[ -f "$STATE_FILE" ]]; then
    # shellcheck disable=SC1090
    source "$STATE_FILE" || true
    fails="${fails:-0}"
    alerted="${alerted:-0}"
  fi
}

write_state() {
  printf 'fails=%s\nalerted=%s\n' "$1" "$2" >"$STATE_FILE"
}

read_state

if is_healthy; then
  if [[ "$alerted" == "1" ]]; then
    guilds="$(curl -fsS --max-time 20 "$STATUS_URL" 2>/dev/null | sed -n 's/.*"guilds"[[:space:]]*:[[:space:]]*\([0-9]*\).*/\1/p' | head -1)"
    notify "ClaudeCityMod back online" "Status OK - ${guilds:-?} guilds. ${STATUS_URL}" "default"
    echo "recovered after alert (was failing)"
  elif [[ "$fails" -gt 0 ]]; then
    echo "healthy again (cleared ${fails} fail(s), never alerted)"
  fi
  rm -f "$STATE_FILE"
  exit 0
fi

fails=$((fails + 1))
detail="$(curl -sS --max-time 20 -w 'HTTP %{http_code}' "$STATUS_URL" 2>&1 | tail -1 || echo 'unreachable')"

if [[ "$alerted" != "1" && "$fails" -ge "$FAIL_THRESHOLD" ]]; then
  notify "ClaudeCityMod DOWN" "Check failed ${fails}x (threshold ${FAIL_THRESHOLD}): ${STATUS_URL} (${detail})" "urgent"
  write_state "$fails" 1
  echo "ALERT down after ${fails} consecutive fails: ${detail}"
elif [[ "$alerted" == "1" ]]; then
  write_state "$fails" 1
  echo "still down (${fails} fails): ${detail}"
else
  write_state "$fails" 0
  echo "fail ${fails}/${FAIL_THRESHOLD} (no alert yet): ${detail}"
fi

exit 0
