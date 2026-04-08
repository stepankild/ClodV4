import AlertConfig from '../models/AlertConfig.js';
import AlertLog from '../models/AlertLog.js';
import SensorReading from '../models/SensorReading.js';
import IrrigationLog from '../models/IrrigationLog.js';
import Zone from '../models/Zone.js';
import { getZoneState } from '../mqtt/index.js';

// Cooldown tracking: "zoneId:metric" → last alert timestamp
const lastAlertTime = new Map();
// Track which metrics are currently in alert state (for recovery messages)
const activeAlerts = new Map(); // "zoneId:metric" → true
// Track light state for anomaly detection: zoneId → { isDay, stableSince }
const lightState = new Map();

const LIGHT_THRESHOLD = 50; // lux — above = day, below = night

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
      // Calculate VPD from canopy temp + air temp + humidity
      const canopyT = reading.temperatures?.find(t => t.location === 'canopy')?.value;
      const airT = reading.temperature;
      const rh = reading.humidity_sht45 ?? reading.humidity;
      if (canopyT == null || airT == null || rh == null) return null;
      const svpLeaf = 0.6108 * Math.exp(17.27 * canopyT / (canopyT + 237.3));
      const svpAir = 0.6108 * Math.exp(17.27 * airT / (airT + 237.3));
      return Math.max(0, svpLeaf - svpAir * rh / 100);
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
 * Check if cooldown has passed for a specific alert
 */
function cooldownPassed(key, cooldownMin) {
  const last = lastAlertTime.get(key);
  if (!last) return true;
  return Date.now() - last > cooldownMin * 60 * 1000;
}

