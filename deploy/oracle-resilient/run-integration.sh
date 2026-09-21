#!/usr/bin/env bash
set -euo pipefail
set -a
source /etc/ec10-crm-gateway.env
set +a
exec /usr/bin/node /opt/ec10-crm-gateway/scripts/integration-test.mjs
