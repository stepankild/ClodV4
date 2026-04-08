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
  console.log('[alerts] Scheduler started (30s interval)');
  setInterval(checkAlerts, 30 * 1000);
  setTimeout(checkAlerts, 10000); // first check after 10s
}