/**
 * Check all zones for alert conditions
 */
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
            lastAlertTime.set(key, Date.now());
            activeAlerts.set(key, true);
            await AlertLog.create({ zoneId, metric: 'offline', type: 'alert', message: msg });
          }
        } else if (!isOffline && activeAlerts.get(key)) {
          // Recovery
          const msg = `✅ <b>Зона: ${zoneName}</b>\n🔌 Датчики снова онлайн\n🕐 ${formatTime()}`;
          await sendTelegram(chatId, msg);
          activeAlerts.delete(key);
          await AlertLog.create({ zoneId, metric: 'offline', type: 'recovery', message: msg });
        }
      }

      // Get latest reading for sensor metrics
      const reading = await SensorReading.findOne({ zoneId })
        .sort({ timestamp: -1 }).lean();
      if (!reading) continue;

      // Check reading freshness (< 5 min)
      const age = Date.now() - new Date(reading.timestamp).getTime();
      if (age > 5 * 60 * 1000) continue;

      // Check each metric rule
      for (const rule of rules) {
        if (!rule.enabled || rule.metric === 'offline') continue;

        const value = getMetricValue(reading, rule.metric);
        if (value == null) continue;

        const key = `${zoneId}:${rule.metric}`;
        const label = METRIC_LABELS[rule.metric];
        const unit = METRIC_UNITS[rule.metric];
        const displayValue = rule.metric === 'vpd' ? value.toFixed(2) : Math.round(value * 10) / 10;

        let breached = false;
        let threshold = '';

        if (rule.min != null && value < rule.min) {
          breached = true;
          threshold = `мин: ${rule.min}${unit}`;
        } else if (rule.max != null && value > rule.max) {
          breached = true;
          threshold = `макс: ${rule.max}${unit}`;
        }

        if (breached) {
          if (cooldownPassed(key, rule.cooldownMin)) {
            const msg = `⚠️ <b>Зона: ${zoneName}</b>\n${label}: ${displayValue}${unit} (${threshold})\n🕐 ${formatTime()}`;
            const ok = await sendTelegram(chatId, msg);
            if (ok) {
              lastAlertTime.set(key, Date.now());
              activeAlerts.set(key, true);
              const thresholdStr = rule.min != null && value < rule.min ? `<${rule.min}` : `>${rule.max}`;
              await AlertLog.create({ zoneId, metric: rule.metric, type: 'alert', value, threshold: thresholdStr, message: msg });
            }
          }
        } else if (activeAlerts.get(key)) {
          // Value returned to normal — send recovery
          const msg = `✅ <b>Зона: ${zoneName}</b>\n${label} в норме: ${displayValue}${unit}\n🕐 ${formatTime()}`;
          await sendTelegram(chatId, msg);
          activeAlerts.delete(key);
          await AlertLog.create({ zoneId, metric: rule.metric, type: 'recovery', value, message: msg });
        }
      }

      // ── Light anomaly detection ──
      // Detects unexpected light changes: lights ON during expected night, or OFF during expected day
      const lightAnomalyRule = rules.find(r => r.metric === 'light_anomaly' && r.enabled);
      if (lightAnomalyRule && reading) {
        const lux = reading.light;
        if (lux != null) {
          const isDay = lux > LIGHT_THRESHOLD;
          const prev = lightState.get(zoneId);
          const key = `${zoneId}:light_anomaly`;

          if (!prev) {
            // First reading — just store state
            lightState.set(zoneId, { isDay, stableSince: Date.now(), transitionCount: 0 });
          } else if (isDay !== prev.isDay) {
            // Light state changed
            const stableMinutes = (Date.now() - prev.stableSince) / 60000;

            // Only alert if previous state was stable for >30 min (not just a brief flicker)
            // and the transition is unexpected (short stable period before = anomaly)
            if (stableMinutes > 30) {
              // This is a real transition — check if it's anomalous
              // Night was stable >30min and suddenly lights turned on = anomaly
              // Day was stable >30min and suddenly lights turned off = anomaly
              // We track transitions; the user will know from Telegram what happened
              const eventType = isDay ? 'лампы ВКЛЮЧИЛИСЬ (была ночь)' : 'лампы ВЫКЛЮЧИЛИСЬ (был день)';

              if (cooldownPassed(key, lightAnomalyRule.cooldownMin)) {
                const msg = `💡 <b>Зона: ${zoneName}</b>\n${eventType}\n☀️ ${lux.toFixed(0)} lux\n🕐 ${formatTime()}`;
                const ok = await sendTelegram(chatId, msg);
                if (ok) {
                  lastAlertTime.set(key, Date.now());
                  await AlertLog.create({ zoneId, metric: 'light_anomaly', type: 'alert', value: lux, message: msg });
                }
              }
            }

            lightState.set(zoneId, { isDay, stableSince: Date.now(), transitionCount: (prev.transitionCount || 0) + 1 });
          }
          // If same state — just keep tracking (stableSince stays)
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
    const canopyT = r.temperatures?.find(t => t.location === 'canopy')?.value;
    const airT = r.temperature;
    const rh = r.humidity_sht45 ?? r.humidity;
    if (canopyT == null || airT == null || rh == null) return null;
    const svpLeaf = 0.6108 * Math.exp(17.27 * canopyT / (canopyT + 237.3));
    const svpAir = 0.6108 * Math.exp(17.27 * airT / (airT + 237.3));
    return Math.max(0, svpLeaf - svpAir * rh / 100);
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
  const humLogs = await import_HumidifierLog.find({
    zoneId: zone.zoneId,
    timestamp: { $gte: yesterday, $lt: todayStart }
  }).sort({ timestamp: 1 }).lean();

  const humOnCount = humLogs.filter(l => l.action === 'on').length;
  const humOffCount = humLogs.filter(l => l.action === 'off').length;
  let humTotalMs = 0;
  let lastOn = null;
  for (const log of humLogs) {
    if (log.action === 'on') lastOn = new Date(log.timestamp).getTime();
    else if (log.action === 'off' && lastOn) { humTotalMs += new Date(log.timestamp).getTime() - lastOn; lastOn = null; }
  }
  if (lastOn) humTotalMs += todayStart.getTime() - lastOn; // was still on at end of day
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
    const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1); yesterday.setHours(0, 0, 0, 0);
    const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);

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
    const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1); yesterday.setHours(0, 0, 0, 0);
    const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);

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
export function initAlertScheduler() {
  console.log('[alerts] Scheduler started (30s interval, daily summary at 9:00 Prague)');
  setInterval(checkAlerts, 30 * 1000);
  setInterval(checkDailySummary, 30 * 1000);
  setTimeout(checkAlerts, 10000); // first check after 10s
}
