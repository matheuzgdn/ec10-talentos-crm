#!/usr/bin/env bash
set -euo pipefail

backup_dir="/var/backups/ec10-crm"
key_file="/etc/ec10-crm-backup.key"
lock_file="/run/ec10-crm-backup.lock"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
final_file="$backup_dir/ec10-crm-$timestamp.dump.enc"

if [[ ! -f "$key_file" || ! -f /etc/ec10-crm-gateway.env ]]; then
  echo "Backup key or database configuration is missing" >&2
  exit 1
fi

umask 077
install -d -m 0700 "$backup_dir"
exec 9>"$lock_file"
flock -n 9 || { echo "Backup already running" >&2; exit 1; }

set -a
# shellcheck disable=SC1091
source /etc/ec10-crm-gateway.env
set +a

temporary_file="$(mktemp "$backup_dir/.ec10-crm-$timestamp.XXXXXX")"
verification_file="$(mktemp "$backup_dir/.ec10-verify-$timestamp.XXXXXX")"
trap 'rm -f -- "$temporary_file" "$verification_file"' EXIT

echo "Backup phase: dump and encrypt" >&2
set +e
/usr/bin/node /opt/ec10-crm-gateway/scripts/pg-dump-safe.mjs |
  openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "file:$key_file" >"$temporary_file"
pipeline_status=("${PIPESTATUS[@]}")
set -e
if [[ "${pipeline_status[0]}" -ne 0 || "${pipeline_status[1]}" -ne 0 ]]; then
  echo "Backup pipeline failed: dump=${pipeline_status[0]} encrypt=${pipeline_status[1]}" >&2
  exit 1
fi

if [[ "$(stat -c %s "$temporary_file")" -lt 10000 ]]; then
  echo "Backup archive is unexpectedly small" >&2
  exit 1
fi

echo "Backup phase: verify archive" >&2
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:$key_file" \
  -in "$temporary_file" -out "$verification_file"
/usr/pgsql-17/bin/pg_restore --list "$verification_file" >/dev/null
rm -f -- "$verification_file"

mv -- "$temporary_file" "$final_file"
trap - EXIT
sha256sum "$final_file" | awk '{print $1}'
echo "Verified encrypted CRM backup: $(basename "$final_file")"
