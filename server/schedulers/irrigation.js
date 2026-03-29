import IrrigationSchedule from '../models/IrrigationSchedule.js';
import IrrigationLog from '../models/IrrigationLog.js';

// Track active timers to avoid duplicates: key = "zoneId:HH:MM"
const activeTimers = new Map();

/**
 * Get current time in Europe/Prague timezone as HH:MM
 */
function getPragueTime() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Prague',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(now);
  const hour = parts.find(p => p.type === 'hour').value;
  const minute = parts.find(p => p.type === 'minute').value;
  return `${hour}:${minute}`;
}

/**
 * Turn irrigation on/off via Home Assistant API
 */
async function haSwitch(entityId, action) {
  const haUrl = process.env.HA_URL || 'http://localhost:8123';
  const haToken = process.env.HA_TOKEN;
  if (!haToken) {
    console.error('[irrigation] HA_TOKEN not configured');
    return false;
  }
  try {
    const resp = await fetch(`${haUrl}/api/services/switch/turn_${action}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${haToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ entity_id: entityId })
    });
    if (!resp.ok) {
      console.error(`[irrigation] HA error: ${resp.status}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[irrigation] HA request error:', e.message);
    return false;
  }
}

/**
 * Check schedules and trigger irrigation if time matches
 */
async function checkSchedules() {
  try {
    const currentTime = getPragueTime();
    const configs = await IrrigationSchedule.find({ enabled: true }).lean();

    for (const config of configs) {
      for (const sched of config.schedules) {
        if (!sched.enabled) continue;
        if (sched.time !== currentTime) continue;

        const timerKey = `${config.zoneId}:${sched.time}`;
        if (activeTimers.has(timerKey)) continue; // already running

        console.log(`[irrigation] Triggering ${config.zoneId} at ${sched.time} for ${sched.duration}min`);

        const entityId = config.entityId || 'switch.cuco_v2eur_f6d3_switch';
        const ok = await haSwitch(entityId, 'on');
        if (!ok) continue;

        await IrrigationLog.create({
          zoneId: config.zoneId,
          action: 'on',
          trigger: 'schedule',
          scheduleTime: sched.time,
          duration: sched.duration
        });

        // Schedule turn-off after duration
        const timer = setTimeout(async () => {
          await haSwitch(entityId, 'off');
          await IrrigationLog.create({
            zoneId: config.zoneId,
            action: 'off',
            trigger: 'schedule',
            scheduleTime: sched.time,
            duration: sched.duration
          });
          activeTimers.delete(timerKey);
          console.log(`[irrigation] Turned off ${config.zoneId} after ${sched.duration}min`);
        }, sched.duration * 60 * 1000);

        activeTimers.set(timerKey, timer);
      }
    }
  } catch (e) {
    console.error('[irrigation] Scheduler error:', e.message);
  }
}

/**
 * Initialize the irrigation scheduler (runs every 30 seconds)
 */
export function initIrrigationScheduler() {
  console.log('[irrigation] Scheduler started (30s interval, TZ=Europe/Prague)');
  setInterval(checkSchedules, 30 * 1000);
  // Run once immediately
  checkSchedules();
}
