#!/usr/bin/env python3
"""
TRUE GROW IoT — MQTT-to-API Bridge
Runs on Master Pi. Subscribes to MQTT broker, forwards sensor data to Railway API.
Buffers failed API calls to SQLite and retries them automatically.
"""

import json
import time
import signal
import sqlite3
import threading
import urllib.request
import urllib.error
from pathlib import Path

import yaml
import paho.mqtt.client as mqtt

CONFIG_PATH = Path(__file__).parent / "bridge_config.yaml"
BUFFER_DB_PATH = Path(__file__).parent / "bridge_buffer.db"
MAX_BUFFER_SIZE = 10000
FLUSH_INTERVAL = 30  # seconds between retry attempts


def load_config():
    with open(CONFIG_PATH) as f:
        return yaml.safe_load(f)


# ── SQLite retry buffer ──
class ApiRetryBuffer:
    """Persistent queue for failed API calls. SQLite WAL mode for SD card safety."""

    def __init__(self, db_path=None):
        self.db_path = str(db_path or BUFFER_DB_PATH)
        self._lock = threading.Lock()
        self._init_db()

    def _init_db(self):
        with self._lock:
            conn = sqlite3.connect(self.db_path)
            conn.execute('PRAGMA journal_mode=WAL')
            conn.execute('''
                CREATE TABLE IF NOT EXISTS api_queue (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    endpoint TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    retries INTEGER DEFAULT 0,
                    created_at REAL NOT NULL
                )
            ''')
            conn.commit()
            conn.close()

    def push(self, endpoint, payload_json):
        """Add a failed API call to retry queue."""
        with self._lock:
            try:
                conn = sqlite3.connect(self.db_path)
                conn.execute(
                    'INSERT INTO api_queue (endpoint, payload, created_at) VALUES (?, ?, ?)',
                    (endpoint, payload_json, time.time())
                )
                count = conn.execute('SELECT COUNT(*) FROM api_queue').fetchone()[0]
                if count > MAX_BUFFER_SIZE:
                    excess = count - MAX_BUFFER_SIZE
                    conn.execute('''
                        DELETE FROM api_queue WHERE id IN (
                            SELECT id FROM api_queue ORDER BY id ASC LIMIT ?
                        )
                    ''', (excess,))
                conn.commit()
                size = conn.execute('SELECT COUNT(*) FROM api_queue').fetchone()[0]
                conn.close()
                return size
            except Exception as e:
                print(f'[Buffer] Write error: {e}')
                return -1

    def peek_batch(self, limit=20):
        """Get oldest pending calls. Returns [(id, endpoint, payload_json), ...]."""
        with self._lock:
            conn = sqlite3.connect(self.db_path)
            rows = conn.execute(
                'SELECT id, endpoint, payload FROM api_queue ORDER BY id ASC LIMIT ?',
                (limit,)
            ).fetchall()
            conn.close()
            return rows

    def remove_batch(self, row_ids):
        if not row_ids:
            return
        with self._lock:
            conn = sqlite3.connect(self.db_path)
            conn.executemany('DELETE FROM api_queue WHERE id = ?', [(rid,) for rid in row_ids])
            conn.commit()
            conn.close()

    def size(self):
        with self._lock:
            conn = sqlite3.connect(self.db_path)
            count = conn.execute('SELECT COUNT(*) FROM api_queue').fetchone()[0]
            conn.close()
            return count


