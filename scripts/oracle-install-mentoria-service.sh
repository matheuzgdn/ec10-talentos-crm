#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/home/opc/cliente-whatsapp-crm}"
SERVICE_NAME="${SERVICE_NAME:-cliente-whatsapp-crm-bot-mentoria}"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

cd "$APP_DIR"

mkdir -p \
  "$APP_DIR/runtime/mentoria-prime" \
  "$APP_DIR/whatsapp-session-mentoria-prime" \
  "$APP_DIR/media/audio/mentoria-prime"

sudo tee "$SERVICE_FILE" >/dev/null <<SERVICE
[Unit]
Description=Cliente WhatsApp CRM Bot - Mentoria Prime
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=opc
WorkingDirectory=${APP_DIR}
Environment=NODE_ENV=production
Environment=BOT_ENABLED=true
Environment=BOT_INSTANCE_ID=mentoria_prime
Environment=BOT_INSTANCE_LABEL=WhatsApp Mentoria Prime
Environment=BOT_SESSION_PATH=./whatsapp-session-mentoria-prime
Environment=BOT_QR_PATH=./runtime/mentoria-prime/whatsapp-qr.png
Environment=BOT_QR_TEXT_PATH=./runtime/mentoria-prime/whatsapp-qr.txt
Environment=BOT_STATUS_PATH=./runtime/mentoria-prime/bot-status.json
Environment=BOT_HTTP_PORT=3002
Environment=BOT_OUTBOUND_ALLOWED_PREFIXES=site_bot:mentoria_prime:,media/audio/mentoria-prime/
ExecStart=/usr/bin/npm --workspace @crm/bot run start
Restart=always
RestartSec=10
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
SERVICE

sudo systemctl daemon-reload

echo "Service installed: $SERVICE_NAME"
echo "Enable when ready: sudo systemctl enable $SERVICE_NAME"
echo "Start when ready: sudo systemctl start $SERVICE_NAME"
echo "Logs: sudo journalctl -u $SERVICE_NAME -f"
