#!/usr/bin/env python3
"""
Farm Scale Client — клиент для Raspberry Pi.

Читает вес с USB-весов через serial port и отправляет
данные в реальном времени на сервер через Socket.io.

Использование:
  python scale_client.py

Конфигурация через .env файл (см. .env.example).
"""

import os
import sys
import time
import socketio
from dotenv import load_dotenv
from scale_reader import ScaleReader

# Загрузить .env из текущей директории
load_dotenv()

# ── Конфигурация ──
SERVER_URL = os.getenv('SERVER_URL', 'http://localhost:5000')
SCALE_API_KEY = os.getenv('SCALE_API_KEY', '')
SERIAL_PORT = os.getenv('SERIAL_PORT', '/dev/ttyUSB0')
BAUD_RATE = int(os.getenv('BAUD_RATE', '9600'))
READ_INTERVAL = float(os.getenv('READ_INTERVAL', '0.05'))  # секунды между чтениями
# Режим: 'continuous' — включить CP (постоянная отправка веса),
#         'auto' — Auto Print (отправка только при стабилизации, по умолчанию на Ohaus R31P3)
SCALE_MODE = os.getenv('SCALE_MODE', 'continuous')

if not SCALE_API_KEY:
    print('ERROR: SCALE_API_KEY not set in .env')
    sys.exit(1)

# ── Socket.io клиент ──
sio = socketio.Client(
    reconnection=True,
    reconnection_delay=1,
    reconnection_delay_max=30,
    logger=False
)

# ── Scale reader ──
scale = ScaleReader(port=SERIAL_PORT, baudrate=BAUD_RATE)


@sio.event
def connect():
    print(f'[OK] Connected to server: {SERVER_URL}')


@sio.event
def disconnect():
    print('[!] Disconnected from server, will reconnect...')


@sio.event
def connect_error(data):
    print(f'[!] Connection error: {data}')


def connect_to_server():
    """Подключиться к серверу Socket.io с авторизацией."""
    print(f'Connecting to {SERVER_URL}...')
    sio.connect(
        SERVER_URL,
        auth={
            'apiKey': SCALE_API_KEY,
            'deviceType': 'scale'
        },
        transports=['websocket', 'polling'],
        wait_timeout=10
    )


def connect_to_scale():
    """Подключиться к USB-весам через serial."""
    try:
        scale.connect()
        print(f'[OK] Scale connected on {SERIAL_PORT} at {BAUD_RATE} baud')
        # Включить continuous print если настроено
        if SCALE_MODE == 'continuous':
            time.sleep(0.5)  # дать весам время инициализироваться
            scale.enable_continuous_print()
            print('[OK] Continuous print (CP) enabled — Ohaus будет слать вес постоянно')
        else:
            print(f'[OK] Mode: {SCALE_MODE} — весы шлют данные сами при стабилизации')
        return True
    except Exception as e:
        print(f'[!] Failed to open serial port {SERIAL_PORT}: {e}')
        return False


def main():
    """Главный цикл: читать вес → отправить на сервер."""
    # Подключаемся к весам
    if not connect_to_scale():
        print('Retrying scale connection...')
        if not scale.reconnect(max_retries=10, delay=3):
            print('Could not connect to scale. Check USB connection.')
            sys.exit(1)

    # Подключаемся к серверу
    try:
        connect_to_server()
    except Exception as e:
        print(f'Could not connect to server: {e}')
        print('Will keep retrying...')
        # Socket.io авто-реконнект справится

    last_weight = None
    last_stable = None
    consecutive_errors = 0
    max_consecutive_errors = 10

    print(f'\nReading scale every {READ_INTERVAL}s...\n')

    while True:
        try:
            # Если serial отвалился — переподключаемся
            if not scale.is_connected():
                print('Scale disconnected, reconnecting...')
                if scale.reconnect(max_retries=5, delay=2):
                    consecutive_errors = 0
                else:
                    # Уведомить сервер об ошибке
                    if sio.connected:
                        sio.emit('scale:error', {'message': 'Serial port lost'})
                    time.sleep(5)
                    continue

            # Читаем вес
            reading = scale.read_weight()

            if reading is not None:
                weight, unit, stable = reading
                consecutive_errors = 0

                # Отправляем только если вес или стабильность изменились
                if weight != last_weight or stable != last_stable:
                    if sio.connected:
                        sio.emit('scale:weight', {
                            'weight': weight,
                            'unit': unit,
                            'stable': stable
                        })
                    last_weight = weight
                    last_stable = stable
            else:
                consecutive_errors += 1
                if consecutive_errors >= max_consecutive_errors:
                    print(f'No valid readings for {consecutive_errors} attempts, reconnecting...')
                    scale.reconnect(max_retries=3, delay=1)
                    consecutive_errors = 0

            time.sleep(READ_INTERVAL)

        except KeyboardInterrupt:
            print('\nStopping...')
            break
        except Exception as e:
            print(f'Error in main loop: {e}')
            consecutive_errors += 1
            time.sleep(1)

    # Cleanup
    scale.close()
    if sio.connected:
        sio.disconnect()
    print('Done.')


if __name__ == '__main__':
    main()