def post_to_api(api_url, api_key, endpoint, payload):
    data = json.dumps(payload).encode("utf-8") if isinstance(payload, dict) else payload.encode("utf-8")
    req = urllib.request.Request(
        f"{api_url}{endpoint}",
        data=data,
        headers={
            "Content-Type": "application/json",
            "X-API-Key": api_key,
        },
        method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status, resp.read().decode()
    except urllib.error.HTTPError as e:
        body = e.read().decode()[:200]
        print(f"[API] HTTP {e.code}: {body}")
        return e.code, body
    except Exception as e:
        print(f"[API] Error: {e}")
        return 0, str(e)


def flush_buffer(api_url, api_key, buffer):
    """Retry failed API calls from the buffer."""
    sent = 0
    while True:
        batch = buffer.peek_batch(20)
        if not batch:
            break
        sent_ids = []
        stop = False
        for row_id, endpoint, payload_json in batch:
            status, _ = post_to_api(api_url, api_key, endpoint, payload_json)
            if 200 <= status < 300:
                sent_ids.append(row_id)
                sent += 1
            elif 400 <= status < 500:
                # Client error (bad data) — discard, won't succeed on retry
                sent_ids.append(row_id)
                print(f"[Buffer] Discarded bad request ({status}): {payload_json[:80]}")
            else:
                # Server error or network error — stop retrying
                stop = True
                break
            time.sleep(0.05)
        buffer.remove_batch(sent_ids)
        if stop:
            break
    if sent > 0:
        remaining = buffer.size()
        print(f"[Buffer] Flushed {sent} buffered call(s), {remaining} remaining")


def main():
    config = load_config()
    api_url = config["api"]["url"].rstrip("/")
    api_key = config["api"]["key"]
    broker = config["mqtt"]["broker"]
    port = config["mqtt"].get("port", 1883)

    print(f"=== TRUE GROW IoT MQTT Bridge ===")
    print(f"MQTT: {broker}:{port}")
    print(f"API:  {api_url}")

    # Initialize retry buffer
    buffer = ApiRetryBuffer()
    buffered = buffer.size()
    if buffered > 0:
        print(f"[Buffer] {buffered} pending API call(s) from previous session")

    # MQTT callbacks
    # Zigbee sensor → zone mapping (friendly_name → {zoneId, location})
    zigbee_sensors = config.get("zigbee_sensors", {})

    def on_connect(client, userdata, flags, rc):
        if rc == 0:
            print(f"[MQTT] Connected, subscribing to grow/# and zigbee2mqtt/#")
            client.subscribe("grow/#")
            client.subscribe("zigbee2mqtt/#")
        else:
            print(f"[MQTT] Connect failed: rc={rc}")

    def on_message(client, userdata, msg):
        try:
            topic = msg.topic
            parts = topic.split("/")

            # grow/zone/{zoneId}/sensors
            if len(parts) >= 4 and parts[0] == "grow" and parts[1] == "zone":
                zone_id = parts[2]
                msg_type = parts[3]
                payload = json.loads(msg.payload.decode())

                if msg_type == "sensors":
                    payload["zoneId"] = zone_id
                    payload_json = json.dumps(payload)
                    status, body = post_to_api(api_url, api_key, "/api/sensor-data", payload_json)

                    temps = payload.get("temperatures", [])
                    t_str = ", ".join(f"{t['location']}={t['value']}°C" for t in temps)
                    co2 = payload.get("co2")
                    rh = payload.get("humidity")
                    extra = ""
                    if co2 is not None:
                        extra += f" CO2={co2}"
                    if rh is not None:
                        extra += f" RH={rh}%"

                    if 200 <= status < 300:
                        print(f"[{zone_id}] {t_str}{extra} -> {status}")
                    else:
                        # API failed — buffer for retry
                        size = buffer.push("/api/sensor-data", payload_json)
                        print(f"[{zone_id}] {t_str}{extra} -> BUFFERED ({status}, {size} pending)")

                elif msg_type == "status":
                    payload["zoneId"] = zone_id
                    status, _ = post_to_api(api_url, api_key, "/api/sensor-data/status", payload)
                    if 200 <= status < 300:
                        print(f"[{zone_id}] status: {'online' if payload.get('online') else 'offline'}")
                    else:
                        print(f"[{zone_id}] status update failed ({status})")

            # zigbee2mqtt/{friendly_name} — Zigbee sensor data
            if parts[0] == "zigbee2mqtt" and len(parts) == 2:
                device_name = parts[1]
                # Skip bridge/system topics
                if device_name in ("bridge", ""):
                    return
                sensor_cfg = zigbee_sensors.get(device_name)
                if not sensor_cfg:
                    return  # unknown device, ignore

                payload = json.loads(msg.payload.decode())
                temp = payload.get("temperature")
                humidity = payload.get("humidity")
                battery = payload.get("battery")

                if temp is None and humidity is None:
                    return  # no sensor data (e.g. just linkquality)

                # Build sensor reading in portal format
                zone_id = sensor_cfg["zone_id"]
                location = sensor_cfg.get("location", device_name)
                reading = {
                    "zoneId": zone_id,
                    "source": "zigbee",
                    "zigbee_device": device_name,
                    "zigbee_sensors": [{
                        "device": device_name,
                        "location": location,
                        "temperature": temp,
                        "humidity": humidity,
                        "battery": battery,
                    }]
                }
                payload_json = json.dumps(reading)
                status, body = post_to_api(api_url, api_key, "/api/sensor-data", payload_json)

                parts_str = []
                if temp is not None:
                    parts_str.append(f"T={temp}°C")
                if humidity is not None:
                    parts_str.append(f"RH={humidity}%")
                if battery is not None:
                    parts_str.append(f"bat={battery}%")

                if 200 <= status < 300:
                    print(f"[zigbee:{device_name}] {' '.join(parts_str)} -> {status}")
                else:
                    size = buffer.push("/api/sensor-data", payload_json)
                    print(f"[zigbee:{device_name}] {' '.join(parts_str)} -> BUFFERED ({status})")

        except json.JSONDecodeError:
            print(f"[MQTT] Invalid JSON on {msg.topic}")
        except Exception as e:
            print(f"[MQTT] Error handling {msg.topic}: {e}")

    # Create MQTT client
    client = mqtt.Client(client_id=f"truegrow-bridge-{int(time.time())}")
    if config["mqtt"].get("username"):
        client.username_pw_set(config["mqtt"]["username"], config["mqtt"].get("password", ""))
    client.on_connect = on_connect
    client.on_message = on_message

    # Graceful shutdown
    running = True
    def signal_handler(sig, frame):
        nonlocal running
        print("\n[SHUTDOWN] Stopping...")
        running = False
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    # Connect and loop
    client.connect(broker, port, keepalive=60)
    client.loop_start()
    print("[MQTT] Bridge running...")

    last_flush = 0
    while running:
        # Periodically retry buffered calls
        now = time.time()
        if now - last_flush >= FLUSH_INTERVAL and buffer.size() > 0:
            flush_buffer(api_url, api_key, buffer)
            last_flush = now
        time.sleep(1)

    client.loop_stop()
    client.disconnect()
    remaining = buffer.size()
    if remaining > 0:
        print(f"[Buffer] {remaining} pending call(s) saved for next session")
    print("[SHUTDOWN] Done.")


if __name__ == "__main__":
    main()
