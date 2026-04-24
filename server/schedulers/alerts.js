import AlertConfig from '../models/AlertConfig.js';
import AlertLog from '../models/AlertLog.js';
import SensorReading from '../models/SensorReading.js';
import IrrigationLog from '../models/IrrigationLog.js';
import Zone from '../models/Zone.js';
import { getZoneState, getZigbeeBridgeState } from '../mqtt/index.js';

// In-memory cooldown cache (seeded from MongoDB on start, persisted on each alert)
const alertCooldowns = new Map(); // "zoneId:metric" → { lastSent, count }
let cooldownsSeeded = false;
// Track which metrics are currently in alert state (for recovery messages)
const activeAlerts = new Map(); // "zoneId:metric" → true
// Track light state for anomaly detection: zoneId → { isDay, stableSince }
const lightState = new Map();

const LIGHT_THRESHOLD = 50; // lux — above = day, below = night

/**
 * Return Prague-local midnight for a given instant (as a UTC Date).
 * Railway runs in UTC so naive setHours(0) would give UTC midnight
 * which is 02:00 Prague summer / 01:00 winter, shifting daily stats.
 */
function pragueDayStart(now = new Date()) {
  const pragueStr = now.toLocaleString('en-US', { timeZone: 'Europe/Prague' });
  const pragueNow = new Date(pragueStr);
  const offsetMs = now.getTime() - pragueNow.getTime();
  pragueNow.setHours(0, 0, 0, 0);
  return new Date(pragueNow.getTime() + offsetMs);
}

// Flapping guard: a threshold breach / recovery must persist for SUSTAIN_MIN
// consecutive minutes before we fire to Telegram. Prevents spam when a value
// oscillates right at the threshold (e.g. temp jumping between 19.9 and 20.1
// when min=20). For recovery we additionally require the value to be inside
// the range by a small hysteresis margin (RECOVER_MARGIN_PCT of the
// min→max span, capped). That way a single spike back to exactly the
// boundary doesn't send a premature "в норме" message.
const SUSTAIN_MIN = 5;
const RECOVER_MARGIN_PCT = 0.05;  // 5% of the configured min↔max range

// Zigbee gateway liveness: tracked via the authoritative
// zigbee2mqtt/bridge/state MQTT topic instead of guessing from device
// silence. Z2M publishes this as a retained message and MQTT last-will
// flips it to "offline" if the daemon dies. Propagator sensors are
// event-based and legitimately stay quiet for hours, so traffic heuristics
// produced false positives. This one is ground truth.
//
// Require the offline state to persist this many minutes before firing,
// so a brief Z2M restart doesn't spam the chat.
const ZIGBEE_OFFLINE_SUSTAIN_MIN = 5;
const ZIGBEE_ALERT_COOLDOWN_MIN = 24 * 60; // 1 day between repeat alerts

// Stuck-sensor detector. A reading is considered stuck only if ALL of these hold:
//   1. Every sample in the last STUCK_WINDOW_MIN minutes is identical.
//   2. At least one OTHER sensor in the same zone DID change in that window
//      (otherwise it's a zone-wide silence → Pi/network problem, not a
//      frozen driver on this particular sensor; that case is covered by
//      the offline alert).
//   3. For the ☀️ light sensor: skip when the held value is at darkness
//      level (≤LIGHT_THRESHOLD). Lights off for hours is normal, not stuck.
// With a 3-hour window a live DS18B20 in the most stable room still
// produces ≥1 LSB of 0.0625°C jitter, so a dead-flat stream that long
// really does mean the driver/bus is wedged.
const STUCK_WINDOW_MIN = 180;
const STUCK_MIN_SAMPLES = 30;          // at least this many non-null samples in the window
const STUCK_COOLDOWN_MIN = 6 * 60;     // 6 hours between repeat alerts for the same sensor

// Learned light schedule cache: zoneId → { onHour, offHour, dayLength, updatedAt }
const learnedLightSchedule = new Map();
const SCHEDULE_CACHE_TTL = 60 * 60 * 1000; // refresh every 1 hour

/**
 * Learn the normal light schedule from last 7 days of data.
 * Returns { onHour, offHour, dayLengthH } or null if not enough data.
 */
