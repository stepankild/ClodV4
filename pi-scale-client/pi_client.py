#!/usr/bin/env python3
"""
Farm Pi Client — клиент для Raspberry Pi.

Читает данные с двух USB-устройств и отправляет на сервер через Socket.io:
  1. Весы (Ohaus R31P3) — serial port, непрерывные показания веса
  2. Сканер штрихкодов (Honeywell Voyager XP 1470) — HID input, скан при нажатии

Использование:
  python pi_client.py

Конфигурация через .env файл (см. .env.example).
"""

import os
import sys
import time
import threading
from datetime import datetime
import socketio
from dotenv import load_dotenv
from scale_reader import ScaleReader
from event_buffer import BarcodeQueue, LatestWeightBuffer

# Загрузить .env из текущей директории
load_dotenv()

# ── Конфигурация ──
SERVER_URL = os.getenv('SERVER_URL', 'http://localhost:5000')
SCALE_API_KEY = os.getenv('SCALE_API_KEY', '')
SERIAL_PORT = os.getenv('SERIAL_PORT', '/dev/ttyUSB0')
BAUD_RATE = int(os.getenv('BAUD_RATE', '9600'))
READ_INTERVAL = float(os.getenv('READ_INTERVAL', '0.05'))  # секунды между чтениями
SCALE_MODE = os.getenv('SCALE_MODE', 'continuous')
BARCODE_DEVICE = os.getenv('BARCODE_DEVICE', '')  # путь к /dev/input/eventX или пусто для автоопределения

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

# ── Offline buffers ──
barcode_queue = BarcodeQueue()
weight_buffer = LatestWeightBuffer()

pending = barcode_queue.size()
if pending > 0:
    print(f'[Buffer] {pending} barcode scan(s) pending from previous session')

# ── Barcode reader (опционально — evdev может быть не установлен) ──
barcode = None
try:
    from barcode_reader import BarcodeReader
    barcode = BarcodeReader(
        device_path=BARCODE_DEVICE if BARCODE_DEVICE else None
    )
except ImportError:
    print('[Barcode] evdev not installed — barcode scanner disabled')
    print('[Barcode] To enable: pip install evdev')


@sio.event
def connect():
    print(f'[OK] Connected to server: {SERVER_URL}')
    # Flush буферизованных данных при (пере)подключении
    flush_thread = threading.Thread(target=flush_buffers, daemon=True)
    flush_thread.start()


@sio.event
def disconnect():
    print('[!] Disconnected from server, will reconnect...')


@sio.event
def connect_error(data):
    print(f'[!] Connection error: {data}')


def flush_buffers():
    """Отправить все буферизованные данные на сервер после (пере)подключения."""
    time.sleep(0.5)  # Дать сокету стабилизироваться

    # 1. Flush штрихкодов (критичные данные)
    queued = barcode_queue.peek_all()
    if queued:
        print(f'[Buffer] Flushing {len(queued)} buffered barcode scan(s)...')
        if sio.connected:
            sio.emit('pi:sync_start', {'barcodeCount': len(queued)})

        sent = 0
        for row_id, barcode_code, scanned_at in queued:
            if not sio.connected:
                print(f'[Buffer] Lost connection during flush, {len(queued) - sent} remaining')
                return
            sio.emit('barcode:scan', {
                'barcode': barcode_code,
                'buffered': True,
                'scannedAt': scanned_at
            })
            barcode_queue.remove(row_id)
            sent += 1
            print(f'[Buffer] Sent buffered barcode: {barcode_code}')
            time.sleep(0.05)  # Небольшая задержка чтобы не флудить сервер

        if sio.connected:
            sio.emit('pi:sync_complete', {'barcodeCount': sent})
        print(f'[Buffer] Flush complete: {sent} barcode(s) sent')

    # 2. Отправить последний буферизованный вес
    weight_data = weight_buffer.get_and_clear()
    if weight_data and sio.connected:
        w, u, s = weight_data
        sio.emit('scale:weight', {
            'weight': w,
            'unit': u,
            'stable': s
        })
        print(f'[Buffer] Sent buffered weight: {w} {u}')


