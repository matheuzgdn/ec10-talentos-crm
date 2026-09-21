#!/usr/bin/env bash
set -Eeuo pipefail

REPOSITORY_URL="${EC10_REPOSITORY_URL:-https://github.com/matheuzgdn/ec10-talentos-crm.git}"
BRANCH="${EC10_DEPLOY_BRANCH:-main}"
DEPLOY_ROOT="${EC10_DEPLOY_ROOT:-/home/opc/ec10-github-sync}"
LEGACY_ROOT="${EC10_LEGACY_ROOT:-/home/opc/cliente-whatsapp-crm}"
BOT_SERVICE="${EC10_BOT_SERVICE:-cliente-whatsapp-crm-bot.service}"
SERVICE_OVERRIDE_DIR="/etc/systemd/system/$BOT_SERVICE.d"
SERVICE_OVERRIDE_FILE="$SERVICE_OVERRIDE_DIR/90-github-release.conf"
MIRROR_DIR="$DEPLOY_ROOT/repository.git"
RELEASES_DIR="$DEPLOY_ROOT/releases"
STATE_FILE="$DEPLOY_ROOT/deployed-commit"
STATUS_FILE="$DEPLOY_ROOT/status.json"
LOCK_FILE="$DEPLOY_ROOT/deploy.lock"

mkdir -p "$DEPLOY_ROOT" "$RELEASES_DIR"
exec 9>"$LOCK_FILE"
flock -n 9 || exit 0

write_status() {
  local state="$1"
  local commit="${2:-}"
  local message="${3:-}"
  printf '{"state":"%s","commit":"%s","message":"%s","updatedAt":"%s"}\n' \
    "$state" "$commit" "$message" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$STATUS_FILE"
}

if [[ ! -d "$MIRROR_DIR" ]]; then
  git clone --mirror "$REPOSITORY_URL" "$MIRROR_DIR"
else
  git --git-dir="$MIRROR_DIR" fetch --prune origin
fi

target_commit="$(git --git-dir="$MIRROR_DIR" rev-parse "refs/heads/$BRANCH")"
deployed_commit="$(cat "$STATE_FILE" 2>/dev/null || true)"
if [[ "$target_commit" == "$deployed_commit" ]]; then
  current_health="$(curl -fsS --max-time 4 http://127.0.0.1:3001/health 2>/dev/null || true)"
  if grep -Eq '"status":"ready"' <<<"$current_health"; then
    write_status "ready" "$target_commit" "already_deployed"
  elif grep -Eq '"ok":true' <<<"$current_health"; then
    write_status "attention" "$target_commit" "existing_deployment_whatsapp_reconnect_required"
  else
    write_status "attention" "$target_commit" "existing_deployment_health_unavailable"
  fi
  exit 0
fi

if [[ -n "$deployed_commit" ]] && git --git-dir="$MIRROR_DIR" cat-file -e "$deployed_commit^{commit}" 2>/dev/null; then
  changed_files="$(git --git-dir="$MIRROR_DIR" diff --name-only "$deployed_commit" "$target_commit")"
  if ! grep -Eq '^(apps/bot/|packages/shared/|media/|package(-lock)?\.json$|scripts/patch-whatsapp-web\.cjs$)' <<<"$changed_files"; then
    printf '%s\n' "$target_commit" >"$STATE_FILE"
    write_status "ready" "$target_commit" "no_bot_runtime_change"
    exit 0
  fi
fi

release_dir="$RELEASES_DIR/$target_commit"
if [[ ! -d "$release_dir/.git" ]]; then
  temporary_dir="$RELEASES_DIR/.tmp-$target_commit-$$"
  trap 'case "${temporary_dir:-}" in "$RELEASES_DIR"/.tmp-*) rm -rf -- "$temporary_dir" ;; esac' EXIT
  git clone --no-checkout "$MIRROR_DIR" "$temporary_dir"
  git -C "$temporary_dir" checkout --detach "$target_commit"
  mv "$temporary_dir" "$release_dir"
  temporary_dir=""
  trap - EXIT
fi

if [[ "$(git -C "$release_dir" rev-parse HEAD)" != "$target_commit" ]]; then
  write_status "failed" "$target_commit" "release_commit_mismatch"
  exit 1
fi

write_status "validating" "$target_commit" "install_build_test"
(
  cd "$release_dir"
  npm ci --no-audit --no-fund
  npm --workspace @crm/shared run typecheck
  npm --workspace @crm/bot run typecheck
  npm --workspace @crm/shared run build
  npm --workspace @crm/bot run build
  node scripts/scan-repository-secrets.mjs
  node scripts/test-gustavo-fault-injection.mjs
  node scripts/test-gustavo-2026-09-17-regressions.mjs
  node scripts/test-gustavo-provider-failure.mjs
)

for persistent_path in .env .env.local whatsapp-session whatsapp-session-mentoria-prime runtime backups .wwebjs_auth .wwebjs_cache; do
  source_path="$LEGACY_ROOT/$persistent_path"
  target_path="$release_dir/$persistent_path"
  if [[ -e "$source_path" && ! -e "$target_path" && ! -L "$target_path" ]]; then
    ln -s "$source_path" "$target_path"
  fi
done

previous_target="$(systemctl show "$BOT_SERVICE" -p WorkingDirectory --value)"
if [[ -z "$previous_target" ]]; then previous_target="$LEGACY_ROOT"; fi

override_candidate="$DEPLOY_ROOT/90-github-release-$$.conf"
printf '[Service]\nWorkingDirectory=%s\n' "$release_dir" >"$override_candidate"
sudo -n mkdir -p "$SERVICE_OVERRIDE_DIR"
sudo -n install -m 0644 "$override_candidate" "$SERVICE_OVERRIDE_FILE"
rm -f -- "$override_candidate"
sudo -n systemctl daemon-reload

write_status "restarting" "$target_commit" "bot_restart"
sudo -n systemctl restart "$BOT_SERVICE"

healthy=false
transport_ready_streak=0
last_health_json=""
for _ in $(seq 1 36); do
  if sudo -n systemctl is-active --quiet "$BOT_SERVICE"; then
    health_json="$(curl -fsS --max-time 4 http://127.0.0.1:3001/health 2>/dev/null || true)"
    last_health_json="$health_json"
    if grep -Eq '"status":"ready"' <<<"$health_json"; then
      transport_ready_streak=$((transport_ready_streak + 1))
      if (( transport_ready_streak >= 3 )); then
        healthy=true
        break
      fi
    else
      transport_ready_streak=0
    fi
  fi
  sleep 5
done

if [[ "$healthy" != "true" ]]; then
  if grep -Eq '"ok":true' <<<"$last_health_json" && grep -Eq '"status":"(waiting_qr_scan|authenticated|loading|reconnecting|disconnected)"' <<<"$last_health_json"; then
    printf '%s\n' "$target_commit" >"$STATE_FILE"
    write_status "attention" "$target_commit" "deployed_whatsapp_reconnect_required"
    exit 0
  fi
  rollback_candidate="$DEPLOY_ROOT/90-github-rollback-$$.conf"
  printf '[Service]\nWorkingDirectory=%s\n' "$previous_target" >"$rollback_candidate"
  sudo -n install -m 0644 "$rollback_candidate" "$SERVICE_OVERRIDE_FILE"
  rm -f -- "$rollback_candidate"
  sudo -n systemctl daemon-reload
  sudo -n systemctl restart "$BOT_SERVICE"
  write_status "rolled_back" "$target_commit" "health_check_failed"
  exit 1
fi

printf '%s\n' "$target_commit" >"$STATE_FILE"
write_status "ready" "$target_commit" "deployed"
