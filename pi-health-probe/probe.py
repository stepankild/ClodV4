#!/usr/bin/env python3
"""Pi health probe — Socket.io daemon.

Раз в 5 минут (+по команде probe:run-now от сервера) собирает health-snapshot
всех критичных компонентов main Pi и шлёт на Railway через Socket.io как
`pi:health`. Сервер сохраняет snapshot в Mongo + broadcast'ит браузерам.

Дизайн-решения:
  - Используем тот же SCALE_API_KEY что scale-client: одной секрет, меньше env.
    Отдельный deviceType='probe' даёт сервер-сайду слот io.probeSocket для
    целевой emit probe:run-now, не смешиваясь с каналом весов.
  - Ни одна проверка не блокирующая, timeout 5 сек на каждую. Даже если что-то
    зависло (например systemctl не отвечает) — probe всё равно отправит snapshot
    с warning на этот конкретный чек.
  - По умолчанию интервал 300 сек, конфигурируется через $PROBE_INTERVAL_SEC.
"""
import os
import sys
import json
import time
import socket as pysocket
import subprocess
import threading
from datetime import datetime, timezone
from pathlib import Path

# ── Зависимости ──
try:
    import socketio
    from dotenv import load_dotenv
    from evdev import InputDevice, list_devices
except ImportError as e:
    print(f'[probe] FATAL: missing dependency ({e}). Run install.sh.', file=sys.stderr)
    sys.exit(1)

# ── Конфиг ──
HERE = Path(__file__).resolve().parent
load_dotenv(HERE / '.env')
# Фолбэк: если нашего .env нет — пробуем scale-client'овский, там те же ключи.
if not os.environ.get('SCALE_API_KEY'):
    scale_env = Path('/home/stepan/pi-scale-client/.env')
    if scale_env.exists():
        load_dotenv(scale_env)

SERVER_URL = os.environ.get('SERVER_URL', 'https://clodv4-production.up.railway.app')
API_KEY = os.environ.get('SCALE_API_KEY')
INTERVAL_SEC = int(os.environ.get('PROBE_INTERVAL_SEC', '300'))
HOSTNAME = pysocket.gethostname()

if not API_KEY:
    print('[probe] FATAL: SCALE_API_KEY not set (need /home/stepan/pi-scale-client/.env or our own .env)', file=sys.stderr)
    sys.exit(1)

# Список systemd-юнитов для проверки. Дополняется легко (добавь новые сервисы —
# они появятся в UI автоматически).
SERVICES = [
    'scale-client',
    'zigbee2mqtt',
    'mosquitto',
    'display-proxy',
    'doorbell',
    'humidity-ctrl',
    'mqtt-bridge',
    'timelapse-server',
    'docker',
]

# Pi Zero MQTT topic для проверки freshness её сенсоров (должны публиковаться каждые 30с)
PI_ZERO_ZONE_ID = os.environ.get('PI_ZERO_ZONE_ID', 'zone-1')

# ── Утилиты ──
def run(cmd, timeout=5):
    """shell/cmd runner с timeout. Возвращает (stdout_stripped, ok)."""
    try:
        r = subprocess.run(
            cmd, shell=isinstance(cmd, str), capture_output=True, text=True, timeout=timeout
        )
        return r.stdout.strip(), r.returncode == 0
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError) as e:
        return f'ERR: {e}', False


# ── Проверки ──
def check_services():
    """systemctl is-active <unit> для каждого интересного юнита."""
    result = {}
    for svc in SERVICES:
        out, _ = run(['systemctl', 'is-active', svc])
        # возможные значения: active, inactive, failed, activating, unknown
        result[svc] = out or 'unknown'
    return result


def check_scanner():
    """Ищем evdev-устройство 'Honeywell' и пытаемся EVIOCGRAB чтобы понять,
    держит ли его scale-client эксклюзивно (ожидание)."""
    try:
        for path in list_devices():
            try:
                d = InputDevice(path)
            except (OSError, IOError):
                continue
            name = d.name or ''
            if 'Honeywell' not in name:
                d.close()
                continue
            devpath = d.path
            try:
                d.grab()
                # мы смогли grab'нуть — значит scale-client НЕ держит exclusive
                d.ungrab()
                d.close()
                return {'found': True, 'devicePath': devpath, 'name': name, 'grabbedByScaleClient': False}
            except (OSError, IOError) as e:
                # EBUSY (16) — занят другим процессом, что нам и надо
                d.close()
                return {'found': True, 'devicePath': devpath, 'name': name,
                        'grabbedByScaleClient': e.errno == 16, 'grabError': str(e)}
        return {'found': False}
    except Exception as e:
        return {'found': False, 'error': str(e)}


