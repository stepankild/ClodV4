import mqtt from 'mqtt';
import SensorReading from '../models/SensorReading.js';
import Zone from '../models/Zone.js';

// ── In-memory zone states ──
const zoneStates = new Map();

// ── Zigbee device states (propagators etc.) ──
// zoneId → { deviceName → { temperature, humidity, battery, lastSeen } }
const zigbeeStates = new Map();

export function getZigbeeDevices(zoneId) {
  return zigbeeStates.get(zoneId) || {};
}

export function setZigbeeData(zoneId, device, data) {
  if (!zigbeeStates.has(zoneId)) zigbeeStates.set(zoneId, {});
  const devices = zigbeeStates.get(zoneId);
  devices[device] = {
    ...data,
    lastSeen: new Date().toISOString(),
  };
  // Persist to MongoDB (fire-and-forget)
  Zone.updateOne(
    { zoneId },
    { $set: { [`zigbeeDevices.${device}`]: devices[device] } }
  ).catch(e => console.error(`[zigbee] DB save error: ${e.message}`));
}

/**
 * Load zigbee device states from MongoDB on startup
 */
export async function loadZigbeeStatesFromDb() {
  try {
    const zones = await Zone.find({ zigbeeDevices: { $exists: true, $ne: {} } }).lean();
    for (const zone of zones) {
      if (zone.zigbeeDevices && Object.keys(zone.zigbeeDevices).length > 0) {
        zigbeeStates.set(zone.zoneId, zone.zigbeeDevices);
        console.log(`[zigbee] Loaded ${Object.keys(zone.zigbeeDevices).length} devices for ${zone.zoneId}`);
      }
    }
  } catch (e) {
    console.error(`[zigbee] loadFromDb error: ${e.message}`);
  }
}

const ZONE_OFFLINE_TIMEOUT_MS = 90000; // 90 seconds without data = offline
const zoneTimers = new Map();

export function getZoneStates() {
  return Object.fromEntries(zoneStates);
}

export function getZoneState(zoneId) {
  return zoneStates.get(zoneId) || null;
}

// Called from HTTP ingest route — keeps in-memory state fresh
// even when MQTT broker is unreachable
export function setZoneOnlineFromHttp(zoneId, data) {
  setZoneOnline(zoneId, data);
}

function setZoneOnline(zoneId, data) {
  const state = zoneStates.get(zoneId) || { online: false, lastData: null, lastSeen: null };
  state.online = true;
  state.lastData = data;
  state.lastSeen = new Date();
  zoneStates.set(zoneId, state);

  // Reset offline timer
  if (zoneTimers.has(zoneId)) clearTimeout(zoneTimers.get(zoneId));
  zoneTimers.set(zoneId, setTimeout(() => {
    const s = zoneStates.get(zoneId);
    if (s) {
      s.online = false;
      zoneStates.set(zoneId, s);
      // Broadcast offline status
      if (globalIo) globalIo.emit('sensor:status', { zoneId, online: false });
      Zone.findOneAndUpdate({ zoneId }, { 'piStatus.online': false }).catch(() => {});
    }
  }, ZONE_OFFLINE_TIMEOUT_MS));
}

function setZoneOffline(zoneId) {
  const state = zoneStates.get(zoneId);
  if (state) {
    state.online = false;
    zoneStates.set(zoneId, state);
  }
  if (zoneTimers.has(zoneId)) {
    clearTimeout(zoneTimers.get(zoneId));
    zoneTimers.delete(zoneId);
  }
}

// ── Zigbee bridge liveness ──
// Sourced directly from the zigbee2mqtt/bridge/state MQTT topic which Z2M
// publishes as a retained message and flips to "offline" via MQTT last-will
// when the process dies. The value reflects the coordinator dongle + the
// Z2M daemon, NOT individual sensor traffic.
let zigbeeBridgeState = {
  state: 'unknown',  // 'online' | 'offline' | 'unknown'
  changedAt: null,
  // When the server starts up there's a brief window before the retained
  // message arrives. Track whether we've ever seen a real value.
  everSeen: false,
};
const zigbeeBridgeListeners = new Set();

export function getZigbeeBridgeState() {
  return { ...zigbeeBridgeState };
}

export function onZigbeeBridgeStateChange(cb) {
  zigbeeBridgeListeners.add(cb);
  return () => zigbeeBridgeListeners.delete(cb);
}

