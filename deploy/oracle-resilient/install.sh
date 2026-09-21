#!/usr/bin/env bash
set -euo pipefail

SOURCE_ENV="/tmp/ec10-saas-supabase.env"
SOURCE_APP="/tmp/ec10-oracle-gateway"
SOURCE_DEPLOY="/tmp/ec10-oracle-deploy"
SOURCE_PREVIEW="/tmp/ec10-crm-preview"
PUBLIC_HOST="${EC10_GATEWAY_HOST:-crm-api.147-15-27-235.nip.io}"

if [[ ! -f "$SOURCE_ENV" ]]; then
  echo "missing $SOURCE_ENV" >&2
  exit 1
fi
if [[ ! -f "$SOURCE_APP/package.json" ]]; then
  echo "missing $SOURCE_APP/package.json" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$SOURCE_ENV"
set +a

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  echo "SUPABASE_DB_URL is unavailable" >&2
  exit 1
fi

sudo useradd --system --home-dir /var/lib/ec10crm --create-home --shell /sbin/nologin ec10crm 2>/dev/null || true
sudo useradd --system --home-dir /var/lib/caddy --create-home --shell /sbin/nologin caddy 2>/dev/null || true

sudo install -d -m 0750 -o ec10crm -g ec10crm /opt/ec10-crm-gateway
sudo cp -a "$SOURCE_APP/." /opt/ec10-crm-gateway/
sudo chown -R ec10crm:ec10crm /opt/ec10-crm-gateway
sudo -u ec10crm npm --prefix /opt/ec10-crm-gateway install --omit=dev --ignore-scripts --no-audit --no-fund

postgrest_archive="/tmp/postgrest-v16.3-linux-static-x86-64.tar.xz"
curl --fail --location --silent --show-error \
  "https://github.com/PostgREST/postgrest/releases/download/v16.3/postgrest-v16.3-linux-static-x86-64.tar.xz" \
  --output "$postgrest_archive"
echo "4eb414eb948c8800863cc8c9896a17b611b2dccf9ff581f4d57f42ec9ccee40d  $postgrest_archive" | sha256sum --check --status
rm -f /tmp/postgrest
tar -xJf "$postgrest_archive" -C /tmp postgrest
sudo install -m 0755 /tmp/postgrest /usr/local/bin/postgrest

caddy_archive="/tmp/caddy_2.11.4_linux_amd64.tar.gz"
curl --fail --location --silent --show-error \
  "https://github.com/caddyserver/caddy/releases/download/v2.11.4/caddy_2.11.4_linux_amd64.tar.gz" \
  --output "$caddy_archive"
echo "527fbf917c39189a1e3b31d34fa955601680b2d5c8055d2a87b8b9588dec7bb9  $caddy_archive" | sha256sum --check --status
rm -f /tmp/caddy
tar -xzf "$caddy_archive" -C /tmp caddy
sudo install -m 0755 /tmp/caddy /usr/local/bin/caddy

if [[ -f /etc/ec10-crm-gateway.env ]]; then
  jwt_secret="$(sudo sed -n 's/^JWT_SECRET=//p' /etc/ec10-crm-gateway.env | head -n 1)"
