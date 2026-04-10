import IrrigationSchedule from '../models/IrrigationSchedule.js';
import IrrigationLog from '../models/IrrigationLog.js';

// In-flight triggers to avoid double-firing within the same minute.
// Key: "zoneId:HH:MM". Cleared automatically on the next tick once the
// schedule minute rolls past.
const triggeredThisMinute = new Set();

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
 * Reconcile: for every configured zone, find the most recent log entry.
 * If it's an ON whose expectedOffAt has already passed, turn the pump off
 * and log the OFF event. This catches cases where the server was restarted
 * (Railway deploy) between the scheduled ON and the corresponding OFF.
 */
async function reconcilePendingOffs() {
  try {
    const configs = await IrrigationSchedule.find({ enabled: true }).lean();
    const now = new Date();

    for (const config of configs) {
      const lastLog = await IrrigationLog
        .findOne({ zoneId: config.zoneId })
        .sort({ timestamp: -1 })
        .lean();

      if (!lastLog || lastLog.action !== 'on') continue;
      if (!lastLog.expectedOffAt) continue;
      if (new Date(lastLog.expectedOffAt) > now) continue; // still running

      console.log(`[irrigation] Reconciling missed OFF for ${config.zoneId} (expected ${new Date(lastLog.expectedOffAt).toISOString()})`);

      const entityId = config.entityId || 'switch.cuco_v2eur_f6d3_switch';
      await haSwitch(entityId, 'off');
      // Log OFF regardless of HA success — otherwise a flaky HA call would
      // leave the DB showing an eternally-open ON entry.
      await IrrigationLog.create({
        zoneId: config.zoneId,
        action: 'off',
        trigger: lastLog.trigger || 'schedule',
        scheduleTime: lastLog.scheduleTime || null,
        duration: lastLog.duration || null,
      });
    }
  } catch (e) {
    console.error('[irrigation] Reconciliation error:', e.message);
  }
}

/**
 * Check schedules and trigger irrigation if time matches the current minute.
 */
async function checkSchedules() {
  try {
    // 1. Reconcile any pending OFFs from a previous tick or restart
    await reconcilePendingOffs();

    const currentTime = getPragueTime();

    // Clear stale entries from the per-minute dedup set (keys of the form
    // "<zoneId>:HH:MM" — drop any whose HH:MM is not the current minute).
    for (const key of Array.from(triggeredThisMinute)) {
      const lastColon = key.lastIndexOf(':');
      const prevColon = key.lastIndexOf(':', lastColon - 1);
      const time = key.slice(prevColon + 1);
      if (time !== currentTime) triggeredThisMinute.delete(key);
    }

    const configs = await IrrigationSchedule.find({ enabled: true }).lean();

    for (const config of configs) {
      for (const sched of config.schedules) {
        if (!sched.enabled) continue;
        if (sched.time !== currentTime) continue;

        const triggerKey = `${config.zoneId}:${sched.time}`;
        if (triggeredThisMinute.has(triggerKey)) continue;

        // Also safeguard: if we already logged an ON for this zone at this
        // schedule time within the last 2 minutes, don't re-trigger.
        const recentOn = await IrrigationLog.findOne({
          zoneId: config.zoneId,
          action: 'on',
          scheduleTime: sched.time,
          timestamp: { $gte: new Date(Date.now() - 2 * 60 * 1000) },
        }).lean();
        if (recentOn) {
          triggeredThisMinute.add(triggerKey);
          continue;
        }

        console.log(`[irrigation] Triggering ${config.zoneId} at ${sched.time} for ${sched.duration}min`);

        const entityId = config.entityId || 'switch.cuco_v2eur_f6d3_switch';
        const ok = await haSwitch(entityId, 'on');
        if (!ok) continue;

        const expectedOffAt = new Date(Date.now() + sched.duration * 60 * 1000);

        await IrrigationLog.create({
          zoneId: config.zoneId,
          action: 'on',
          trigger: 'schedule',
          scheduleTime: sched.time,
          duration: sched.duration,
          expectedOffAt,
        });

        triggeredThisMinute.add(triggerKey);
      }
    }
  } catch (e) {
    console.error('[irrigation] Scheduler error:', e.message);
  }
}

/**
 * Initialize the irrigation scheduler (runs every 30 seconds).
 * On startup it also reconciles any pending OFFs that were left hanging
 * by the previous process (e.g. across a deploy).
 */
export function initIrrigationScheduler() {
  console.log('[irrigation] Scheduler started (30s interval, TZ=Europe/Prague)');
  setInterval(checkSchedules, 30 * 1000);
  // Run once immediately — this also reconciles stale ON logs from before
  // the restart.
  checkSchedules();
}