def check_scale_activity():
    """Последнее упоминание '[Scale] Status sent' или '[Barcode] Scanned' в
    journalctl scale-client — оценка живости цепочки."""
    out, ok = run(['journalctl', '-u', 'scale-client', '-n', '200', '--no-pager'], timeout=10)
    if not ok:
        return {'error': 'journalctl unavailable'}
    lines = [ln for ln in out.split('\n') if '[Scale]' in ln or '[Barcode]' in ln]
    if not lines:
        return {'lastActivity': None}
    last_line = lines[-1]
    # formatting journalctl: "Apr 24 21:13:22 farm python[260616]: [Scale] Status sent..."
    # парсим timestamp начала строки (локальное время хоста)
    try:
        ts_str = ' '.join(last_line.split()[:3])
        # текущий год добавляем сами — journalctl его не печатает при коротком формате
        now = datetime.now()
        ts = datetime.strptime(f'{now.year} {ts_str}', '%Y %b %d %H:%M:%S')
        # если получилось в будущем — это наверное прошлый год
        if ts > now:
            ts = ts.replace(year=now.year - 1)
        seconds_ago = int((now - ts).total_seconds())
        return {'lastActivityAt': ts.isoformat(), 'secondsAgo': seconds_ago,
                'lastLineSample': last_line[-100:]}
    except Exception as e:
        return {'error': f'parse: {e}', 'rawLast': last_line[-100:]}


def check_ha():
    """HA Docker-контейнер + HTTP ответ."""
    out, ok = run(['docker', 'inspect', '-f', '{{.State.Status}}', 'homeassistant'], timeout=5)
    state = out if ok else 'not-found'
    http_code, _ = run(['curl', '-s', '-o', '/dev/null', '-w', '%{http_code}',
                        '-m', '3', 'http://localhost:8123/'])
    return {'dockerState': state, 'httpCode': http_code or '0'}


def check_tailscale():
    out, ok = run(['tailscale', 'status', '--json'], timeout=5)
    if not ok:
        return {'error': 'tailscale status failed'}
    try:
        data = json.loads(out)
        # Ищем peer с наиболее свежим коннектом
        peers = data.get('Peer', {}) or {}
        best = None
        for _pid, p in peers.items():
            if not p.get('Online'):
                continue
            relay = p.get('Relay', '')
            cur = p.get('CurAddr', '')
            if not best:
                best = {
                    'connectionType': 'direct' if cur else ('relay:' + relay if relay else 'unknown'),
                    'derpRegion': relay,
                    'hostname': p.get('HostName'),
                }
        return best or {'connectionType': 'no-peers'}
    except Exception as e:
        return {'error': str(e)}


def check_iptables_udp_block():
    out, ok = run(['sudo', 'iptables', '-S', 'OUTPUT'], timeout=5)
    if not ok:
        return {'udpBlockActive': False, 'error': 'iptables not readable'}
    active = any('dport 41641' in line and '-j DROP' in line for line in out.split('\n'))
    return {'udpBlockActive': active}


# ── Pi Zero freshness — subscribe to mqtt last message ──
# Используем mosquitto_sub с -C 1 (одно сообщение) -W timeout. Если прилетело
# в течение timeout — значит Pi Zero активно публикует.
def check_pi_zero():
    topic = f'grow/zone/{PI_ZERO_ZONE_ID}/sensors'
    # -W timeout в секундах; wait максимум 10 сек
    out, ok = run(['mosquitto_sub', '-h', 'localhost', '-t', topic, '-C', '1', '-W', '10'], timeout=15)
    if ok and out:
        try:
            data = json.loads(out)
            ts = data.get('timestamp')
            seconds_ago = None
            if ts:
                # timestamp от Pi Zero в ISO
                try:
                    msg_ts = datetime.fromisoformat(ts.replace('Z', '+00:00'))
                    seconds_ago = int((datetime.now(timezone.utc) - msg_ts).total_seconds())
                except Exception:
                    pass
            return {'online': True, 'zoneId': PI_ZERO_ZONE_ID, 'secondsAgo': seconds_ago,
                    'lastTimestamp': ts}
        except Exception:
            return {'online': True, 'zoneId': PI_ZERO_ZONE_ID, 'secondsAgo': 0}
    return {'online': False, 'zoneId': PI_ZERO_ZONE_ID, 'note': 'no MQTT msg in 10s'}


