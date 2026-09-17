#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/home/opc/cliente-whatsapp-crm}"
SERVICE_NAME="${SERVICE_NAME:-cliente-whatsapp-crm-bot}"

echo "== systemd =="
systemctl --no-pager --lines=0 status "$SERVICE_NAME" || true

echo
echo "== bot status =="
if [ -f "$APP_DIR/runtime/bot-status.json" ]; then
  cat "$APP_DIR/runtime/bot-status.json"
else
  echo "Status file not created yet."
fi

echo
echo "== qr files =="
ls -l "$APP_DIR/runtime"/whatsapp-qr.* 2>/dev/null || echo "QR not generated yet."