fi
jwt_secret="${jwt_secret:-$(openssl rand -hex 48)}"
sudo install -m 0600 -o root -g root /dev/null /etc/ec10-crm-gateway.env
{
  printf 'DATABASE_URL=%s\n' "$SUPABASE_DB_URL"
  printf 'PGRST_DB_URI=%s\n' "$SUPABASE_DB_URL"
  printf 'JWT_SECRET=%s\n' "$jwt_secret"
  printf 'PGRST_JWT_SECRET=%s\n' "$jwt_secret"
  printf 'JWT_ISSUER=ec10-crm-oracle\n'
  printf 'PGRST_JWT_AUD=authenticated\n'
  printf 'GATEWAY_PUBLIC_ORIGIN=https://%s\n' "$PUBLIC_HOST"
  printf 'ALLOWED_ORIGINS=https://ec10talentos.com,https://www.ec10talentos.com,https://crm.ec10talentos.com\n'
  printf 'POSTGREST_ORIGIN=http://127.0.0.1:3201\n'
  printf 'PORT=3200\n'
  printf 'DB_POOL_MAX=5\n'
  printf 'ACCESS_TTL_SECONDS=43200\n'
  printf 'REFRESH_TTL_DAYS=30\n'
  printf 'MAX_LOGIN_ATTEMPTS=7\n'
  printf 'LOGIN_WINDOW_MS=900000\n'
  printf 'PGRST_DB_SCHEMAS=public\n'
  printf 'PGRST_DB_ANON_ROLE=anon\n'
  printf 'PGRST_DB_MAX_ROWS=200\n'
  printf 'PGRST_DB_POOL=4\n'
  printf 'PGRST_DB_CHANNEL_ENABLED=false\n'
  printf 'PGRST_SERVER_HOST=127.0.0.1\n'
  printf 'PGRST_SERVER_PORT=3201\n'
  printf 'PGRST_LOG_LEVEL=warn\n'
} | sudo tee /etc/ec10-crm-gateway.env >/dev/null

sudo bash -c 'set -a; source /etc/ec10-crm-gateway.env; set +a; node /opt/ec10-crm-gateway/scripts/migrate.mjs'

sudo install -m 0644 /dev/null /etc/systemd/system/ec10-postgrest.service
sudo tee /etc/systemd/system/ec10-postgrest.service >/dev/null <<'UNIT'
[Unit]
Description=EC10 resilient PostgREST
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ec10crm
Group=ec10crm
EnvironmentFile=/etc/ec10-crm-gateway.env
ExecStart=/usr/local/bin/postgrest
Restart=always
RestartSec=3
TimeoutStopSec=15
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
MemoryMax=160M
TasksMax=128

[Install]
WantedBy=multi-user.target
UNIT

sudo install -m 0644 /dev/null /etc/systemd/system/ec10-crm-gateway.service
sudo tee /etc/systemd/system/ec10-crm-gateway.service >/dev/null <<'UNIT'
[Unit]
Description=EC10 resilient CRM gateway
After=network-online.target ec10-postgrest.service
Wants=network-online.target ec10-postgrest.service

[Service]
Type=simple
User=ec10crm
Group=ec10crm
WorkingDirectory=/opt/ec10-crm-gateway
EnvironmentFile=/etc/ec10-crm-gateway.env
ExecStart=/usr/bin/node /opt/ec10-crm-gateway/src/server.mjs
Restart=always
RestartSec=3
TimeoutStopSec=15
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/ec10crm
MemoryMax=180M
TasksMax=128

[Install]
WantedBy=multi-user.target
UNIT

sudo install -d -m 0755 /etc/caddy
if [[ -d "$SOURCE_PREVIEW/crm" ]]; then
  sudo install -d -m 0755 /opt/ec10-crm-preview
  sudo cp -a "$SOURCE_PREVIEW/." /opt/ec10-crm-preview/
  sudo chmod -R a+rX /opt/ec10-crm-preview