def connect_to_server():
    """Подключиться к серверу Socket.io с авторизацией."""
    print(f'Connecting to {SERVER_URL}...')
    sio.connect(
        SERVER_URL,
        auth={
            'apiKey': SCALE_API_KEY,
            'deviceType': 'pi'
        },
        transports=['websocket', 'polling'],
        wait_timeout=10
    )


def connect_to_scale():
    """Подключиться к USB-весам через serial."""
    try:
        scale.connect()
        print(f'[OK] Scale connected on {SERIAL_PORT} at {BAUD_RATE} baud')
        if SCALE_MODE == 'continuous':
            time.sleep(0.5)
            scale.enable_continuous_print()
            print('[OK] Continuous print (CP) enabled + IP polling for unstable readings')
        else:
            print(f'[OK] Mode: {SCALE_MODE}')
        return True
    except Exception as e:
        print(f'[!] Failed to open serial port {SERIAL_PORT}: {e}')
        return False


def connect_to_barcode():
    """Подключиться к USB-сканеру штрихкодов."""
    if barcode is None:
        return False
    try:
        barcode.connect()
        return True
    except (FileNotFoundError, OSError) as e:
        print(f'[!] Barcode scanner not found: {e}')
        return False


# ── Поток чтения штрихкодов ──
def barcode_loop():
    """Фоновый поток: читать штрихкоды и отправлять на сервер."""
    if barcode is None:
        return

    # Начальное подключение
    if not connect_to_barcode():
        print('[Barcode] Will retry in background...')

    wait_cycles = 0

    while True:
        try:
            # Переподключение если отвалился
            if not barcode.is_connected():
                print('[Barcode] Scanner disconnected, reconnecting...')
                if not barcode.reconnect(max_retries=5, delay=5):
                    print('[Barcode] Could not reconnect, retrying in 10s...')
                    time.sleep(10)
                    continue
                wait_cycles = 0

            # Чтение с select-based timeout — ждём скан
            code = barcode.read_barcode(timeout=5)
            wait_cycles += 1

            if code is not None:
                print(f'[Barcode] Scanned: {code}')
                wait_cycles = 0
                if sio.connected:
                    sio.emit('barcode:scan', {'barcode': code})
                    print(f'[Barcode] Sent to server: {code}')
                else:
                    # Буферизуем вместо потери
                    queue_size = barcode_queue.push(code)
                    print(f'[Barcode] Buffered scan: {code} (queue: {queue_size})')
            elif wait_cycles % 12 == 0:
                # Каждые ~60 секунд — показать что поток жив
                print(f'[Barcode] Waiting for scan... (connected: {barcode.is_connected()})')

        except Exception as e:
            print(f'[Barcode] Error: {e}')
            time.sleep(2)


def emit_scale_status(connected):
    """Отправить статус весов на сервер."""
    if sio.connected:
        sio.emit('scale:status', {'connected': connected})
        print(f'[Scale] Status sent: connected={connected}')


def emit_debug_info(last_weight, consecutive_errors, start_time):
    """Отправить диагностику на сервер (для дебаг-панели в UI)."""
    if not sio.connected:
        return
    debug_data = {
        'scaleConnected': scale.is_connected(),
        'serialPort': SERIAL_PORT,
        'barcodeConnected': barcode.is_connected() if barcode else False,
        'uptime': round(time.time() - start_time),
        'lastWeight': last_weight,
        'errorCount': consecutive_errors,
        'piTime': datetime.now().isoformat(),
        # Статистика буфера
        'bufferedBarcodes': barcode_queue.size(),
        'hasBufferedWeight': weight_buffer.has_value(),
    }
    sio.emit('scale:debug', debug_data)


