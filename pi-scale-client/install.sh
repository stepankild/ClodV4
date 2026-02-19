#!/bin/bash
# Скрипт установки Scale Client на Raspberry Pi
# Запуск: chmod +x install.sh && ./install.sh

set -e

INSTALL_DIR="/home/stepan/pi-scale-client"
SERVICE_NAME="scale-client"

echo "=== Farm Scale Client — Установка ==="
echo "Весы: Ohaus R31P3 (RS-232 → USB)"
echo ""

# 1. Создать виртуальное окружение
echo "Создаю virtual environment..."
python3 -m venv "$INSTALL_DIR/venv"

# 2. Установить зависимости
echo "Устанавливаю зависимости..."
"$INSTALL_DIR/venv/bin/pip" install --upgrade pip
"$INSTALL_DIR/venv/bin/pip" install -r "$INSTALL_DIR/requirements.txt"

# 3. Добавить пользователя в группу dialout (доступ к serial порту)
echo "Добавляю пользователя в группу dialout (для доступа к /dev/ttyUSB0)..."
sudo usermod -a -G dialout stepan

# 4. Проверить .env
if [ ! -f "$INSTALL_DIR/.env" ]; then
    echo ""
    echo "ВАЖНО: Скопируйте .env.example в .env и заполните настройки:"
    echo "  cp $INSTALL_DIR/.env.example $INSTALL_DIR/.env"
    echo "  nano $INSTALL_DIR/.env"
    echo ""
fi

# 5. Установить systemd-сервис
echo "Устанавливаю systemd-сервис..."
sudo cp "$INSTALL_DIR/scale-client.service" "/etc/systemd/system/${SERVICE_NAME}.service"
sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"

echo ""
echo "=== Установка завершена ==="
echo ""
echo "Следующие шаги:"
echo "  1. Настройте .env:     nano $INSTALL_DIR/.env"
echo "  2. Проверьте serial:   ls /dev/ttyUSB*"
echo "  3. Запустите:          sudo systemctl start $SERVICE_NAME"
echo "  4. Проверьте логи:     sudo journalctl -u $SERVICE_NAME -f"
echo ""
echo "ПРИМЕЧАНИЕ: если это первый запуск, перелогиньтесь (или reboot)"
echo "чтобы членство в группе dialout вступило в силу."
echo ""