def check_usb():
    by_id = Path('/dev/serial/by-id')
    if not by_id.exists():
        return {'sonoff': 'path-missing', 'scale': 'path-missing'}
    entries = [p.name for p in by_id.iterdir()]
    return {
        'sonoff': 'present' if any('Silicon_Labs' in e for e in entries) else 'missing',
        'scale': 'present' if any('Prolific' in e for e in entries) else 'missing',
        'entries': entries,
    }


def check_system():
    # Disk /
    out, _ = run(['df', '--output=pcent', '/'])
    try:
        disk_pct = int(out.split('\n')[-1].strip().rstrip('%'))
    except Exception:
        disk_pct = None
    # Load
    try:
        with open('/proc/loadavg') as f:
            load1 = float(f.read().split()[0])
    except Exception:
        load1 = None
    # Uptime
    try:
        with open('/proc/uptime') as f:
            uptime_sec = int(float(f.read().split()[0]))
    except Exception:
        uptime_sec = None
    # Mem
    try:
        out, _ = run(['free', '-m'])
        mem_free_mb = None
        for line in out.split('\n'):
            if line.startswith('Mem:'):
                parts = line.split()
                mem_free_mb = int(parts[6]) if len(parts) > 6 else int(parts[3])
                break
    except Exception:
        mem_free_mb = None
    return {
        'diskPercent': disk_pct,
        'load1': load1,
        'uptimeSec': uptime_sec,
        'memFreeMB': mem_free_mb,
    }


# ── Сбор ──
def run_all_checks():
    t0 = time.time()
    checks = {
        'services': check_services(),
        'scanner': check_scanner(),
        'scale': check_scale_activity(),
        'ha': check_ha(),
        'tailscale': check_tailscale(),
        'iptables': check_iptables_udp_block(),
        'piZero': check_pi_zero(),
        'usb': check_usb(),
        'system': check_system(),
    }
    duration_ms = int((time.time() - t0) * 1000)
    return {
        'timestamp': datetime.now(timezone.utc).isoformat(),
        'host': HOSTNAME,
        'durationMs': duration_ms,
        'checks': checks,
    }


# ── Socket.io client ──
sio = socketio.Client(
    reconnection=True,
    reconnection_delay=2,
    reconnection_delay_max=30,
    randomization_factor=0.5,
)

_last_emit_at = 0

@sio.event
def connect():
    print(f'[probe] connected to {SERVER_URL}')
    # Сразу после connect — emit первого snapshot'а
    _emit_now(reason='post-connect')

@sio.event
def disconnect():
    print('[probe] disconnected')

@sio.event
def connect_error(data):
    print(f'[probe] connect_error: {data}')

@sio.on('probe:run-now')
def on_run_now(_data=None):
    print('[probe] force-probe triggered by server')
    _emit_now(reason='force')


def _emit_now(reason='scheduled'):
    global _last_emit_at
    # Troттлинг: не чаще одного раза в 5 сек (защита от спама force-probe)
    if time.time() - _last_emit_at < 5:
        print(f'[probe] skip emit ({reason}) — too soon')
        return
    _last_emit_at = time.time()
    try:
        payload = run_all_checks()
        if sio.connected:
            sio.emit('pi:health', payload)
            services_ok = sum(1 for s in payload['checks']['services'].values() if s == 'active')
            total = len(payload['checks']['services'])
            print(f'[probe] emitted pi:health ({reason}; services {services_ok}/{total}, '
                  f'durationMs={payload["durationMs"]})')
        else:
            print('[probe] socket not connected, skipping emit')
    except Exception as e:
        print(f'[probe] run_all_checks error: {e}')


def main():
    print(f'[probe] starting — server={SERVER_URL} host={HOSTNAME} interval={INTERVAL_SEC}s')
    # Подключение с auth; reconnection сам разрулит сеть
    try:
        sio.connect(SERVER_URL, auth={'apiKey': API_KEY, 'deviceType': 'probe'},
                    transports=['websocket', 'polling'], wait_timeout=15)
    except Exception as e:
        print(f'[probe] initial connect failed: {e} (will retry)')

    # Scheduled tick — emit раз в INTERVAL_SEC секунд.
    def ticker():
        while True:
            time.sleep(INTERVAL_SEC)
            _emit_now(reason='scheduled')

    t = threading.Thread(target=ticker, daemon=True)
    t.start()

    # Основной поток живёт ожидая socketio events (reconnect, probe:run-now, etc)
    try:
        sio.wait()
    except KeyboardInterrupt:
        print('[probe] SIGINT — shutting down')
        sio.disconnect()


if __name__ == '__main__':
    main()