def main():
    """Главный цикл: весы + сканер → отправить на сервер."""
    start_time = time.time()

    # Подключаемся к весам
    scale_was_connected = False
    if connect_to_scale():
        scale_was_connected = True
    else:
        print('Retrying scale connection...')
        if scale.reconnect(max_retries=10, delay=3):
            scale_was_connected = True
        else:
            print('Could not connect to scale. Will keep trying in main loop...')

    # Подключаемся к серверу
    try:
        connect_to_server()
    except Exception as e:
        print(f'Could not connect to server: {e}')
        print('Will keep retrying...')

    # Отправить начальный статус весов
    if sio.connected:
        emit_scale_status(scale_was_connected)

    # Запускаем поток чтения штрихкодов
    if barcode is not None:
        barcode_thread = threading.Thread(target=barcode_loop, daemon=True)
        barcode_thread.start()
        print('[OK] Barcode scanner thread started')
    else:
        print('[!] Barcode scanner disabled (evdev not available)')

    # ── Главный цикл: чтение весов ──
    last_weight = None
    last_stable = None
    consecutive_errors = 0
    max_consecutive_errors = 10
    last_debug_time = 0
    last_ip_time = 0
    DEBUG_INTERVAL = 5  # секунд между отправками debug
    IP_POLL_INTERVAL = 0.3  # интервал IP-запросов (получить вес даже нестабильный)

    print(f'\nReading scale every {READ_INTERVAL}s (IP polling every {IP_POLL_INTERVAL}s)...\n')

    while True:
        try:
            now = time.time()

            # Периодическая отправка диагностики (каждые 5 сек)
            if now - last_debug_time >= DEBUG_INTERVAL:
                emit_debug_info(last_weight, consecutive_errors, start_time)
                last_debug_time = now

            if not scale.is_connected():
                print('Scale disconnected, reconnecting...')
                # Сообщить что весы отключились
                if scale_was_connected:
                    emit_scale_status(False)
                    scale_was_connected = False

                if scale.reconnect(max_retries=5, delay=2):
                    consecutive_errors = 0
                    # Весы вернулись — сообщить и включить CP
                    if SCALE_MODE == 'continuous':
                        time.sleep(0.5)
                        scale.enable_continuous_print()
                    emit_scale_status(True)
                    scale_was_connected = True
                else:
                    if sio.connected:
                        sio.emit('scale:error', {'message': 'Serial port lost'})
                    time.sleep(5)
                    continue

            # Стратегия: сначала пробуем прочитать данные из CP-потока.
            # Если CP не даёт данных (нестабильный вес), используем IP-запрос.
            reading = scale.read_weight()

            if reading is None and (now - last_ip_time) >= IP_POLL_INTERVAL:
                # CP не дал данных — запрашиваем текущий вес через IP
                reading = scale.read_weight_immediate()
                last_ip_time = now

            if reading is not None:
                weight, unit, stable = reading
                consecutive_errors = 0

                # Если до этого весы считались отключёнными — сообщить что вернулись
                if not scale_was_connected:
                    emit_scale_status(True)
                    scale_was_connected = True

                if weight != last_weight or stable != last_stable:
                    if sio.connected:
                        sio.emit('scale:weight', {
                            'weight': weight,
                            'unit': unit,
                            'stable': stable
                        })
                    else:
                        # Буферизуем только последний вес (перезаписывает предыдущий)
                        weight_buffer.set(weight, unit, stable)
                    last_weight = weight
                    last_stable = stable
            else:
                consecutive_errors += 1
                if consecutive_errors >= max_consecutive_errors:
                    print(f'No valid readings for {consecutive_errors} attempts (buffer flush, not a disconnect)')
                    consecutive_errors = 0  # сброс счётчика — это НЕ потеря связи, reconnect не нужен

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
    if barcode is not None:
        barcode.close()
    if sio.connected:
        sio.disconnect()
    print('Done.')


if __name__ == '__main__':
    main()
