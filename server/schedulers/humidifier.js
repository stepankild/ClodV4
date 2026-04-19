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
 * Read the ACTUAL current state of a switch entity from Home Assistant.
 * Returns 'on' | 'off' | 'unavailable' | null (on network/auth error).
 *
 * Necessary because plugs can be toggled outside of our scheduler (Xiaomi
 * Home app, HA automations, physical button) and our in-memory state
 * then desyncs — leading to e.g. the pump running while both humidifier
 * plugs are actually OFF.
 */
async function haGetState(entityId) {
  const haUrl = process.env.HA_URL || 'http://localhost:8123';
  const haToken = process.env.HA_TOKEN;
  if (!haToken) return null;
  try {
    const resp = await fetch(`${haUrl}/api/states/${encodeURIComponent(entityId)}`, {
      headers: { 'Authorization': `Bearer ${haToken}` }
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data?.state ?? null;
  } catch (e) {
    console.error('[humidifier] haGetState error:', e.message);
    return null;
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
 * Sync pump state: ON if any humidifier plug is actually ON, OFF otherwise.
 *
 * CRITICAL: reads the real plug states from Home Assistant rather than trusting
 * the in-memory zoneStates map. A plug could have been toggled manually via
 * Xiaomi Home app or an HA automation while the scheduler wasn't looking.
 * Bug symptom caught before: both humidifier plugs were OFF in Xiaomi app,
 * but our cached state said 'on' for both → pump kept running dry.
 */
async function syncPump() {
  try {
    const allZones = await Zone.find({
      'config.humidifierMode': { $exists: true }
    }).lean();

    let anyOn = false;
    for (const zone of allZones) {
      const entityId = zone.config?.humidifierEntityId;
      if (!entityId) continue;
      const actual = await haGetState(entityId);
      if (actual === 'on') {
        anyOn = true;
        // Keep our in-memory cache in sync with reality while we're at it
        zoneStates.set(zone.zoneId, 'on');
      } else if (actual === 'off') {
        zoneStates.set(zone.zoneId, 'off');
      }
      // 'unavailable' / null → don't override cache
    }

    // Also confirm actual pump state — our cached pumpState can drift
    const actualPump = await haGetState(PUMP_ENTITY_ID);
    if (actualPump === 'on' || actualPump === 'off') {
      pumpState = actualPump;
    }

    const desiredPump = anyOn ? 'on' : 'off';
    if (pumpState !== desiredPump) {
      console.log(`[humidifier] Pump ${PUMP_ENTITY_ID}: actual=${pumpState} -> ${desiredPump} (any humidifier on: ${anyOn})`);
      const ok = await haSwitch(PUMP_ENTITY_ID, desiredPump);
      if (ok) pumpState = desiredPump;
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

      // Sync our cache with the real HA plug state first. Picks up manual
      // toggles via Xiaomi app or HA automations, so we don't send a stale
      // "OFF" when user already turned it off (or vice versa).
      const actualState = await haGetState(entityId);
      if (actualState === 'on' || actualState === 'off') {
        zoneStates.set(zoneId, actualState);
      }
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

/**
 * Seed in-memory state from the real plug states in Home Assistant.
 * Falls back to HumidifierLog if HA is unreachable on startup.
 */
async function seedStatesFromHa() {
  let seededFromHa = false;
  try {
    const zones = await Zone.find({ 'config.humidifierMode': { $exists: true } }).lean();
    for (const zone of zones) {
      const entityId = zone.config?.humidifierEntityId;
      if (!entityId) continue;
      const state = await haGetState(entityId);
      if (state === 'on' || state === 'off') {
        zoneStates.set(zone.zoneId, state);
        seededFromHa = true;
        console.log(`[humidifier] ${zone.zoneId}: seeded state="${state}" from HA`);
      }
    }
    const ps = await haGetState(PUMP_ENTITY_ID);
    if (ps === 'on' || ps === 'off') {
      pumpState = ps;
      console.log(`[humidifier] Pump: seeded state="${ps}" from HA`);
    }
  } catch (e) {
    console.error('[humidifier] seedStatesFromHa error:', e.message);
  }
  return seededFromHa;
}

export async function initHumidifierScheduler() {
  const haSeeded = await seedStatesFromHa();
  if (!haSeeded) {
    console.log('[humidifier] HA seed empty/failed — falling back to log');
    await seedStatesFromLog();
    const anyOn = [...zoneStates.values()].includes('on');
    pumpState = anyOn ? 'on' : 'off';
  }
  console.log(`[humidifier] Scheduler started (30s interval, pump=${pumpState})`);
  setInterval(checkHumidity, 30 * 1000);
  setTimeout(checkHumidity, 5000);
}