async function learnLightSchedule(zoneId) {
  const cached = learnedLightSchedule.get(zoneId);
  if (cached && Date.now() - cached.updatedAt < SCHEDULE_CACHE_TTL) return cached;

  try {
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const readings = await SensorReading.find({
      zoneId,
      light: { $ne: null },
      timestamp: { $gte: since }
    }).sort({ timestamp: 1 }).select('light timestamp').lean();

    if (readings.length < 100) return null; // not enough data

    // Group by date (Prague timezone), find transitions per day
    const days = new Map(); // dateStr → [{time, isDay}]
    for (const r of readings) {
      const d = new Date(r.timestamp);
      const prague = new Date(d.toLocaleString('en-US', { timeZone: 'Europe/Prague' }));
      const dateStr = prague.toDateString();
      if (!days.has(dateStr)) days.set(dateStr, []);
      days.get(dateStr).push({
        hour: prague.getHours() + prague.getMinutes() / 60,
        isDay: r.light > LIGHT_THRESHOLD
      });
    }

    const onTimes = [];
    const offTimes = [];

    for (const [, dayReadings] of days) {
      if (dayReadings.length < 20) continue; // skip incomplete days

      // Find first night→day transition (lights ON)
      for (let i = 1; i < dayReadings.length; i++) {
        if (!dayReadings[i - 1].isDay && dayReadings[i].isDay) {
          onTimes.push(dayReadings[i].hour);
          break;
        }
      }
      // Find first day→night transition (lights OFF)
      // Search from readings that are after the ON time
      let foundOn = false;
      for (let i = 1; i < dayReadings.length; i++) {
        if (!dayReadings[i - 1].isDay && dayReadings[i].isDay) foundOn = true;
        if (foundOn && dayReadings[i - 1].isDay && !dayReadings[i].isDay) {
          offTimes.push(dayReadings[i].hour);
          break;
        }
      }
    }

    if (onTimes.length < 2 || offTimes.length < 2) return null; // need at least 2 days

    const avgOn = onTimes.reduce((a, b) => a + b, 0) / onTimes.length;
    const avgOff = offTimes.reduce((a, b) => a + b, 0) / offTimes.length;
    const dayLengthH = avgOff > avgOn ? avgOff - avgOn : (24 - avgOn + avgOff);

    const result = {
      onHour: Math.round(avgOn * 10) / 10,
      offHour: Math.round(avgOff * 10) / 10,
      dayLengthH: Math.round(dayLengthH * 10) / 10,
      updatedAt: Date.now()
    };

    learnedLightSchedule.set(zoneId, result);
    console.log(`[alerts] Learned light schedule for ${zoneId}: ON=${result.onHour}h OFF=${result.offHour}h day=${result.dayLengthH}h`);
    return result;
  } catch (e) {
    console.error(`[alerts] learnLightSchedule error: ${e.message}`);
    return null;
  }
}

const METRIC_LABELS = {
  temperature: '🌡 Температура',
  humidity: '💧 Влажность',
  co2: '🫧 CO2',
  light: '☀️ Освещённость',
  vpd: '🌱 VPD',
  offline: '🔌 Связь',
  light_anomaly: '💡 Аномалия света'
};

const METRIC_UNITS = {
  temperature: '°C',
  humidity: '%',
  co2: ' ppm',
  light: ' lux',
  vpd: ' kPa',
  offline: ''
};

/**
 * Send message via Telegram Bot API
 */
