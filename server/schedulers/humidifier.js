import Zone from '../models/Zone.js';
import SensorReading from '../models/SensorReading.js';
import HumidifierLog from '../models/HumidifierLog.js';

// Track current state to avoid spamming HA with duplicate commands
const zoneStates = new Map(); // zoneId -> 'on' | 'off' | null

// Pump entity — must be ON when any humidifier is ON
const PUMP_ENTITY_ID = 'switch.cuco_v2eur_189e_switch';
let pumpState = null; // 'on' | 'off' | null

/**
 * Seed zoneStates from the last log entry for each auto-mode zone.
 * Prevents phantom OFF commands after Railway restart.
 */
async function seedStatesFromLog() {
  try {
    const zones = await Zone.find({ 'config.humidifierMode': { $exists: true } }).lean();
    for (const zone of zones) {
      const lastLog = await HumidifierLog.findOne({ zoneId: zone.zoneId })
        .sort({ timestamp: -1 }).lean();
      if (lastLog) {
        zoneStates.set(zone.zoneId, lastLog.action); // 'on' or 'off'
        console.log(`[humidifier] ${zone.zoneId}: restored state="${lastLog.action}" from log`);
      }
    }
  } catch (e) {
    console.error('[humidifier] seedStatesFromLog error:', e.message);
  }
}

/**
 * Turn humidifier on/off via Home Assistant API
 */
async function haSwitch(entityId, action) {
  const haUrl = process.env.HA_URL || 'http://localhost:8123';
  const haToken = process.env.HA_TOKEN;
  if (!haToken) {
    console.error('[humidifier] HA_TOKEN not configured');
    return false;
  }
  try {
    const resp = await fetch(`${haUrl}/api/services/switch/turn_${action}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${haToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ entity_id: entityId })
    });
    if (!resp.ok) {
      console.error(`[humidifier] HA error: ${resp.status}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[humidifier] HA request error:', e.message);
    return false;
  }
}

/**
 * Get current humidity from latest sensor reading
 * Prefers SHT45 (humidity_sht45) as it's more accurate, falls back to STCC4 (humidity)
 */
async function getCurrentHumidity(zoneId) {
  const reading = await SensorReading.findOne({ zoneId })
    .sort({ timestamp: -1 })
    .lean();
  if (!reading) return null;

  // Check reading is fresh (< 5 min old)
  const age = Date.now() - new Date(reading.timestamp).getTime();
  if (age > 5 * 60 * 1000) return null;

  // Prefer SHT45, fallback to STCC4
  return reading.humidity_sht45 ?? reading.humidity ?? null;
}

/**
 * Sync pump state: ON if any humidifier is ON, OFF if all are OFF.
 * Checks both auto-mode states (zoneStates map) and manual-on zones.
 */
async function syncPump() {
  try {
    // Check if any zone has humidifier ON (auto or manual_on)
    const allZones = await Zone.find({
      'config.humidifierMode': { $exists: true }
    }).lean();

    let anyOn = false;

    for (const zone of allZones) {
      const mode = zone.config?.humidifierMode;
      if (mode === 'manual_on') {
        anyOn = true;
        break;
      }
      if (mode === 'auto' && zoneStates.get(zone.zoneId) === 'on') {
        anyOn = true;
        break;
      }
    }

    const desiredPump = anyOn ? 'on' : 'off';

    if (pumpState !== desiredPump) {
      console.log(`[humidifier] Pump ${PUMP_ENTITY_ID}: ${pumpState} -> ${desiredPump} (any humidifier on: ${anyOn})`);
      const ok = await haSwitch(PUMP_ENTITY_ID, desiredPump);
      if (ok) {
        pumpState = desiredPump;
      }
    }
  } catch (e) {
    console.error('[humidifier] syncPump error:', e.message);
  }
}

/**
 * Check humidity for all auto-mode zones and control humidifiers
 */
async function checkHumidity() {
  try {
    const zones = await Zone.find({ 'config.humidifierMode': 'auto' }).lean();

    for (const zone of zones) {
      const { zoneId } = zone;
      const rhLow = zone.config?.rhLow ?? 60;
      const rhHigh = zone.config?.rhHigh ?? 70;
      const entityId = zone.config?.humidifierEntityId;
      if (!entityId) continue; // no plug configured

      const humidity = await getCurrentHumidity(zoneId);
      if (humidity == null) continue; // no fresh data, skip

      const currentState = zoneStates.get(zoneId);

      if (humidity < rhLow && currentState !== 'on') {
        // Humidity too low -> turn ON
        console.log(`[humidifier] ${zoneId}: RH=${humidity}% < ${rhLow}% -> ON`);
        const ok = await haSwitch(entityId, 'on');
        if (ok) {
          zoneStates.set(zoneId, 'on');
          await HumidifierLog.create({ zoneId, action: 'on', trigger: 'auto', humidity });
        }
      } else if (humidity > rhHigh && currentState !== 'off') {
        // Humidity reached target -> turn OFF
        console.log(`[humidifier] ${zoneId}: RH=${humidity}% > ${rhHigh}% -> OFF`);
        const ok = await haSwitch(entityId, 'off');
        if (ok) {
          zoneStates.set(zoneId, 'off');
          await HumidifierLog.create({ zoneId, action: 'off', trigger: 'auto', humidity });
        }
      }
    }

    // After all humidifier checks, sync pump
    await syncPump();
  } catch (e) {
    console.error('[humidifier] Scheduler error:', e.message);
  }
}

/**
 * Initialize the humidifier scheduler (runs every 30 seconds)
 */
/**
 * Exported for use by controlHumidifier API — sync pump after manual on/off
 */
export { syncPump };

export async function initHumidifierScheduler() {
  await seedStatesFromLog();
  // Seed pump state: if any humidifier was last ON, pump should be ON
  const anyOn = [...zoneStates.values()].includes('on');
  pumpState = anyOn ? 'on' : 'off';
  console.log(`[humidifier] Scheduler started (30s interval, pump=${pumpState})`);
  setInterval(checkHumidity, 30 * 1000);
  setTimeout(checkHumidity, 5000);
}
