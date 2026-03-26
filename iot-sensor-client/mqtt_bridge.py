#!/usr/bin/env python3
"""
TRUE GROW IoT — MQTT-to-API Bridge
Runs on Master Pi. Subscribes to MQTT broker, forwards sensor data to Railway API.
"""

import json
import time
import signal
import urllib.request
import urllib.error
from pathlib import Path

import yaml
import paho.mqtt.client as mqtt

CONFIG_PATH = Path(__file__).parent / "bridge_config.yaml"


def load_config():
    with open(CONFIG_PATH) as f:
        return yaml.safe_load(f)


def post_to_api(api_url, api_key, endpoint, payload):
    data = json.dumps(payload).encode("utf-8")
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


def main():
    config = load_config()
    api_url = config["api"]["url"].rstrip("/")
    api_key = config["api"]["key"]
    broker = config["mqtt"]["broker"]
    port = config["mqtt"].get("port", 1883)

    print(f"=== TRUE GROW IoT MQTT Bridge ===")
    print(f"MQTT: {broker}:{port}")
    print(f"API:  {api_url}")

    # MQTT callbacks
    def on_connect(client, userdata, flags, rc):
        if rc == 0:
            print(f"[MQTT] Connected, subscribing to grow/#")
            client.subscribe("grow/#")
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
                    status, body = post_to_api(api_url, api_key, "/api/sensor-data", payload)
                    temps = payload.get("temperatures", [])
                    t_str = ", ".join(f"{t['location']}={t['value']}°C" for t in temps)
                    co2 = payload.get("co2")
                    rh = payload.get("humidity")
                    extra = ""
                    if co2 is not None:
                        extra += f" CO2={co2}"
                    if rh is not None:
                        extra += f" RH={rh}%"
                    print(f"[{zone_id}] {t_str}{extra} -> {status}")

                elif msg_type == "status":
                    payload["zoneId"] = zone_id
                    post_to_api(api_url, api_key, "/api/sensor-data/status", payload)
                    print(f"[{zone_id}] status: {'online' if payload.get('online') else 'offline'}")

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

    while running:
        time.sleep(1)

    client.loop_stop()
    client.disconnect()
    print("[SHUTDOWN] Done.")


if __name__ == "__main__":
    main()
