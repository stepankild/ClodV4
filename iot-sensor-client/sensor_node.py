#!/usr/bin/env python3
"""
TRUE GROW IoT — Sensor Node
Reads DS18B20 (1-Wire) and STCC4 (I2C CO2/T/RH) sensors, publishes to MQTT.
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


# ── STCC4 (I2C CO2 + T + RH) ──
# Sensirion STCC4 — CO2 sensor with integrated SHT40 for T/RH
# I2C address: 0x64, protocol based on Sensirion arduino-i2c-stcc4 library
# Commands are 2-byte (MSB, LSB), responses use Sensirion CRC-8

import struct


def _sensirion_crc(data):
    """Sensirion CRC-8: polynomial 0x31, init 0xFF."""
    crc = 0xFF
    for byte in data:
        crc ^= byte
        for _ in range(8):
            if crc & 0x80:
                crc = (crc << 1) ^ 0x31
            else:
                crc = crc << 1
            crc &= 0xFF
    return crc


class STCC4:
    """STCC4 CO2/Temp/RH sensor via raw I2C (smbus2)."""

    ADDR = 0x64

    # I2C command codes (from Sensirion arduino-i2c-stcc4)
    CMD_START_CONTINUOUS  = (0x21, 0x8B)
    CMD_STOP_CONTINUOUS   = (0x3F, 0x86)
    CMD_READ_MEASUREMENT  = (0xEC, 0x05)
    CMD_EXIT_SLEEP        = (0x00, 0x00)
    CMD_ENTER_SLEEP       = (0x36, 0x50)

    def __init__(self, bus_num=1, address=None):
        import smbus2
        self.bus = smbus2.SMBus(bus_num)
        self.addr = address or self.ADDR
        self.ready = False

    def _cmd(self, cmd_tuple):
        """Send a 2-byte command."""
        self.bus.write_i2c_block_data(self.addr, cmd_tuple[0], [cmd_tuple[1]])

    def _read_words(self, n_words):
        """Read n words (each word = 2 data bytes + 1 CRC byte)."""
        n_bytes = n_words * 3
        raw = self.bus.read_i2c_block_data(self.addr, 0x00, n_bytes)
        words = []
        for i in range(n_words):
            offset = i * 3
            msb, lsb, crc = raw[offset], raw[offset + 1], raw[offset + 2]
            if _sensirion_crc([msb, lsb]) != crc:
                raise ValueError(f"CRC mismatch at word {i}: got 0x{crc:02x}, "
                                 f"expected 0x{_sensirion_crc([msb, lsb]):02x}")
            words.append((msb << 8) | lsb)
        return words

    def start(self):
        """Start continuous measurement mode."""
        try:
            self._cmd(self.CMD_EXIT_SLEEP)
            time.sleep(0.02)
        except Exception:
            pass

        try:
            self._cmd(self.CMD_STOP_CONTINUOUS)
            time.sleep(0.5)
        except Exception:
            pass

        try:
            self._cmd(self.CMD_START_CONTINUOUS)
            time.sleep(1)  # first measurement available after ~1s
            self.ready = True
            print(f"[STCC4] Continuous measurement started on 0x{self.addr:02x}")
            return True
        except Exception as e:
            print(f"[STCC4] Start error: {e}")
            return False

    def read_measurement(self):
        """Read CO2 (ppm), temperature (C), humidity (%).
        Returns (co2, temp, rh) or (None, None, None) on error."""
        try:
            self._cmd(self.CMD_READ_MEASUREMENT)
            time.sleep(0.005)  # small delay before reading
            # Response: CO2(u16) + CRC, TempRaw(u16) + CRC, RHRaw(u16) + CRC, Status(u16) + CRC
            words = self._read_words(4)
            co2_raw, temp_raw, rh_raw, status = words

            # CO2 is signed int16 in ppm
            co2 = struct.unpack('>h', struct.pack('>H', co2_raw))[0]
            # Temperature: -45 + 175 * raw / 65535
            temp = -45.0 + 175.0 * temp_raw / 65535.0
            # Humidity: -6 + 125 * raw / 65535
            rh = -6.0 + 125.0 * rh_raw / 65535.0
            rh = max(0.0, min(100.0, rh))  # clamp

            if co2 < 0 or co2 > 10000:
                return None, None, None

            return co2, round(temp, 1), round(rh, 1)
        except Exception as e:
            print(f"[STCC4] Read error: {e}")
            return None, None, None

    def stop(self):
        """Stop continuous measurement and enter sleep."""
        try:
            self._cmd(self.CMD_STOP_CONTINUOUS)
            time.sleep(0.5)
            self._cmd(self.CMD_ENTER_SLEEP)
        except Exception:
            pass


stcc4_device = None


def init_stcc4(i2c_address=0x64):
    """Initialize STCC4 sensor via smbus2."""
    global stcc4_device
    try:
        stcc4_device = STCC4(bus_num=1, address=i2c_address)
        if stcc4_device.start():
            return True
        stcc4_device = None
        return False
    except Exception as e:
        print(f"[STCC4] Init error: {e}")
        stcc4_device = None
        return False


def read_stcc4():
    """Read CO2, temperature, humidity from STCC4."""
    if stcc4_device is None or not stcc4_device.ready:
        return None, None, None
    return stcc4_device.read_measurement()


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

    # Initialize STCC4 CO2 sensor if configured
    co2_conf = config.get("sensors", {}).get("stcc4") or config.get("sensors", {}).get("scd41")
    if co2_conf and co2_conf.get("enabled", True):
        init_stcc4(co2_conf.get("address", 0x64))

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

            # Read STCC4 (CO2 + T + RH)
            co2, scd_temp, scd_rh = read_stcc4()
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