async function sendTelegram(chatId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error('[alerts] TELEGRAM_BOT_TOKEN not configured');
    return false;
  }
  try {
    const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML'
      })
    });
    if (!resp.ok) {
      const err = await resp.text();
      console.error(`[alerts] Telegram error: ${resp.status} ${err}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[alerts] Telegram request error:', e.message);
    return false;
  }
}

/**
 * Get current sensor value for a given metric
 */
function getMetricValue(reading, metric) {
  if (!reading) return null;
  switch (metric) {
    case 'temperature': return reading.temperature;
    case 'humidity': return reading.humidity_sht45 ?? reading.humidity;
    case 'co2': return reading.co2;
    case 'light': return reading.light;
    case 'vpd': {
      // VPD = SVP × (1 - RH/100), SHT45 air temp preferred
      const sht45T = reading.temperatures?.find(t => t.sensorId === 'sht45' || t.location?.includes('sht45'))?.value;
      const airT = sht45T ?? reading.temperature;
      const rh = reading.humidity_sht45 ?? reading.humidity;
      if (airT == null || rh == null) return null;
      const svp = 0.6108 * Math.exp(17.27 * airT / (airT + 237.3));
      return Math.max(0, svp * (1 - rh / 100));
    }
    default: return null;
  }
}

/**
 * Format Prague time for messages
 */
function formatTime() {
  return new Date().toLocaleString('cs-CZ', {
    timeZone: 'Europe/Prague',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

/**
 * Seed cooldowns + activeAlerts from MongoDB AlertLog on startup.
 * Prevents duplicate alerts after Railway restart/deploy.
 */
async function seedCooldownsFromDb() {
  if (cooldownsSeeded) return;
  cooldownsSeeded = true;
  try {
    // For each zone+metric, get the last alert and last recovery
    const pipeline = [
      { $match: { timestamp: { $gte: new Date(Date.now() - 24 * 3600 * 1000) } } },
      { $sort: { timestamp: -1 } },
      { $group: {
        _id: { zoneId: '$zoneId', metric: '$metric' },
        lastType: { $first: '$type' },
        lastTimestamp: { $first: '$timestamp' },
        alertCount: { $sum: { $cond: [{ $eq: ['$type', 'alert'] }, 1, 0] } }
      }}
    ];
    const results = await AlertLog.aggregate(pipeline);
    for (const r of results) {
      const key = `${r._id.zoneId}:${r._id.metric}`;
      const ts = new Date(r.lastTimestamp).getTime();
      if (r.lastType === 'alert') {
        // Last event was alert — still active, restore cooldown
        alertCooldowns.set(key, { lastSent: ts, count: r.alertCount });
        activeAlerts.set(key, true);
      }
      // If last was recovery — cooldown already reset, nothing to restore
    }
    console.log(`[alerts] Seeded ${alertCooldowns.size} cooldowns from DB`);
  } catch (e) {
    console.error('[alerts] seedCooldownsFromDb error:', e.message);
  }
}

/**
 * Escalating cooldown: 1st repeat after cooldownMin, 2nd after 60min, then every 3h
 * Returns true if enough time has passed to send next alert
 */
function cooldownPassed(key, cooldownMin) {
  const cd = alertCooldowns.get(key);
  if (!cd) return true;
  const count = cd.count || 0;
  let waitMin;
  if (count <= 1) waitMin = cooldownMin;       // 1st repeat: configured (default 30min)
  else if (count === 2) waitMin = 60;           // 2nd repeat: 1 hour
  else waitMin = 180;                           // 3rd+: every 3 hours
  return Date.now() - cd.lastSent > waitMin * 60 * 1000;
}

/**
 * Record that an alert was sent (increments escalation counter)
 */
function recordAlert(key) {
  const cd = alertCooldowns.get(key) || { lastSent: 0, count: 0 };
  cd.lastSent = Date.now();
  cd.count += 1;
  alertCooldowns.set(key, cd);
}

/**
 * Reset cooldown when alert resolves (value returns to normal)
 */
function resetCooldown(key) {
  alertCooldowns.delete(key);
}

/**
 * Check all zones for alert conditions
 */
/**
 * Detect sensors whose reported value has not changed by even one LSB over the
 * configured window. Fires a Telegram alert once per sensor with a long cooldown
 * and sends a recovery message when values start changing again.
 *
 * Checks:
 *   - Scalar fields: temperature, humidity, humidity_sht45, co2, light
 *   - Per-sensor temperatures[]   (I2C DS18B20/SHT45 — Zigbee excluded)
 *   - Per-sensor humidityReadings[] (I2C — Zigbee excluded, those are event-based)
 */
async function checkStuckSensors(zoneId, zoneName, chatId) {
  const since = new Date(Date.now() - STUCK_WINDOW_MIN * 60 * 1000);
  const readings = await SensorReading.find(
    { zoneId, timestamp: { $gte: since } },
    { temperature: 1, humidity: 1, humidity_sht45: 1, co2: 1, light: 1, temperatures: 1, humidityReadings: 1 }
  ).sort({ timestamp: 1 }).lean();

  if (readings.length < STUCK_MIN_SAMPLES) return;

  // ── Collect every sensor's values in the window ──
  // candidates: [{ key, label, unit, values, isLight }]
  const candidates = [];

  const scalarFields = [
    { field: 'temperature',    label: '🌡 Температура',             unit: '°C' },
    { field: 'humidity',       label: '💧 Влажность (STCC4)',       unit: '%' },
    { field: 'humidity_sht45', label: '💧 Влажность (SHT45)',       unit: '%' },
    { field: 'co2',            label: '🫧 CO₂',                      unit: ' ppm' },
    { field: 'light',          label: '☀️ Свет',                     unit: ' lux' },
  ];
  for (const { field, label, unit } of scalarFields) {
    const values = readings.map(r => r[field]).filter(v => v != null);
    if (values.length < STUCK_MIN_SAMPLES) continue;
    candidates.push({
      key: `${zoneId}:stuck:${field}`,
      label, unit, values,
      isLight: field === 'light',
    });
  }

  // Per-sensor temperatures (DS18B20 / SHT45 — skip Zigbee, they're event-based)
  const tempBySensor = new Map();
  for (const r of readings) {
    for (const t of (r.temperatures || [])) {
      if (t.value == null || t.sensorId?.startsWith('zigbee-')) continue;
      if (!tempBySensor.has(t.sensorId)) tempBySensor.set(t.sensorId, { values: [], location: t.location });
      tempBySensor.get(t.sensorId).values.push(t.value);
    }
  }
  for (const [sensorId, { values, location }] of tempBySensor) {
    if (values.length < STUCK_MIN_SAMPLES) continue;
    candidates.push({
      key: `${zoneId}:stuck:temp:${sensorId}`,
      label: `🌡 ${location || sensorId}`,
      unit: '°C', values, isLight: false,
    });
  }

  // Per-sensor humidity
  const humBySensor = new Map();
  for (const r of readings) {
    for (const h of (r.humidityReadings || [])) {
      if (h.value == null || h.sensorId?.startsWith('zigbee-')) continue;
      if (!humBySensor.has(h.sensorId)) humBySensor.set(h.sensorId, { values: [], location: h.location });
      humBySensor.get(h.sensorId).values.push(h.value);
    }
  }
  for (const [sensorId, { values, location }] of humBySensor) {
    if (values.length < STUCK_MIN_SAMPLES) continue;
    candidates.push({
      key: `${zoneId}:stuck:hum:${sensorId}`,
      label: `💧 ${location || sensorId}`,
      unit: '%', values, isLight: false,
    });
  }

  // ── Classify each candidate as frozen (one distinct value) or live ──
  for (const c of candidates) {
    c.distinct = new Set(c.values);
    c.frozen = c.distinct.size === 1;
  }

  // Peer-activity check: is there ANY live sensor in the zone right now?
  // If everything is frozen, it's almost certainly a Pi/connectivity
  // stall, not individual-sensor breakage — that case is handled by
  // the offline alert, not by spamming one alert per silent metric.
  const anyPeerLive = candidates.some(c => !c.frozen);

  // ── Fire / recover per sensor ──
  const sendStuckAlert = async (key, label, value, unit = '') => {
    if (!cooldownPassed(key, STUCK_COOLDOWN_MIN)) return;
    const msg = `⚠️ <b>Зона: ${zoneName}</b>\nДатчик <b>${label}</b> завис на <code>${value}${unit}</code>\nЗначение не меняется ≥${STUCK_WINDOW_MIN} мин\n🕐 ${formatTime()}`;
    const ok = await sendTelegram(chatId, msg);
    if (ok) {
      recordAlert(key);
      activeAlerts.set(key, true);
      await AlertLog.create({ zoneId, metric: key.split(':').slice(1).join(':'), type: 'alert', value, message: msg });
    }
  };

  const sendRecoveryAlert = async (key, label) => {
    if (!activeAlerts.get(key)) return;
    const msg = `✅ <b>Зона: ${zoneName}</b>\nДатчик <b>${label}</b> снова меняется\n🕐 ${formatTime()}`;
    await sendTelegram(chatId, msg);
    activeAlerts.delete(key);
    resetCooldown(key);
    await AlertLog.create({ zoneId, metric: key.split(':').slice(1).join(':'), type: 'recovery', message: msg });
  };

  for (const c of candidates) {
    if (!c.frozen) {
      await sendRecoveryAlert(c.key, c.label);
      continue;
    }

    const heldValue = [...c.distinct][0];

    // Skip: light sensor at darkness level is "stuck" at night on purpose
    if (c.isLight && heldValue <= LIGHT_THRESHOLD) {
      await sendRecoveryAlert(c.key, c.label); // clear if we'd alerted earlier
      continue;
    }

    // Skip: no peer sensor in this zone is changing either. Probably a
    // Pi/connectivity issue rather than a specific sensor freeze.
    if (!anyPeerLive) {
      // Don't recover here — we just don't have enough signal to decide
      continue;
    }

    await sendStuckAlert(c.key, c.label, heldValue, c.unit.trim() ? c.unit : '');
  }
}

/**
 * Detect when the Zigbee coordinator itself is down.
 *
 * Reads the authoritative Z2M liveness state from MQTT. That value comes
 * from the `zigbee2mqtt/bridge/state` topic which Z2M publishes on start
 * and gets flipped to "offline" automatically via MQTT last-will if the
 * daemon crashes or the USB dongle is unresponsive.
 *
 * We deliberately do NOT infer gateway status from individual device
 * silence — propagator sensors report on change and can legitimately be
 * quiet for hours when temp/humidity is stable.
 *
 * This is a zone-agnostic check (the coordinator is shared across all
 * zones using Zigbee), so we only fire once per offline event and only
 * for zones that actually use Zigbee.
 */
async function checkZigbeeGateway(zoneId, zoneName, chatId) {
  const zone = await Zone.findOne({ zoneId }, { zigbeeDevices: 1 }).lean();
  const deviceCount = Object.keys(zone?.zigbeeDevices || {}).length;
  if (!deviceCount) return; // zone doesn't use Zigbee at all

  const bridge = getZigbeeBridgeState();
  // While we haven't yet seen any retained MQTT message, we simply don't know
  // the state. Skip — once Z2M or MQTT finally publishes it we'll act.
  if (!bridge.everSeen) return;

  const key = `${zoneId}:zigbee_offline`;
  const offlineForMs = bridge.state === 'offline' && bridge.changedAt
    ? Date.now() - new Date(bridge.changedAt).getTime()
    : 0;
  const sustainedOffline = bridge.state === 'offline'
    && offlineForMs >= ZIGBEE_OFFLINE_SUSTAIN_MIN * 60 * 1000;

  if (sustainedOffline) {
    if (!activeAlerts.get(key) && cooldownPassed(key, ZIGBEE_ALERT_COOLDOWN_MIN)) {
      const offlineMin = Math.floor(offlineForMs / 60000);
      const msg =
        `📡 <b>Zigbee шлюз упал</b>\n` +
        `Зона: <b>${zoneName}</b>\n` +
        `Zigbee2MQTT offline уже ${offlineMin} мин\n` +
        `${deviceCount} устройств ждут связи\n` +
        `💡 Проверьте USB-dongle (Sonoff CC2652P) и службу zigbee2mqtt на Pi фермы\n` +
        `🕐 ${formatTime()}`;
      const ok = await sendTelegram(chatId, msg);
      if (ok) {
        recordAlert(key);
        activeAlerts.set(key, true);
        await AlertLog.create({
          zoneId, metric: 'zigbee_offline', type: 'alert',
          message: msg,
        });
      }
    }
  } else if (bridge.state === 'online' && activeAlerts.get(key)) {
    const msg =
      `✅ <b>Zigbee шлюз снова онлайн</b>\n` +
      `Зона: <b>${zoneName}</b>\n` +
      `🕐 ${formatTime()}`;
    await sendTelegram(chatId, msg);
    activeAlerts.delete(key);
    resetCooldown(key);
    await AlertLog.create({
      zoneId, metric: 'zigbee_offline', type: 'recovery',
      message: msg,
    });
  }
}

async function checkAlerts() {
  try {
    const configs = await AlertConfig.find({ enabled: true }).lean();
    if (!configs.length) return;

    for (const config of configs) {
      const { zoneId, rules } = config;
      const chatId = config.telegramChatId || process.env.TELEGRAM_CHAT_ID;
      if (!chatId) continue;

      // Get zone name for messages
      const zone = await Zone.findOne({ zoneId }).lean();
      const zoneName = zone?.name || zoneId;

      // Check offline separately
      const offlineRule = rules.find(r => r.metric === 'offline' && r.enabled);
      if (offlineRule) {
        const liveState = getZoneState(zoneId);
        const key = `${zoneId}:offline`;
        const offlineMinutes = offlineRule.max || 5; // configurable, default 5 min
        const isOffline = !liveState?.online ||
          (liveState.lastSeen && Date.now() - new Date(liveState.lastSeen).getTime() > offlineMinutes * 60 * 1000);

        if (isOffline && !activeAlerts.get(key) && cooldownPassed(key, offlineRule.cooldownMin)) {
          const msg = `🔴 <b>Зона: ${zoneName}</b>\nДатчики не отвечают >${offlineMinutes} мин\n🕐 ${formatTime()}`;
          const ok = await sendTelegram(chatId, msg);
          if (ok) {
            recordAlert(key);
            activeAlerts.set(key, true);
            await AlertLog.create({ zoneId, metric: 'offline', type: 'alert', message: msg });
          }
        } else if (!isOffline && activeAlerts.get(key)) {
          // Recovery
          const msg = `✅ <b>Зона: ${zoneName}</b>\n🔌 Датчики снова онлайн\n🕐 ${formatTime()}`;
          await sendTelegram(chatId, msg);
          activeAlerts.delete(key);
          resetCooldown(key);
          await AlertLog.create({ zoneId, metric: 'offline', type: 'recovery', message: msg });
        }
      }

      // Get latest reading for sensor metrics (used for freshness gate + display)
      const reading = await SensorReading.findOne({ zoneId })
        .sort({ timestamp: -1 }).lean();
      if (!reading) continue;

      // Check reading freshness (< 5 min)
      const age = Date.now() - new Date(reading.timestamp).getTime();
      if (age > 5 * 60 * 1000) continue;

      // Sustain window: last SUSTAIN_MIN minutes of readings.
      // We load it once here and reuse it for every threshold rule below —
      // a rule only fires if the breach holds across ALL samples in this
      // window (and recovery only if ALL samples are inside the band).
      const sustainSince = new Date(Date.now() - SUSTAIN_MIN * 60 * 1000);
      const sustainWindow = await SensorReading.find(
        { zoneId, timestamp: { $gte: sustainSince } },
        { temperature: 1, humidity: 1, humidity_sht45: 1, co2: 1, light: 1, temperatures: 1, timestamp: 1 }
      ).sort({ timestamp: 1 }).lean();

      // Check each metric rule
      for (const rule of rules) {
        if (!rule.enabled || rule.metric === 'offline') continue;

        const value = getMetricValue(reading, rule.metric);
        if (value == null) continue;

        const key = `${zoneId}:${rule.metric}`;
        const label = METRIC_LABELS[rule.metric];
        const unit = METRIC_UNITS[rule.metric];
        const displayValue = rule.metric === 'vpd' ? value.toFixed(2) : Math.round(value * 10) / 10;

        // Compute hysteresis band for recovery: value must be INSIDE
        // [min+margin, max-margin] to be considered "sustainably in range".
        // Breach side uses the raw threshold.
        const span = (rule.min != null && rule.max != null)
          ? Math.abs(rule.max - rule.min)
          : null;
        const margin = span != null ? span * RECOVER_MARGIN_PCT : 0;
        const recoverMin = rule.min != null ? rule.min + margin : null;
        const recoverMax = rule.max != null ? rule.max - margin : null;

        const classify = (v) => {
          if (v == null) return null;
          if (rule.min != null && v < rule.min) return 'low';
          if (rule.max != null && v > rule.max) return 'high';
          if (recoverMin != null && v < recoverMin) return 'transition';
          if (recoverMax != null && v > recoverMax) return 'transition';
          return 'normal';
        };

        // Evaluate all samples in window for THIS metric
        const samples = sustainWindow
          .map(r => classify(getMetricValue(r, rule.metric)))
          .filter(x => x != null);

        // Need at least 3 samples in the 5-min window to decide
        if (samples.length < 3) continue;

        const allLow = samples.every(s => s === 'low');
        const allHigh = samples.every(s => s === 'high');
        const allNormal = samples.every(s => s === 'normal');

        const isBreached = allLow || allHigh;
        const isRecovered = allNormal;

        if (isBreached) {
          const threshold = allLow ? `мин: ${rule.min}${unit}` : `макс: ${rule.max}${unit}`;
          if (cooldownPassed(key, rule.cooldownMin)) {
            const msg = `⚠️ <b>Зона: ${zoneName}</b>\n${label}: ${displayValue}${unit} (${threshold})\n🕐 ${formatTime()}`;
            const ok = await sendTelegram(chatId, msg);
            if (ok) {
              recordAlert(key);
              activeAlerts.set(key, true);
              const thresholdStr = allLow ? `<${rule.min}` : `>${rule.max}`;
              await AlertLog.create({ zoneId, metric: rule.metric, type: 'alert', value, threshold: thresholdStr, message: msg });
            }
          }
        } else if (isRecovered && activeAlerts.get(key)) {
          // Sustained recovery (all samples inside hysteresis band)
          const msg = `✅ <b>Зона: ${zoneName}</b>\n${label} в норме: ${displayValue}${unit}\n🕐 ${formatTime()}`;
          await sendTelegram(chatId, msg);
          activeAlerts.delete(key);
          resetCooldown(key);
          await AlertLog.create({ zoneId, metric: rule.metric, type: 'recovery', value, message: msg });
        }
        // Mixed/transition samples → do nothing, wait out the flap
      }

      // ── Stuck sensor detection ──
      // Flags any metric that returned identical values for STUCK_WINDOW_MIN
      // (e.g. DS18B20 hung at an exact mC reading, STCC4 latching its buffer).
      // Skips event-based Zigbee sensors which legitimately report only on change.
      await checkStuckSensors(zoneId, zoneName, chatId);
      await checkZigbeeGateway(zoneId, zoneName, chatId);

      // ── Light anomaly detection ──
      // Learns normal schedule from last 7 days, alerts only on deviations
      const lightAnomalyRule = rules.find(r => r.metric === 'light_anomaly' && r.enabled);
      if (lightAnomalyRule && reading) {
        const lux = reading.light;
        if (lux != null) {
          const isDay = lux > LIGHT_THRESHOLD;
          const prev = lightState.get(zoneId);
          const key = `${zoneId}:light_anomaly`;

          if (!prev) {
            lightState.set(zoneId, { isDay, stableSince: Date.now(), transitionCount: 0 });
          } else if (isDay !== prev.isDay) {
            const stableMinutes = (Date.now() - prev.stableSince) / 60000;

            if (stableMinutes > 30) {
              // Learn expected schedule from historical data
              const schedule = await learnLightSchedule(zoneId);

              if (schedule) {
                const pragueNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Prague' }));
                const currentHour = pragueNow.getHours() + pragueNow.getMinutes() / 60;
                const TOLERANCE = 0.5; // ±30 min tolerance

                // Check distance between two hours on a 24h clock
                const hourDist = (a, b) => { const d = Math.abs(a - b); return Math.min(d, 24 - d); };

                let isAnomaly = false;
                if (isDay) {
                  // Lights ON — compare to learned ON time
                  isAnomaly = hourDist(currentHour, schedule.onHour) > TOLERANCE;
                } else {
                  // Lights OFF — compare to learned OFF time
                  isAnomaly = hourDist(currentHour, schedule.offHour) > TOLERANCE;
                }

                if (isAnomaly && cooldownPassed(key, lightAnomalyRule.cooldownMin)) {
                  const eventType = isDay ? 'лампы ВКЛЮЧИЛИСЬ' : 'лампы ВЫКЛЮЧИЛИСЬ';
                  const fmtH = (h) => `${Math.floor(h)}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
                  const expected = isDay
                    ? `обычно вкл в ${fmtH(schedule.onHour)}`
                    : `обычно выкл в ${fmtH(schedule.offHour)}`;
                  const msg = `💡 <b>Зона: ${zoneName}</b>\n${eventType} не по расписанию\n☀️ ${lux.toFixed(0)} lux (${expected})\n🕐 ${formatTime()}`;
                  const ok = await sendTelegram(chatId, msg);
                  if (ok) {
                    recordAlert(key);
                    await AlertLog.create({ zoneId, metric: 'light_anomaly', type: 'alert', value: lux, message: msg });
                  }
                }
              }
              // If no schedule learned yet (< 2 days of data) — skip, don't alert
            }

            lightState.set(zoneId, { isDay, stableSince: Date.now(), transitionCount: (prev.transitionCount || 0) + 1 });
          }
        }
      }
    }
  } catch (e) {
    console.error('[alerts] Scheduler error:', e.message);
  }
}

