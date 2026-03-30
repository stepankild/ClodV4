import Zone from '../models/Zone.js';
import SensorReading from '../models/SensorReading.js';
import HumidifierLog from '../models/HumidifierLog.js';

// Track current state to avoid spamming HA with duplicate commands
const zoneStates = new Map(); // zoneId -> 'on' | 'off' | null

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
 * Check humidity for all auto-mode zones and control humidifiers
 */
async function checkHumidity() {
  try {
    const zones = await Zone.find({ 'config.humidifierMode': 'auto' }).lean();

    for (const zone of zones) {
      const { zoneId } = zone;
      const rhLow = zone.config?.rhLow ?? 60;
      const rhHigh = zone.config?.rhHigh ?? 70;
      const entityId = zone.config?.humidifierEntityId || 'switch.cuco_v2eur_189e_switch';

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
  } catch (e) {
    console.error('[humidifier] Scheduler error:', e.message);
  }
}

/**
 * Initialize the humidifier scheduler (runs every 30 seconds)
 */
export async function initHumidifierScheduler() {
  await seedStatesFromLog();
  console.log('[humidifier] Scheduler started (30s interval, SHT45 preferred)');
  setInterval(checkHumidity, 30 * 1000);
  // Small delay before first check so seed has time to complete
  setTimeout(checkHumidity, 5000);
}