sudo tee /etc/caddy/Caddyfile >/dev/null <<CADDY
$PUBLIC_HOST {
  encode zstd gzip
  route {
    @gateway path /health/* /auth/v1/* /rest/v1/* /storage/v1/* /functions/v1/*
    handle @gateway {
      reverse_proxy 127.0.0.1:3200
    }
    @publicApi path /api/*
    handle @publicApi {
      reverse_proxy https://ec10talentos.com {
        header_up Host ec10talentos.com
      }
    }
    handle {
      root * /opt/ec10-crm-preview
      try_files {path} /crm/index.html
      file_server
    }
  }
  header {
    Strict-Transport-Security "max-age=31536000; includeSubDomains"
    X-Content-Type-Options "nosniff"
    Referrer-Policy "strict-origin-when-cross-origin"
    -Server
  }
}
CADDY
else
sudo tee /etc/caddy/Caddyfile >/dev/null <<CADDY
$PUBLIC_HOST {
  encode zstd gzip
  reverse_proxy 127.0.0.1:3200
  header {
    Strict-Transport-Security "max-age=31536000; includeSubDomains"
    X-Content-Type-Options "nosniff"
    Referrer-Policy "strict-origin-when-cross-origin"
    -Server
  }
}
CADDY
fi

sudo install -m 0644 /dev/null /etc/systemd/system/caddy.service
sudo tee /etc/systemd/system/caddy.service >/dev/null <<'UNIT'
[Unit]
Description=Caddy web server for EC10 CRM
After=network-online.target ec10-crm-gateway.service
Wants=network-online.target ec10-crm-gateway.service

[Service]
Type=notify
User=caddy
Group=caddy
Environment=HOME=/var/lib/caddy
ExecStart=/usr/local/bin/caddy run --environ --config /etc/caddy/Caddyfile
ExecReload=/usr/local/bin/caddy reload --config /etc/caddy/Caddyfile --force
TimeoutStopSec=5s
LimitNOFILE=1048576
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/caddy
AmbientCapabilities=CAP_NET_ADMIN CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_ADMIN CAP_NET_BIND_SERVICE
NoNewPrivileges=true
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT

sudo firewall-cmd --permanent --add-service=http >/dev/null
sudo firewall-cmd --permanent --add-service=https >/dev/null
sudo firewall-cmd --reload >/dev/null

sudo systemctl daemon-reload
sudo systemctl enable --now ec10-postgrest.service ec10-crm-gateway.service caddy.service

sudo install -m 0755 "$SOURCE_DEPLOY/ec10-crm-healthcheck.sh" /usr/local/bin/ec10-crm-healthcheck
if [[ -f "$SOURCE_DEPLOY/ec10-crm-guardian.service" ]]; then
  sudo install -m 0644 "$SOURCE_DEPLOY/ec10-crm-guardian.service" /etc/systemd/system/ec10-crm-guardian.service
  sudo install -m 0644 "$SOURCE_DEPLOY/ec10-crm-guardian.timer" /etc/systemd/system/ec10-crm-guardian.timer
  sudo systemctl daemon-reload
  sudo systemctl enable --now ec10-crm-guardian.timer
fi

if [[ -f /etc/ec10-crm-backup.key && -f "$SOURCE_DEPLOY/ec10-crm-backup.sh" ]]; then
  sudo install -d -m 0700 /var/backups/ec10-crm
  sudo install -m 0755 "$SOURCE_DEPLOY/ec10-crm-backup.sh" /usr/local/bin/ec10-crm-backup
  sudo install -m 0644 "$SOURCE_DEPLOY/ec10-crm-backup.service" /etc/systemd/system/ec10-crm-backup.service
  sudo install -m 0644 "$SOURCE_DEPLOY/ec10-crm-backup.timer" /etc/systemd/system/ec10-crm-backup.timer
  sudo systemctl daemon-reload
  sudo systemctl enable --now ec10-crm-backup.timer
fi

for _ in $(seq 1 20); do
  if curl --fail --silent http://127.0.0.1:3200/health/ready >/dev/null; then
    break
  fi
  sleep 1
done

curl --fail --silent http://127.0.0.1:3200/health/ready
echo
sudo systemctl --no-pager --quiet is-active ec10-postgrest.service
sudo systemctl --no-pager --quiet is-active ec10-crm-gateway.service
sudo systemctl --no-pager --quiet is-active caddy.service

rm -rf "$SOURCE_APP" "$SOURCE_DEPLOY" "$SOURCE_ENV" "$postgrest_archive" "$caddy_archive" /tmp/postgrest /tmp/caddy
echo "EC10 Oracle gateway installed"
