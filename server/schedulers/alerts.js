import AlertConfig from '../models/AlertConfig.js';
import AlertLog from '../models/AlertLog.js';
import SensorReading from '../models/SensorReading.js';
import Zone from '../models/Zone.js';
import { getZoneState } from '../mqtt/index.js';

// Cooldown tracking: "zoneId:metric" → last alert timestamp
const lastAlertTime = new Map();
// Track which metrics are currently in alert state (for recovery messages)
const activeAlerts = new Map(); // "zoneId:metric" → true

const METRIC_LABELS = {
  temperature: '🌡 Температура',
  humidity: '💧 Влажность',
  co2: '🫧 CO2',
  light: '☀️ Освещённость',
  vpd: '🌱 VPD',
  offline: '🔌 Связь'
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
        const isOffline = !liveState?.online ||
          (liveState.lastSeen && Date.now() - new Date(liveState.lastSeen).getTime() > 5 * 60 * 1000);

        if (isOffline && !activeAlerts.get(key) && cooldownPassed(key, offlineRule.cooldownMin)) {
          const msg = `🔴 <b>Зона: ${zoneName}</b>\nДатчики не отвечают >5 минут\n🕐 ${formatTime()}`;
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
    }
  } catch (e) {
    console.error('[alerts] Scheduler error:', e.message);
  }
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

  // Fire between 9:00-9:01, once per day
  if (hour !== 9 || minute > 1 || lastSummaryDate === dateStr) return;
  lastSummaryDate = dateStr;

  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!chatId) return;

  try {
    const zones = await Zone.find().lean();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    for (const zone of zones) {
      const readings = await SensorReading.find({
        zoneId: zone.zoneId,
        timestamp: { $gte: yesterday, $lt: todayStart }
      }).lean();

      if (!readings.length) continue;

      // Temperature stats
      const temps = readings.map(r => r.temperature).filter(v => v != null);
      const avgTemp = temps.length ? (temps.reduce((a, b) => a + b, 0) / temps.length) : null;
      const minTemp = temps.length ? Math.min(...temps) : null;
      const maxTemp = temps.length ? Math.max(...temps) : null;

      // Humidity stats (prefer SHT45)
      const hums = readings.map(r => r.humidity_sht45 ?? r.humidity).filter(v => v != null);
      const avgHum = hums.length ? (hums.reduce((a, b) => a + b, 0) / hums.length) : null;
      const minHum = hums.length ? Math.min(...hums) : null;
      const maxHum = hums.length ? Math.max(...hums) : null;

      // CO2 stats
      const co2s = readings.map(r => r.co2).filter(v => v != null);
      const avgCo2 = co2s.length ? (co2s.reduce((a, b) => a + b, 0) / co2s.length) : null;
      const maxCo2 = co2s.length ? Math.max(...co2s) : null;

      // VPD stats
      const vpds = readings.map(r => {
        const canopyT = r.temperatures?.find(t => t.location === 'canopy')?.value;
        const airT = r.temperature;
        const rh = r.humidity_sht45 ?? r.humidity;
        if (canopyT == null || airT == null || rh == null) return null;
        const svpLeaf = 0.6108 * Math.exp(17.27 * canopyT / (canopyT + 237.3));
        const svpAir = 0.6108 * Math.exp(17.27 * airT / (airT + 237.3));
        return Math.max(0, svpLeaf - svpAir * rh / 100);
      }).filter(v => v != null);
      const avgVpd = vpds.length ? (vpds.reduce((a, b) => a + b, 0) / vpds.length) : null;
      const minVpd = vpds.length ? Math.min(...vpds) : null;
      const maxVpd = vpds.length ? Math.max(...vpds) : null;

      // Light cycle (day = >50 lux)
      const lightReadings = readings.map(r => r.light).filter(v => v != null);
      const dayReadings = lightReadings.filter(v => v > 50).length;
      const totalLightReadings = lightReadings.length;
      const dayHours = totalLightReadings > 0
        ? Math.round((dayReadings / totalLightReadings) * 24 * 10) / 10
        : null;
      const nightHours = dayHours != null ? Math.round((24 - dayHours) * 10) / 10 : null;

      // Format message
      const zoneName = zone.name || zone.zoneId;
      const dateLabel = yesterday.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', timeZone: 'Europe/Prague' });
      let msg = `📊 <b>Сводка за ${dateLabel}</b>\n<b>Зона: ${zoneName}</b>\n`;

      if (avgTemp != null) {
        msg += `\n🌡 <b>Температура</b>\n   средняя: ${avgTemp.toFixed(1)}°C (${minTemp.toFixed(1)}–${maxTemp.toFixed(1)})`;
      }
      if (avgHum != null) {
        msg += `\n💧 <b>Влажность</b>\n   средняя: ${avgHum.toFixed(0)}% (${minHum.toFixed(0)}–${maxHum.toFixed(0)})`;
      }
      if (avgCo2 != null) {
        msg += `\n🫧 <b>CO2</b>\n   средний: ${Math.round(avgCo2)} ppm (макс: ${Math.round(maxCo2)})`;
      }
      if (avgVpd != null) {
        msg += `\n🌱 <b>VPD</b>\n   средний: ${avgVpd.toFixed(2)} kPa (${minVpd.toFixed(2)}–${maxVpd.toFixed(2)})`;
      }
      if (dayHours != null) {
        msg += `\n☀️ <b>Фотопериод</b>\n   день: ${dayHours}ч / ночь: ${nightHours}ч`;
      }

      msg += `\n\n📈 Всего показаний: ${readings.length}`;

      await sendTelegram(chatId, msg);
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
  const saved = lastSummaryDate;
  lastSummaryDate = null; // reset to allow sending
  // Temporarily override time check
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!chatId) return { ok: false, error: 'TELEGRAM_CHAT_ID not configured' };

  try {
    const zones = await Zone.find().lean();
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    for (const zone of zones) {
      const readings = await SensorReading.find({
        zoneId: zone.zoneId,
        timestamp: { $gte: yesterday, $lt: todayStart }
      }).lean();

      if (!readings.length) continue;

      const temps = readings.map(r => r.temperature).filter(v => v != null);
      const avgTemp = temps.length ? (temps.reduce((a, b) => a + b, 0) / temps.length) : null;
      const minTemp = temps.length ? Math.min(...temps) : null;
      const maxTemp = temps.length ? Math.max(...temps) : null;

      const hums = readings.map(r => r.humidity_sht45 ?? r.humidity).filter(v => v != null);
      const avgHum = hums.length ? (hums.reduce((a, b) => a + b, 0) / hums.length) : null;
      const minHum = hums.length ? Math.min(...hums) : null;
      const maxHum = hums.length ? Math.max(...hums) : null;

      const co2s = readings.map(r => r.co2).filter(v => v != null);
      const avgCo2 = co2s.length ? (co2s.reduce((a, b) => a + b, 0) / co2s.length) : null;
      const maxCo2 = co2s.length ? Math.max(...co2s) : null;

      const vpds = readings.map(r => {
        const canopyT = r.temperatures?.find(t => t.location === 'canopy')?.value;
        const airT = r.temperature;
        const rh = r.humidity_sht45 ?? r.humidity;
        if (canopyT == null || airT == null || rh == null) return null;
        const svpLeaf = 0.6108 * Math.exp(17.27 * canopyT / (canopyT + 237.3));
        const svpAir = 0.6108 * Math.exp(17.27 * airT / (airT + 237.3));
        return Math.max(0, svpLeaf - svpAir * rh / 100);
      }).filter(v => v != null);
      const avgVpd = vpds.length ? (vpds.reduce((a, b) => a + b, 0) / vpds.length) : null;
      const minVpd = vpds.length ? Math.min(...vpds) : null;
      const maxVpd = vpds.length ? Math.max(...vpds) : null;

      const lightReadings = readings.map(r => r.light).filter(v => v != null);
      const dayReadings = lightReadings.filter(v => v > 50).length;
      const totalLightReadings = lightReadings.length;
      const dayHours = totalLightReadings > 0
        ? Math.round((dayReadings / totalLightReadings) * 24 * 10) / 10
        : null;
      const nightHours = dayHours != null ? Math.round((24 - dayHours) * 10) / 10 : null;

      const zoneName = zone.name || zone.zoneId;
      const dateLabel = yesterday.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', timeZone: 'Europe/Prague' });
      let msg = `📊 <b>Сводка за ${dateLabel}</b>\n<b>Зона: ${zoneName}</b>\n`;

      if (avgTemp != null) msg += `\n🌡 <b>Температура</b>\n   средняя: ${avgTemp.toFixed(1)}°C (${minTemp.toFixed(1)}–${maxTemp.toFixed(1)})`;
      if (avgHum != null) msg += `\n💧 <b>Влажность</b>\n   средняя: ${avgHum.toFixed(0)}% (${minHum.toFixed(0)}–${maxHum.toFixed(0)})`;
      if (avgCo2 != null) msg += `\n🫧 <b>CO2</b>\n   средний: ${Math.round(avgCo2)} ppm (макс: ${Math.round(maxCo2)})`;
      if (avgVpd != null) msg += `\n🌱 <b>VPD</b>\n   средний: ${avgVpd.toFixed(2)} kPa (${minVpd.toFixed(2)}–${maxVpd.toFixed(2)})`;
      if (dayHours != null) msg += `\n☀️ <b>Фотопериод</b>\n   день: ${dayHours}ч / ночь: ${nightHours}ч`;
      msg += `\n\n📈 Всего показаний: ${readings.length}`;

      await sendTelegram(chatId, msg);
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