/**
 * Build daily summary message for a zone
 */
async function buildZoneSummary(zone, yesterday, todayStart) {
  const import_HumidifierLog = (await import('../models/HumidifierLog.js')).default;

  const readings = await SensorReading.find({
    zoneId: zone.zoneId,
    timestamp: { $gte: yesterday, $lt: todayStart }
  }).sort({ timestamp: 1 }).lean();

  if (!readings.length) return null;

  const avg = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
  const fmt = (v, d = 1) => v != null ? v.toFixed(d) : '—';
  const toPragueTime = (d) => new Date(d).toLocaleTimeString('cs-CZ', { timeZone: 'Europe/Prague', hour: '2-digit', minute: '2-digit', hour12: false });

  // ── Split readings into day (light >50 lux) and night ──
  const withLight = readings.filter(r => r.light != null);
  const dayReadings = withLight.filter(r => r.light > LIGHT_THRESHOLD);
  const nightReadings = withLight.filter(r => r.light <= LIGHT_THRESHOLD);

  // ── Overall stats ──
  const temps = readings.map(r => r.temperature).filter(v => v != null);
  const hums = readings.map(r => r.humidity_sht45 ?? r.humidity).filter(v => v != null);
  const co2s = readings.map(r => r.co2).filter(v => v != null);

  // ── Day/night climate ──
  const dayTemps = dayReadings.map(r => r.temperature).filter(v => v != null);
  const nightTemps = nightReadings.map(r => r.temperature).filter(v => v != null);
  const dayHums = dayReadings.map(r => r.humidity_sht45 ?? r.humidity).filter(v => v != null);
  const nightHums = nightReadings.map(r => r.humidity_sht45 ?? r.humidity).filter(v => v != null);

  // ── VPD ──
  const calcVpd = (r) => {
    const sht45T = r.temperatures?.find(t => t.sensorId === 'sht45' || t.location?.includes('sht45'))?.value;
    const airT = sht45T ?? r.temperature;
    const rh = r.humidity_sht45 ?? r.humidity;
    if (airT == null || rh == null) return null;
    const svp = 0.6108 * Math.exp(17.27 * airT / (airT + 237.3));
    return Math.max(0, svp * (1 - rh / 100));
  };
  const vpds = readings.map(calcVpd).filter(v => v != null);

  // ── Light transitions: find when lights turned on/off ──
  let lightsOnTime = null, lightsOffTime = null;
  const lightTransitions = [];
  for (let i = 1; i < withLight.length; i++) {
    const prevDay = withLight[i - 1].light > LIGHT_THRESHOLD;
    const curDay = withLight[i].light > LIGHT_THRESHOLD;
    if (!prevDay && curDay) {
      lightTransitions.push({ type: 'on', time: withLight[i].timestamp });
      if (!lightsOnTime) lightsOnTime = withLight[i].timestamp;
    } else if (prevDay && !curDay) {
      lightTransitions.push({ type: 'off', time: withLight[i].timestamp });
      if (!lightsOffTime) lightsOffTime = withLight[i].timestamp;
    }
  }
  // Also detect initial state
  if (withLight.length > 0 && withLight[0].light > LIGHT_THRESHOLD && !lightsOnTime) {
    lightsOnTime = withLight[0].timestamp; // was already on at start
  }

  const totalLightReadings = withLight.length;
  const dayCount = dayReadings.length;
  const dayHours = totalLightReadings > 0 ? Math.round((dayCount / totalLightReadings) * 24 * 10) / 10 : null;
  const nightHours = dayHours != null ? Math.round((24 - dayHours) * 10) / 10 : null;

  // ── Humidifier stats ──
  // Seed "lastOn" from the last log BEFORE the window so time from
  // window-start to the first OFF isn't dropped.
  const humLogs = await import_HumidifierLog.find({
    zoneId: zone.zoneId,
    timestamp: { $gte: yesterday, $lt: todayStart }
  }).sort({ timestamp: 1 }).lean();

  const priorHumLog = await import_HumidifierLog.findOne({
    zoneId: zone.zoneId,
    timestamp: { $lt: yesterday }
  }).sort({ timestamp: -1 }).lean();

  const humOnCount = humLogs.filter(l => l.action === 'on').length;
  const humOffCount = humLogs.filter(l => l.action === 'off').length;
  let humTotalMs = 0;
  let lastOn = priorHumLog?.action === 'on' ? yesterday.getTime() : null;
  for (const log of humLogs) {
    const t = new Date(log.timestamp).getTime();
    if (log.action === 'on') {
      if (lastOn == null) lastOn = t; // dedupe duplicate 'on'
    } else if (log.action === 'off' && lastOn != null) {
      humTotalMs += t - lastOn;
      lastOn = null;
    }
  }
  if (lastOn != null) humTotalMs += todayStart.getTime() - lastOn; // still on at end of window
  const humMinutes = Math.round(humTotalMs / 60000);

  // ── Format message ──
  const zoneName = zone.name || zone.zoneId;
  const dateLabel = yesterday.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', timeZone: 'Europe/Prague' });
  let msg = `📊 <b>Сводка за ${dateLabel}</b>\n<b>Зона: ${zoneName}</b>\n`;

  // Temperature day/night
  if (temps.length) {
    msg += `\n🌡 <b>Температура</b>`;
    if (dayTemps.length) msg += `\n   день: ${fmt(avg(dayTemps))}°C (${fmt(Math.min(...dayTemps))}–${fmt(Math.max(...dayTemps))})`;
    if (nightTemps.length) msg += `\n   ночь: ${fmt(avg(nightTemps))}°C (${fmt(Math.min(...nightTemps))}–${fmt(Math.max(...nightTemps))})`;
    if (!dayTemps.length && !nightTemps.length) msg += `\n   средняя: ${fmt(avg(temps))}°C`;
  }

  // Humidity day/night
  if (hums.length) {
    msg += `\n💧 <b>Влажность</b>`;
    if (dayHums.length) msg += `\n   день: ${fmt(avg(dayHums), 0)}% (${fmt(Math.min(...dayHums), 0)}–${fmt(Math.max(...dayHums), 0)})`;
    if (nightHums.length) msg += `\n   ночь: ${fmt(avg(nightHums), 0)}% (${fmt(Math.min(...nightHums), 0)}–${fmt(Math.max(...nightHums), 0)})`;
    if (!dayHums.length && !nightHums.length) msg += `\n   средняя: ${fmt(avg(hums), 0)}%`;
  }

  if (co2s.length) {
    msg += `\n🫧 <b>CO2</b>\n   средний: ${Math.round(avg(co2s))} ppm (макс: ${Math.round(Math.max(...co2s))})`;
  }
  if (vpds.length) {
    msg += `\n🌱 <b>VPD</b>\n   средний: ${avg(vpds).toFixed(2)} kPa (${Math.min(...vpds).toFixed(2)}–${Math.max(...vpds).toFixed(2)})`;
  }

  // Light schedule
  if (dayHours != null) {
    msg += `\n☀️ <b>Фотопериод</b>\n   день: ${dayHours}ч / ночь: ${nightHours}ч`;
    if (lightsOnTime) msg += `\n   включение: ${toPragueTime(lightsOnTime)}`;
    if (lightsOffTime) msg += `\n   выключение: ${toPragueTime(lightsOffTime)}`;
    if (lightTransitions.length > 2) msg += `\n   ⚠️ ${lightTransitions.length} переключений (аномалия?)`;
  }

  // Humidifier
  if (humOnCount > 0) {
    const humTimeStr = humMinutes >= 60 ? `${Math.floor(humMinutes / 60)}ч ${humMinutes % 60}м` : `${humMinutes}м`;
    msg += `\n💨 <b>Увлажнитель</b>\n   вкл: ${humOnCount}x / работал: ${humTimeStr}`;
  }

  msg += `\n\n📈 Показаний: ${readings.length}`;
  return msg;
}

