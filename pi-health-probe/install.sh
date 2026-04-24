#!/bin/bash
# install.sh — поставить pi-health-probe как systemd-сервис.
# Запуск: sudo ./install.sh (из папки pi-health-probe, скопированной на Pi)

set -e

HERE="$(cd "$(dirname "$0")" && pwd)"
SERVICE="pi-health-probe"
USER_NAME="stepan"

echo "=== 1. Python venv + deps ==="
cd "$HERE"
if [ ! -d venv ]; then
  sudo -u "$USER_NAME" python3 -m venv venv
fi
sudo -u "$USER_NAME" ./venv/bin/pip install --upgrade pip >/dev/null
sudo -u "$USER_NAME" ./venv/bin/pip install -r requirements.txt

echo "=== 2. .env (reuse SCALE_API_KEY from scale-client) ==="
if [ ! -f .env ]; then
  # Берём SCALE_API_KEY из scale-client .env и SERVER_URL оттуда же
  SCALE_ENV="/home/$USER_NAME/pi-scale-client/.env"
  if [ -f "$SCALE_ENV" ]; then
    KEY=$(grep '^SCALE_API_KEY=' "$SCALE_ENV" | cut -d'=' -f2-)
    URL=$(grep '^SERVER_URL=' "$SCALE_ENV" | cut -d'=' -f2-)
    cat > .env <<EOF
SERVER_URL=$URL
SCALE_API_KEY=$KEY
PROBE_INTERVAL_SEC=300
PI_ZERO_ZONE_ID=zone-1
EOF
    chown "$USER_NAME:$USER_NAME" .env
    chmod 600 .env
    echo "Created .env from scale-client credentials"
  else
    echo "WARN: $SCALE_ENV not found — create pi-health-probe/.env manually"
  fi
else
  echo "Using existing .env"
fi

echo "=== 3. sudoers rule for iptables read (no password) ==="
# Probe читает iptables -S для проверки UDP-блока. Даём точечное право
# без пароля на read-only проверку (без опасных -I/-D).
SUDOERS_FILE=/etc/sudoers.d/pi-health-probe
if [ ! -f "$SUDOERS_FILE" ]; then
  echo "$USER_NAME ALL=(root) NOPASSWD: /usr/sbin/iptables -S OUTPUT, /usr/sbin/iptables -S" > "$SUDOERS_FILE"
  chmod 440 "$SUDOERS_FILE"
  echo "Created $SUDOERS_FILE"
fi

echo "=== 4. systemd service ==="
cp "$HERE/$SERVICE.service" "/etc/systemd/system/$SERVICE.service"
systemctl daemon-reload
systemctl enable "$SERVICE.service"
systemctl restart "$SERVICE.service"
sleep 3

echo "=== 5. status ==="
systemctl is-active "$SERVICE" && echo "$SERVICE is active"
echo
echo "Last log lines:"
journalctl -u "$SERVICE" -n 15 --no-pager | tail -15
echo
echo "=== Done. Tail live log:  journalctl -u $SERVICE -f"