function handleZigbeeBridgeState(state) {
  const prev = zigbeeBridgeState.state;
  zigbeeBridgeState = {
    state,
    changedAt: new Date(),
    everSeen: true,
  };
  console.log(`[MQTT] zigbee2mqtt/bridge/state: ${prev} → ${state}`);
  for (const cb of zigbeeBridgeListeners) {
    try { cb(state, prev); } catch (e) { console.error('[MQTT] zigbee listener error:', e.message); }
  }
}

let globalIo = null;
let mqttClient = null;

export function initializeMqtt(io) {
  globalIo = io;

  const brokerUrl = process.env.MQTT_BROKER_URL;
  if (!brokerUrl) {
    console.log('[MQTT] MQTT_BROKER_URL not set, skipping MQTT initialization');
    return;
  }

  const options = {
    clientId: `truegrow-server-${Date.now()}`,
    clean: true,
    reconnectPeriod: 5000,
    connectTimeout: 10000,
  };

  if (process.env.MQTT_USERNAME) {
    options.username = process.env.MQTT_USERNAME;
    options.password = process.env.MQTT_PASSWORD;
  }

  mqttClient = mqtt.connect(brokerUrl, options);

  mqttClient.on('connect', () => {
    console.log('[MQTT] Connected to broker:', brokerUrl);
    mqttClient.subscribe('grow/#', (err) => {
      if (err) console.error('[MQTT] Subscribe error:', err);
      else console.log('[MQTT] Subscribed to grow/#');
    });
    // Zigbee2MQTT publishes its own liveness status at bridge/state as a
    // retained message, plus last-will flips it to "offline" if z2m dies.
    // This is far more reliable than guessing from device silence, because
    // propagator sensors are event-based and may legitimately be quiet for
    // hours when temperature/humidity is stable.
    mqttClient.subscribe('zigbee2mqtt/bridge/state', (err) => {
      if (err) console.error('[MQTT] zigbee bridge subscribe error:', err);
      else console.log('[MQTT] Subscribed to zigbee2mqtt/bridge/state');
    });
  });

  mqttClient.on('message', async (topic, message) => {
    try {
      // Z2M bridge state: {"state":"online"} | {"state":"offline"}
      if (topic === 'zigbee2mqtt/bridge/state') {
        let state = null;
        try {
          const parsed = JSON.parse(message.toString());
          state = parsed?.state || null;
        } catch {
          // older z2m versions publish the plain string "online"/"offline"
          state = message.toString().trim();
        }
        if (state === 'online' || state === 'offline') {
          handleZigbeeBridgeState(state);
        }
        return;
      }

      const parts = topic.split('/');
      // grow/zone/{zoneId}/sensors
      if (parts[0] === 'grow' && parts[1] === 'zone' && parts.length >= 4) {
        const zoneId = parts[2];
        const type = parts[3];

        if (type === 'sensors') {
          const data = JSON.parse(message.toString());
          await handleSensorData(zoneId, data);
        } else if (type === 'status') {
          const data = JSON.parse(message.toString());
          if (data.online === false) {
            setZoneOffline(zoneId);
            io.emit('sensor:status', { zoneId, online: false });
          }
        }
      }
    } catch (err) {
      console.error('[MQTT] Message handling error:', err.message);
    }
  });

  mqttClient.on('error', (err) => {
    console.error('[MQTT] Connection error:', err.message);
  });

  mqttClient.on('reconnect', () => {
    console.log('[MQTT] Reconnecting...');
  });
}

async function handleSensorData(zoneId, data) {
  // Update in-memory state
  setZoneOnline(zoneId, data);

  // Store reading in MongoDB
  const reading = new SensorReading({
    zoneId,
    timestamp: data.timestamp || new Date(),
    temperatures: data.temperatures || [],
    humidity: data.humidity ?? null,
    temperature: data.temperature ?? null,
    co2: data.co2 ?? null,
    light: data.light ?? null,
    humidifierState: data.humidifierState ?? null,
  });

  await reading.save();

  // Update zone piStatus in DB
  Zone.findOneAndUpdate(
    { zoneId },
    { 'piStatus.online': true, 'piStatus.lastSeen': new Date() },
    { upsert: false }
  ).catch(() => {});

  // Broadcast to all browser clients
  if (globalIo) {
    globalIo.emit('sensor:data', { zoneId, ...data, timestamp: reading.timestamp });
  }
}

// Publish a command to a zone (for humidifier control etc.)
export function publishToZone(zoneId, subtopic, payload) {
  if (mqttClient && mqttClient.connected) {
    mqttClient.publish(`grow/zone/${zoneId}/${subtopic}`, JSON.stringify(payload));
  }
}
