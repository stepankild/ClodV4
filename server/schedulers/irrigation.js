import IrrigationSchedule from '../models/IrrigationSchedule.js';
import IrrigationLog from '../models/IrrigationLog.js';
import Zone from '../models/Zone.js';
import AlertConfig from '../models/AlertConfig.js';

// In-flight triggers to avoid double-firing within the same minute.
// Key: "zoneId:HH:MM". Cleared automatically on the next tick once the
// schedule minute rolls past.
const triggeredThisMinute = new Set();

// ── Telegram notifier with per-event-type cooldown ─────────────────────
// Key: "zoneId:type" → { lastSent: ms }
const notifyCooldowns = new Map();
const NOTIFY_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour per (zone, eventType)

async function sendTelegram(chatId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !chatId) return false;
  try {
    const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true })
    });
    return resp.ok;
  } catch (e) {
    console.error('[irrigation] telegram send error:', e.message);
    return false;
  }
}

async function notify(zoneId, type, buildMessage) {
  const key = `${zoneId}:${type}`;
  const prev = notifyCooldowns.get(key);
  if (prev && Date.now() - prev.lastSent < NOTIFY_COOLDOWN_MS) return;

  const zone = await Zone.findOne({ zoneId }).lean();
  const config = await AlertConfig.findOne({ zoneId }).lean();
  const chatId = config?.telegramChatId || process.env.TELEGRAM_CHAT_ID;
  if (!chatId) return;

  const zoneName = zone?.name || zoneId;
  const msg = buildMessage(zoneName);
  const ok = await sendTelegram(chatId, msg);
  if (ok) notifyCooldowns.set(key, { lastSent: Date.now() });
}

function pragueNow() {
  return new Date().toLocaleString('cs-CZ', { timeZone: 'Europe/Prague', hour: '2-digit', minute: '2-digit', hour12: false });
}

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
 * Turn the pump ON with retries. Returns:
 *   { ok: true, state: 'on' }             — confirmed ON
 *   { ok: false, state: 'off' | 'unknown', reason: string } — failure
 *
 * Retries because Xiaomi plugs via Mi-Home ↔ HA sometimes drop the first
 * service call when the device was idle.
 */
async function haTurnOnConfirmed(entityId, attempts = 3) {
  let lastState = 'unknown';
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    const ok = await haSwitch(entityId, 'on');
    if (!ok) lastErr = 'HA service call failed';
    await new Promise(r => setTimeout(r, 1200));
    const state = await haGetState(entityId);
    lastState = state;
    if (state === 'on') return { ok: true, state: 'on' };
    if (state === 'unknown') lastErr = lastErr || 'HA unreachable';
  }
  return {
    ok: false,
    state: lastState,
    reason: lastState === 'unknown'
      ? (lastErr || 'HA unreachable')
      : `Pump still ${lastState} after ${attempts} attempts`,
  };
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
            // Urgent Telegram alert so user can physically pull the plug
            const overdueMin = Math.round((now.getTime() - expectedOff.getTime()) / 60000);
            await notify(config.zoneId, 'stuck', (zoneName) => (
              `🚨 <b>Насос полива ЗАВИС</b>\n` +
              `Зона: <b>${zoneName}</b>\n` +
              `Работает уже ${overdueMin} мин сверх расписания\n` +
              `Причина: ${stuckReason}\n` +
              `⚠️ Проверьте Home Assistant или выдерните вилку вручную\n` +
              `🕐 ${pragueNow()} Prague`
            ));
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

      // 4. Missed-schedule detection: for each scheduled HH:MM, check
      // whether we're 2-15 min past the expected time AND no ON/failure
      // log exists for it today. That means the tick fell off the rails
      // (Railway restart or HA blackout covering the exact minute).
      const pragueNowStr = getPragueTime();
      const [nowH, nowM] = pragueNowStr.split(':').map(Number);
      const nowMinutes = nowH * 60 + nowM;
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      for (const sched of config.schedules) {
        if (!sched.enabled) continue;
        const [h, m] = sched.time.split(':').map(Number);
        const schedMinutes = h * 60 + m;
        const elapsedMin = nowMinutes - schedMinutes;
        if (elapsedMin < 2 || elapsedMin > 15) continue; // only fire once in the 2-15 min window

        const existing = await IrrigationLog.findOne({
          zoneId: config.zoneId,
          scheduleTime: sched.time,
          timestamp: { $gte: todayStart },
        }).lean();
        if (existing) continue; // fired or logged as failure/miss already

        console.warn(`[irrigation] ${config.zoneId} ${sched.time}: MISSED (no log today, ${elapsedMin}min past)`);
        await IrrigationLog.create({
          zoneId: config.zoneId,
          action: 'miss',
          trigger: 'system',
          scheduleTime: sched.time,
          duration: sched.duration,
          notes: `Tick didn't fire — Railway restart or HA blackout during ${sched.time}`,
        });
        await notify(config.zoneId, `miss_${sched.time}`, (zoneName) => (
          `⚠️ <b>Полив пропущен</b>\n` +
          `Зона: <b>${zoneName}</b>\n` +
          `Расписание ${sched.time} не сработало (Railway рестарт или HA недоступен)\n` +
          `💡 Запустите вручную если нужно\n` +
          `🕐 ${pragueNow()} Prague`
        ));
      }
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
        const result = await haTurnOnConfirmed(entityId);

        if (!result.ok) {
          // Confirmed failure — log + alert user so they can act
          console.error(`[irrigation] ${config.zoneId} ${sched.time}: FAILED — ${result.reason}`);
          await IrrigationLog.create({
            zoneId: config.zoneId,
            action: 'failure',
            trigger: 'schedule',
            scheduleTime: sched.time,
            duration: sched.duration,
            notes: result.reason,
          });
          await notify(config.zoneId, 'fire_failed', (zoneName) => (
            `🚨 <b>Полив не сработал</b>\n` +
            `Зона: <b>${zoneName}</b>\n` +
            `Расписание: ${sched.time} · ${sched.duration} мин\n` +
            `Причина: ${result.reason}\n` +
            `🕐 ${pragueNow()} Prague`
          ));
          triggeredThisMinute.add(triggerKey);
          continue;
        }

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