/**
 * Generate and send daily summary for all zones at 9:00 Prague time
 */
let lastSummaryDate = null;

async function checkDailySummary() {
  const now = new Date();
  const pragueTime = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Prague' }));
  const hour = pragueTime.getHours();
  const minute = pragueTime.getMinutes();
  const dateStr = pragueTime.toDateString();

  if (hour !== 9 || minute > 1 || lastSummaryDate === dateStr) return;
  lastSummaryDate = dateStr;

  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!chatId) return;

  try {
    const zones = await Zone.find().lean();
    const todayStart = pragueDayStart(now);
    const yesterday = new Date(todayStart.getTime() - 24 * 3600 * 1000);

    for (const zone of zones) {
      const msg = await buildZoneSummary(zone, yesterday, todayStart);
      if (msg) await sendTelegram(chatId, msg);
    }
    console.log('[alerts] Daily summary sent');
  } catch (e) {
    console.error('[alerts] Daily summary error:', e.message);
  }
}

/**
 * Manually trigger daily summary (for testing)
 */
export async function sendDailySummaryNow() {
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!chatId) return { ok: false, error: 'TELEGRAM_CHAT_ID not configured' };

  try {
    const zones = await Zone.find().lean();
    const now = new Date();
    const todayStart = pragueDayStart(now);
    const yesterday = new Date(todayStart.getTime() - 24 * 3600 * 1000);

    for (const zone of zones) {
      const msg = await buildZoneSummary(zone, yesterday, todayStart);
      if (msg) await sendTelegram(chatId, msg);
    }
    return { ok: true };
  } catch (e) {
    console.error('[alerts] Manual summary error:', e.message);
    return { ok: false, error: e.message };
  }
}

