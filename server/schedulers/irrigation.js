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
 * Query Home Assistant for the actual state of a switch entity.
 * Returns 'on', 'off', or 'unknown' (HA unreachable, token missing, etc).
 */
async function haGetState(entityId) {
  const haUrl = process.env.HA_URL || 'http://localhost:8123';
  const haToken = process.env.HA_TOKEN;
  if (!haToken) return 'unknown';
  try {
    const resp = await fetch(`${haUrl}/api/states/${encodeURIComponent(entityId)}`, {
      headers: { 'Authorization': `Bearer ${haToken}` }
    });
    if (!resp.ok) return 'unknown';
    const body = await resp.json();
    const state = String(body?.state || '').toLowerCase();
    if (state === 'on' || state === 'off') return state;
    return 'unknown';
  } catch (e) {
    console.error('[irrigation] HA state query error:', e.message);
    return 'unknown';
  }
}

/**
 * Turn the pump OFF with retries. Returns true on confirmed success (HA
 * reports state = 'off' after the call), false if we couldn't confirm.
 */
async function haTurnOffConfirmed(entityId, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    await haSwitch(entityId, 'off');
    // Small delay to let HA state propagate
    await new Promise(r => setTimeout(r, 800));
    const state = await haGetState(entityId);
    if (state === 'off') return true;
    if (state === 'unknown' && i === attempts - 1) return false;
  }
  return false;
}

/**
 * Reconciliation pass run on every scheduler tick. Three things happen:
 *
 *   1. Query Home Assistant for the real state of each zone's switch
 *      entity and remember it on IrrigationSchedule.liveState. That way
 *      the UI always has an up-to-date, authoritative "is it actually on"
 *      regardless of what our own command log says.
 *
 *   2. If a zone's most recent log entry is an ON whose expectedOffAt has
 *      already passed, turn the pump off (with confirm) and write the OFF
 *      log. Handles missed scheduled offs after a restart.
 *
 *   3. If HA state disagrees with our log — e.g. HA says off but our last
 *      log says on (someone toggled the plug manually in HA), or HA says
 *      on but we have no open ON event — write a synthetic log entry
 *      with trigger='external' so the log stays accurate. If HA reports
 *      the pump on past its scheduled end and we can't reach HA to stop
 *      it, flag the zone as "stuck".
 */
async function reconcileZones() {
  try {
    const configs = await IrrigationSchedule.find({ enabled: true }).lean();
    const now = new Date();

    for (const config of configs) {
      const entityId = config.entityId || 'switch.cuco_v2eur_f6d3_switch';

      // 1. Query HA for the real state
      const liveState = await haGetState(entityId);

      const lastLog = await IrrigationLog
        .findOne({ zoneId: config.zoneId })
        .sort({ timestamp: -1 })
        .lean();

      const lastAction = lastLog?.action || null;
      const expectedOff = lastLog?.expectedOffAt ? new Date(lastLog.expectedOffAt) : null;
      const overdueOff = lastAction === 'on' && expectedOff && expectedOff <= now;

      let stuck = false;
      let stuckReason = '';

      // 2. Scheduled ON has overrun — stop it
      if (overdueOff) {
        if (liveState === 'off') {
          // Pump is already off, our log just doesn't have a matching OFF.
          console.log(`[irrigation] ${config.zoneId}: HA already off, closing log (expected ${expectedOff.toISOString()})`);
          await IrrigationLog.create({
            zoneId: config.zoneId,
            action: 'off',
            trigger: lastLog.trigger || 'schedule',
            scheduleTime: lastLog.scheduleTime || null,
            duration: lastLog.duration || null,
          });
        } else {
          console.log(`[irrigation] ${config.zoneId}: turning off (live=${liveState}, expected off ${expectedOff.toISOString()})`);
          const confirmed = await haTurnOffConfirmed(entityId);
          if (confirmed) {
            await IrrigationLog.create({
              zoneId: config.zoneId,
              action: 'off',
              trigger: lastLog.trigger || 'schedule',
              scheduleTime: lastLog.scheduleTime || null,
              duration: lastLog.duration || null,
            });
          } else {
            // Pump is stuck — HA unreachable or not responding. Don't write
            // a misleading OFF log; flag the zone so the UI can warn.
            stuck = true;
            stuckReason = liveState === 'unknown'
              ? 'HA unreachable during scheduled off'
              : 'Pump reports ON past scheduled off time';
            console.error(`[irrigation] ${config.zoneId}: STUCK — ${stuckReason}`);
          }
        }
      }

      // 3. Drift between HA and our log (not handled by overdue path above)
      if (!overdueOff && liveState !== 'unknown' && lastAction && lastAction !== liveState) {
        console.log(`[irrigation] ${config.zoneId}: drift detected — log says ${lastAction}, HA says ${liveState}`);
        await IrrigationLog.create({
          zoneId: config.zoneId,
          action: liveState,
          trigger: 'external',
          scheduleTime: null,
          duration: null,
        });
      }

      // Re-query live state once more if we just turned it off, so the stored
      // liveState reflects the post-reconciliation reality.
      const finalLive = overdueOff ? await haGetState(entityId) : liveState;

      // If pump is confirmed off, clear any stuck flag
      if (finalLive === 'off') {
        stuck = false;
        stuckReason = '';
      }

      await IrrigationSchedule.updateOne(
        { _id: config._id },
        { $set: { liveState: finalLive, liveStateAt: new Date(), stuck, stuckReason } }
      );
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
    // 1. Reconcile HA state and close any overrun ON events
    await reconcileZones();

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
