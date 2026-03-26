#!/usr/bin/env python3
"""
TRUE GROW IoT — Sensor Node
Reads DS18B20 (1-Wire) and SCD41 (I2C) sensors, publishes to MQTT.
"""

import json
import time
import signal
import sys
from datetime import datetime, timezone
from pathlib import Path

import yaml
import paho.mqtt.client as mqtt

# ── Load config ──
CONFIG_PATH = Path(__file__).parent / "config.yaml"


def load_config():
    with open(CONFIG_PATH) as f:
        return yaml.safe_load(f)


# ── DS18B20 (1-Wire) ──
W1_DEVICES_PATH = Path("/sys/bus/w1/devices")


def read_ds18b20_sensors(sensor_config):
    """Read all DS18B20 sensors from 1-Wire bus."""
    results = []
    for sensor in sensor_config:
        sensor_id = sensor["id"]
        location = sensor.get("location", "unknown")
        temp_path = W1_DEVICES_PATH / sensor_id / "temperature"
        try:
            raw = temp_path.read_text().strip()
            temp_c = int(raw) / 1000.0
            if -55 <= temp_c <= 125:  # valid DS18B20 range
                results.append({
                    "sensorId": sensor_id,
                    "location": location,
                    "value": round(temp_c, 2)
                })
            else:
                print(f"[DS18B20] {sensor_id}: out of range ({temp_c}°C)")
        except FileNotFoundError:
            print(f"[DS18B20] {sensor_id}: not found at {temp_path}")
        except Exception as e:
            print(f"[DS18B20] {sensor_id}: error: {e}")
    return results


# ── SCD41 (I2C CO2 + T + RH) ──
SCD41_AVAILABLE = False
try:
    from sensirion_i2c_driver import I2cConnection, LinuxI2cTransceiver
    from sensirion_i2c_scd import Scd4xI2cDevice
    SCD41_AVAILABLE = True
except ImportError:
    print("[SCD41] sensirion-i2c-scd not installed, skipping CO2 sensor")

scd41_device = None


def init_scd41(i2c_address=0x62):
    """Initialize SCD41 sensor."""
    global scd41_device
    if not SCD41_AVAILABLE:
        return False
    try:
        i2c = LinuxI2cTransceiver("/dev/i2c-1")
        connection = I2cConnection(i2c)
        scd41_device = Scd4xI2cDevice(connection)
        scd41_device.stop_periodic_measurement()
        time.sleep(0.5)
        scd41_device.start_periodic_measurement()
        print(f"[SCD41] Initialized on I2C address 0x{i2c_address:02x}")
        return True
    except Exception as e:
        print(f"[SCD41] Init error: {e}")
        return False


def read_scd41():
    """Read CO2, temperature, humidity from SCD41."""
    if scd41_device is None:
        return None, None, None
    try:
        if scd41_device.get_data_ready_status():
            co2, temp, rh = scd41_device.read_measurement()
            return (
                co2.co2 if hasattr(co2, 'co2') else float(co2),
                temp.degrees_celsius if hasattr(temp, 'degrees_celsius') else float(temp),
                rh.percent_rh if hasattr(rh, 'percent_rh') else float(rh)
            )
    except Exception as e:
        print(f"[SCD41] Read error: {e}")
    return None, None, None


# ── MQTT ──
def create_mqtt_client(config):
    """Create and connect MQTT client with LWT."""
    mqtt_conf = config["mqtt"]
    zone_id = config["zone_id"]

    client = mqtt.Client(
        client_id=f"truegrow-{zone_id}-{int(time.time())}",
        protocol=mqtt.MQTTv311
    )

    if mqtt_conf.get("username"):
        client.username_pw_set(mqtt_conf["username"], mqtt_conf.get("password", ""))

    # Last Will and Testament — sent by broker if we disconnect ungracefully
    client.will_set(
        f"grow/zone/{zone_id}/status",
        json.dumps({"online": False}),
        qos=1,
        retain=True
    )

    def on_connect(client, userdata, flags, rc):
        if rc == 0:
            print(f"[MQTT] Connected to {mqtt_conf['broker']}:{mqtt_conf.get('port', 1883)}")
            # Publish online status
            client.publish(
                f"grow/zone/{zone_id}/status",
                json.dumps({"online": True}),
                qos=1,
                retain=True
            )
        else:
            print(f"[MQTT] Connection failed: rc={rc}")

    def on_disconnect(client, userdata, rc):
        print(f"[MQTT] Disconnected (rc={rc})")

    client.on_connect = on_connect
    client.on_disconnect = on_disconnect

    try:
        client.connect(
            mqtt_conf["broker"],
            mqtt_conf.get("port", 1883),
            keepalive=60
        )
        client.loop_start()
        return client
    except Exception as e:
        print(f"[MQTT] Connection error: {e}")
        return None


# ── Main loop ──
def main():
    config = load_config()
    zone_id = config["zone_id"]
    interval = config.get("interval", 30)

    print(f"=== TRUE GROW IoT Sensor Node ===")
    print(f"Zone: {zone_id} ({config.get('zone_name', '')})")
    print(f"Interval: {interval}s")

    # Initialize SCD41 if configured
    scd41_conf = config.get("sensors", {}).get("scd41")
    if scd41_conf and scd41_conf.get("enabled", True):
        init_scd41(scd41_conf.get("address", 0x62))

    # Connect MQTT
    mqtt_client = create_mqtt_client(config)

    # Graceful shutdown
    running = True
    def signal_handler(sig, frame):
        nonlocal running
        print("\n[SHUTDOWN] Stopping...")
        running = False
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    ds18b20_config = config.get("sensors", {}).get("ds18b20", [])

    while running:
        try:
            payload = {
                "zoneId": zone_id,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }

            # Read DS18B20 temperatures
            temps = read_ds18b20_sensors(ds18b20_config)
            if temps:
                payload["temperatures"] = temps

            # Read SCD41 (CO2 + T + RH)
            co2, scd_temp, scd_rh = read_scd41()
            if co2 is not None:
                payload["co2"] = round(co2, 0)
            if scd_temp is not None:
                payload["temperature"] = round(scd_temp, 1)
            if scd_rh is not None:
                payload["humidity"] = round(scd_rh, 1)

            # Publish
            topic = f"grow/zone/{zone_id}/sensors"
            msg = json.dumps(payload)
            if mqtt_client and mqtt_client.is_connected():
                mqtt_client.publish(topic, msg, qos=0)
                print(f"[PUB] {topic}: {msg[:120]}...")
            else:
                print(f"[LOCAL] {msg[:120]}...")

            time.sleep(interval)

        except Exception as e:
            print(f"[ERROR] {e}")
            time.sleep(5)

    # Cleanup
    if mqtt_client:
        mqtt_client.publish(
            f"grow/zone/{zone_id}/status",
            json.dumps({"online": False}),
            qos=1,
            retain=True
        )
        mqtt_client.loop_stop()
        mqtt_client.disconnect()

    print("[SHUTDOWN] Done.")


if __name__ == "__main__":
    main()