/**
 * Send a test message to verify Telegram is configured
 */
export async function sendTestAlert(chatId) {
  const cid = chatId || process.env.TELEGRAM_CHAT_ID;
  if (!cid) return { ok: false, error: 'TELEGRAM_CHAT_ID not configured' };
  const ok = await sendTelegram(cid, `✅ <b>True Source</b>\nТестовое сообщение — алерты работают!\n🕐 ${formatTime()}`);
  return { ok };
}

/**
 * Initialize alert scheduler (runs every 30 seconds)
 */
const startedAt = Date.now();

// Health probe silent alert: если Pi-resident daemon не прислал snapshot
// больше PROBE_SILENT_MIN минут — что-то не так (Pi off, probe crashed,
// Tailscale down). Zone-agnostic, не привязан к конкретной зоне.
const PROBE_SILENT_MIN = 15;
const PROBE_ALERT_COOLDOWN_MIN = 60;

async function checkProbeFreshness() {
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!chatId) return;
  const { default: SystemStatusSnapshot } = await import('../models/SystemStatusSnapshot.js');
  const latest = await SystemStatusSnapshot.findOne({}).sort({ timestamp: -1 }).select('timestamp host').lean();
  const key = 'probe:silent';

  if (!latest) {
    // Probe никогда не присылал snapshot — не алертим; вероятно он ещё не установлен.
    return;
  }

  const silentMs = Date.now() - new Date(latest.timestamp).getTime();
  const isSilent = silentMs > PROBE_SILENT_MIN * 60 * 1000;

  if (isSilent) {
    if (!activeAlerts.get(key) && cooldownPassed(key, PROBE_ALERT_COOLDOWN_MIN)) {
      const silentMin = Math.floor(silentMs / 60000);
      const msg =
        `⚠️ <b>Health probe молчит</b>\n` +
        `Host: <b>${latest.host || '?'}</b>\n` +
        `Последний snapshot: ${silentMin} мин назад\n` +
        `💡 Проверьте pi-health-probe.service на Pi и сеть (Tailscale).\n` +
        `🕐 ${formatTime()}`;
      const ok = await sendTelegram(chatId, msg);
      if (ok) {
        recordAlert(key);
        activeAlerts.set(key, true);
        await AlertLog.create({
          zoneId: 'system', metric: 'probe_silent', type: 'alert',
          message: msg,
        });
      }
    }
  } else if (activeAlerts.get(key)) {
    const msg =
      `✅ <b>Health probe снова в строю</b>\n` +
      `Host: <b>${latest.host || '?'}</b>\n` +
      `🕐 ${formatTime()}`;
    await sendTelegram(chatId, msg);
    activeAlerts.delete(key);
    resetCooldown(key);
  }
}

export async function initAlertScheduler() {
  await seedCooldownsFromDb();
  console.log('[alerts] Scheduler started (30s interval, daily summary at 9:00 Prague, 2min warmup)');
  setInterval(() => {
    // Skip alerts for first 2 minutes after server start (deploy restart causes false offline alerts)
    if (Date.now() - startedAt < 2 * 60 * 1000) return;
    checkAlerts();
    // Probe freshness не зависит от зон — своим тиком
    checkProbeFreshness().catch(err => console.error('[alerts] probe freshness check failed:', err?.message));
  }, 30 * 1000);
  setInterval(checkDailySummary, 30 * 1000);
}
