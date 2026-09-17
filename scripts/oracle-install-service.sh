#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/home/opc/cliente-whatsapp-crm}"
SERVICE_NAME="${SERVICE_NAME:-cliente-whatsapp-crm-bot}"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

cd "$APP_DIR"

mkdir -p "$APP_DIR/runtime" "$APP_DIR/whatsapp-session" "$APP_DIR/media/audio"

sudo tee "$SERVICE_FILE" >/dev/null <<SERVICE
[Unit]
Description=Cliente WhatsApp CRM Bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=opc
WorkingDirectory=${APP_DIR}
Environment=NODE_ENV=production
ExecStart=/usr/bin/npm --workspace @crm/bot run start
Restart=always
RestartSec=10
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
SERVICE

sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"

echo "Service installed: $SERVICE_NAME"
echo "Start: sudo systemctl start $SERVICE_NAME"
echo "Logs: sudo journalctl -u $SERVICE_NAME -f"
