#!/usr/bin/env bash
set -euo pipefail

state_dir="/var/lib/ec10crm/health"
mkdir -p "$state_dir"

check() {
  local name="$1"
  local url="$2"
  local state_file="$state_dir/$name.state"
  local current="down"
  if curl --fail --silent --show-error --max-time 10 "$url" >/dev/null 2>&1; then
    current="up"
  fi
  local previous="unknown"
  [[ -f "$state_file" ]] && previous="$(<"$state_file")"
  printf '%s' "$current" >"$state_file"
  if [[ "$current" != "$previous" ]]; then
    logger -t ec10-crm-guardian "component=$name previous=$previous current=$current"
  fi
  [[ "$current" == "up" ]]
}

if ! check gateway "http://127.0.0.1:3200/health/ready"; then
  systemctl try-restart ec10-postgrest.service ec10-crm-gateway.service
  sleep 3
  check gateway "http://127.0.0.1:3200/health/ready" || exit 1
fi

if ! check public "https://crm-api.147-15-27-235.nip.io/health/live"; then
  systemctl try-restart caddy.service
  sleep 3
  check public "https://crm-api.147-15-27-235.nip.io/health/live" || exit 1
fi

backup_state_file="$state_dir/backup.state"
backup_state="stale"
latest_backup="$(find /var/backups/ec10-crm -maxdepth 1 -type f -name 'ec10-crm-*.dump.enc' -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -n 1 || true)"
if [[ -n "$latest_backup" ]]; then
  latest_epoch="${latest_backup%%.*}"
  if (( $(date +%s) - latest_epoch < 129600 )); then
    backup_state="fresh"
  fi
fi
previous_backup="unknown"
[[ -f "$backup_state_file" ]] && previous_backup="$(<"$backup_state_file")"
printf '%s' "$backup_state" >"$backup_state_file"
if [[ "$backup_state" != "$previous_backup" ]]; then
  logger -t ec10-crm-guardian "component=backup previous=$previous_backup current=$backup_state"
fi
[[ "$backup_state" == "fresh" ]]
