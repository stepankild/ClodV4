import Zone from '../models/Zone.js';
import SensorReading from '../models/SensorReading.js';
import HumidifierLog from '../models/HumidifierLog.js';
import IrrigationSchedule from '../models/IrrigationSchedule.js';
import IrrigationLog from '../models/IrrigationLog.js';
import AlertConfig from '../models/AlertConfig.js';
import AlertLog from '../models/AlertLog.js';
import { sendTestAlert, sendDailySummaryNow } from '../schedulers/alerts.js';
import { syncPump } from '../schedulers/humidifier.js';
import { getZoneStates, getZoneState, getZigbeeDevices } from '../mqtt/index.js';

// @desc    Get all zones with status and latest reading
// @route   GET /api/zones
export const getZones = async (req, res) => {
  try {
    const zones = await Zone.find().sort({ zoneId: 1 }).lean();
    const states = getZoneStates();

    // Attach live status and last reading to each zone
    const result = await Promise.all(zones.map(async (zone) => {
      const live = states[zone.zoneId];
      const lastReading = await SensorReading.findOne({
        zoneId: zone.zoneId,
        // Skip "state-only" docs (humidifierState without any sensor reading).
        // Legacy empty docs created by rogue humidity-ctrl.py are still in DB
        // and would otherwise poison zone.lastData on cold-start fallback.
        $or: [
          { temperature: { $ne: null } },
          { humidity: { $ne: null } },
          { humidity_sht45: { $ne: null } },
          { co2: { $ne: null } },
          { light: { $ne: null } },
          { 'temperatures.0': { $exists: true } },
        ],
      }).sort({ timestamp: -1 }).lean();
      return {
        ...zone,
        piStatus: {
          ...zone.piStatus,
          online: live?.online ?? zone.piStatus?.online ?? false,
          lastSeen: live?.lastSeen ?? zone.piStatus?.lastSeen,
        },
        lastData: live?.lastData ?? lastReading ?? null,
        zigbeeDevices: getZigbeeDevices(zone.zoneId),
      };
    }));

    res.json(result);
  } catch (error) {
    console.error('Get zones error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get single zone with status
// @route   GET /api/zones/:zoneId
export const getZone = async (req, res) => {
  try {
    const zone = await Zone.findOne({ zoneId: req.params.zoneId }).lean();
    if (!zone) return res.status(404).json({ message: 'Zone not found' });

    const live = getZoneState(zone.zoneId);
    zone.piStatus = {
      ...zone.piStatus,
      online: live?.online ?? zone.piStatus?.online ?? false,
      lastSeen: live?.lastSeen ?? zone.piStatus?.lastSeen,
    };
    const lastReading = await SensorReading.findOne({
      zoneId: zone.zoneId,
      $or: [
        { temperature: { $ne: null } },
        { humidity: { $ne: null } },
        { humidity_sht45: { $ne: null } },
        { co2: { $ne: null } },
        { light: { $ne: null } },
        { 'temperatures.0': { $exists: true } },
      ],
    }).sort({ timestamp: -1 }).lean();
    zone.lastData = live?.lastData ?? lastReading ?? null;

    // Attach Zigbee device data — in-memory (live) merged with MongoDB (persisted)
    const liveZigbee = getZigbeeDevices(zone.zoneId);
    zone.zigbeeDevices = { ...(zone.zigbeeDevices || {}), ...liveZigbee };

    res.json(zone);
  } catch (error) {
    console.error('Get zone error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Create zone
// @route   POST /api/zones
export const createZone = async (req, res) => {
  try {
    const { zoneId, name, roomRef, config, sensors } = req.body;
    if (!zoneId || !name) {
      return res.status(400).json({ message: 'zoneId and name are required' });
    }

    const existing = await Zone.findOne({ zoneId });
    if (existing) {
      return res.status(400).json({ message: 'Zone with this ID already exists' });
    }

    const zone = await Zone.create({ zoneId, name, roomRef, config, sensors });
    res.status(201).json(zone);
  } catch (error) {
    console.error('Create zone error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Update zone config
// @route   PUT /api/zones/:zoneId
export const updateZone = async (req, res) => {
  try {
    const zone = await Zone.findOneAndUpdate(
      { zoneId: req.params.zoneId },
      { $set: req.body },
      { new: true, runValidators: true }
    );
    if (!zone) return res.status(404).json({ message: 'Zone not found' });
    res.json(zone);
  } catch (error) {
    console.error('Update zone error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Delete zone
// @route   DELETE /api/zones/:zoneId
export const deleteZone = async (req, res) => {
  try {
    const zone = await Zone.findOneAndDelete({ zoneId: req.params.zoneId });
    if (!zone) return res.status(404).json({ message: 'Zone not found' });
    res.json({ message: 'Zone deleted' });
  } catch (error) {
    console.error('Delete zone error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get sensor readings for a zone
// @route   GET /api/zones/:zoneId/readings
export const getReadings = async (req, res) => {
  try {
    const { zoneId } = req.params;
    const { from, to, interval } = req.query;

    const match = { zoneId };
    if (from || to) {
      match.timestamp = {};
      if (from) match.timestamp.$gte = new Date(from);
      if (to) match.timestamp.$lte = new Date(to);
    }

    // Determine if we need aggregation
    const now = new Date();
    const fromDate = from ? new Date(from) : new Date(now - 24 * 3600 * 1000);
    const rangeMs = (to ? new Date(to) : now) - fromDate;
    const rangeHours = rangeMs / 3600000;

    // Auto-determine interval if not specified
    let intervalMinutes = null;
    if (interval) {
      intervalMinutes = parseInt(interval);
    } else if (rangeHours > 24 * 7) {
      intervalMinutes = 120; // 2h for >7d
    } else if (rangeHours > 24) {
      intervalMinutes = 5; // 5min for >24h
    } else if (rangeHours > 6) {
      intervalMinutes = 5; // 5min for >6h
    }

    if (!match.timestamp) {
      match.timestamp = { $gte: fromDate };
    }

    if (intervalMinutes) {
      const bucketExpr = {
        $toDate: {
          $subtract: [
            { $toLong: '$timestamp' },
            { $mod: [{ $toLong: '$timestamp' }, intervalMinutes * 60 * 1000] }
          ]
        }
      };

      // Pipeline 1: scalar fields (temperature, humidity, co2, light)
      const scalarPipeline = [
        { $match: match },
        {
          $group: {
            _id: bucketExpr,
            temperature: { $avg: '$temperature' },
            humidity: { $avg: '$humidity' },
            humidity_sht45: { $avg: '$humidity_sht45' },
            co2: { $avg: '$co2' },
            light: { $avg: '$light' },
            pi_temp: { $avg: '$pi_temp' },
            pi_throttled_max: { $max: '$pi_throttled' },
            pi_load: { $avg: '$pi_load' },
            count: { $sum: 1 },
          }
        },
        { $sort: { _id: 1 } },
        {
          $project: {
            _id: 0,
            timestamp: '$_id',
            temperature: { $round: ['$temperature', 1] },
            humidity: { $round: ['$humidity', 1] },
            humidity_sht45: { $round: ['$humidity_sht45', 1] },
            co2: { $round: ['$co2', 0] },
            light: { $round: ['$light', 0] },
            pi_temp: { $round: ['$pi_temp', 1] },
            pi_throttled: '$pi_throttled_max',
            pi_load: { $round: ['$pi_load', 2] },
            count: 1,
          }
        }
      ];

      // Pipeline 2: per-sensor temperature averages
      const tempPipeline = [
        { $match: match },
        { $unwind: '$temperatures' },
        {
          $group: {
            _id: { bucket: bucketExpr, sensorId: '$temperatures.sensorId' },
            value: { $avg: '$temperatures.value' },
            location: { $first: '$temperatures.location' },
          }
        },
        {
          $group: {
            _id: '$_id.bucket',
            temperatures: {
              $push: {
                sensorId: '$_id.sensorId',
                location: '$location',
                value: { $round: ['$value', 1] },
              }
            }
          }
        },
        { $sort: { _id: 1 } }
      ];

      // Pipeline 3: per-sensor humidity averages (Zigbee propagators, etc.)
      const humidPipeline = [
        { $match: match },
        { $unwind: '$humidityReadings' },
        {
          $group: {
            _id: { bucket: bucketExpr, sensorId: '$humidityReadings.sensorId' },
            value: { $avg: '$humidityReadings.value' },
            location: { $first: '$humidityReadings.location' },
          }
        },
        {
          $group: {
            _id: '$_id.bucket',
            humidityReadings: {
              $push: {
                sensorId: '$_id.sensorId',
                location: '$location',
                value: { $round: ['$value', 1] },
              }
            }
          }
        },
        { $sort: { _id: 1 } }
      ];

      const [scalarReadings, tempReadings, humidReadings] = await Promise.all([
        SensorReading.aggregate(scalarPipeline),
        SensorReading.aggregate(tempPipeline),
        SensorReading.aggregate(humidPipeline),
      ]);

      // Merge: attach per-sensor temperatures + humidity to each scalar bucket
      const tempMap = new Map(tempReadings.map(t => [t._id.getTime(), t.temperatures]));
      const humidMap = new Map(humidReadings.map(h => [h._id.getTime(), h.humidityReadings]));
      const readings = scalarReadings.map(r => ({
        ...r,
        temperatures: tempMap.get(new Date(r.timestamp).getTime()) || [],
        humidityReadings: humidMap.get(new Date(r.timestamp).getTime()) || [],
      }));

      res.json(readings);
    } else {
      // Raw query
      const readings = await SensorReading.find(match)
        .sort({ timestamp: 1 })
        .limit(2000)
        .lean();
      res.json(readings);
    }
  } catch (error) {
    console.error('Get readings error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get latest reading for a zone
// @route   GET /api/zones/:zoneId/readings/latest
export const getLatestReading = async (req, res) => {
  try {
    // Filter out state-only docs (humidifierState with no sensor values)
    const reading = await SensorReading.findOne({
      zoneId: req.params.zoneId,
      $or: [
        { temperature: { $ne: null } },
        { humidity: { $ne: null } },
        { humidity_sht45: { $ne: null } },
        { co2: { $ne: null } },
        { light: { $ne: null } },
        { 'temperatures.0': { $exists: true } },
      ],
    }).sort({ timestamp: -1 }).lean();
    res.json(reading || null);
  } catch (error) {
    console.error('Get latest reading error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get compact display data for e-ink screen
// @route   GET /api/zones/:zoneId/display
export const getDisplayData = async (req, res) => {
  try {
    const { zoneId } = req.params;
    const zone = await Zone.findOne({ zoneId }).lean();
    if (!zone) return res.status(404).json({ message: 'Zone not found' });

    // Get live state or last reading
    const live = getZoneState(zoneId);
    const lastReading = await SensorReading.findOne({
      zoneId,
      $or: [
        { temperature: { $ne: null } },
        { humidity: { $ne: null } },
        { humidity_sht45: { $ne: null } },
        { co2: { $ne: null } },
        { light: { $ne: null } },
        { 'temperatures.0': { $exists: true } },
      ],
    }).sort({ timestamp: -1 }).lean();
    const data = live?.lastData ?? lastReading;

    // Calculate light cycle from last 24h
    const since24h = new Date(Date.now() - 24 * 3600 * 1000);
    const dayReadings = await SensorReading.countDocuments({
      zoneId, timestamp: { $gte: since24h }, light: { $gt: 50 }
    });
    const totalReadings = await SensorReading.countDocuments({
      zoneId, timestamp: { $gte: since24h }, light: { $ne: null }
    });
    const dayHours = totalReadings > 0 ? (dayReadings / totalReadings) * 24 : null;
    const nightHours = dayHours != null ? 24 - dayHours : null;

    // VPD calculation
    let vpd = null;
    if (data) {
      const sht45T = data.temperatures?.find(t => t.sensorId === 'sht45' || t.location?.includes('sht45'))?.value;
      const airT = sht45T ?? data.temperature;
      const rh = data.humidity_sht45 ?? data.humidity;
      if (airT != null && rh != null) {
        const svp = 0.6108 * Math.exp(17.27 * airT / (airT + 237.3));
        vpd = Math.max(0, svp * (1 - rh / 100));
        vpd = Math.round(vpd * 100) / 100;
      }
    }

    // Compact response for e-ink
    res.json({
      zone: zone.name,
      online: live?.online ?? zone.piStatus?.online ?? false,
      ts: data?.timestamp ?? lastReading?.timestamp ?? null,
      temps: (data?.temperatures || []).map(t => ({
        loc: t.location || '',
        v: t.value != null ? Math.round(t.value * 10) / 10 : null,
      })),
      airT: data?.temperature != null ? Math.round(data.temperature * 10) / 10 : null,
      rh: data?.humidity != null ? Math.round(data.humidity * 10) / 10 : null,
      rh2: data?.humidity_sht45 != null ? Math.round(data.humidity_sht45 * 10) / 10 : null,
      co2: data?.co2 != null ? Math.round(data.co2) : null,
      lux: data?.light != null ? Math.round(data.light) : null,
      vpd,
      photo: dayHours != null ? { day: Math.round(dayHours * 10) / 10, night: Math.round(nightHours * 10) / 10 } : null,
    });
  } catch (error) {
    console.error('Get display data error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Control humidifier (on/off/auto)
// @route   POST /api/zones/:zoneId/humidifier
export const controlHumidifier = async (req, res) => {
  try {
    const { zoneId } = req.params;
    const { action } = req.body; // 'on', 'off', or mode update

    const zone = await Zone.findOne({ zoneId });
    if (!zone) return res.status(404).json({ message: 'Zone not found' });

    const haUrl = process.env.HA_URL || 'http://localhost:8123';
    const haToken = process.env.HA_TOKEN;

    if (action === 'on' || action === 'off') {
      if (!haToken) return res.status(500).json({ message: 'HA_TOKEN not configured' });
      const entityId = zone.config?.humidifierEntityId || 'switch.cuco_v2eur_189e_switch';
      try {
        const haResp = await fetch(`${haUrl}/api/services/switch/turn_${action}`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${haToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ entity_id: entityId })
        });
        if (!haResp.ok) {
          console.error(`HA error: ${haResp.status}`);
        }
      } catch (e) {
        console.error('HA request error:', e.message);
      }
      // Log manual action
      await HumidifierLog.create({ zoneId, action, trigger: 'manual' });
      // Sync pump after manual humidifier change
      syncPump().catch(e => console.error('syncPump error:', e.message));
    }

    // Build update object
    const update = {};
    if (req.body.mode) update['config.humidifierMode'] = req.body.mode;
    if (req.body.rhLow != null) update['config.rhLow'] = req.body.rhLow;
    if (req.body.rhHigh != null) update['config.rhHigh'] = req.body.rhHigh;

    const updated = await Zone.findOneAndUpdate(
      { zoneId },
      { $set: update },
      { new: true }
    );

    // Sync pump after mode change
    if (req.body.mode) {
      syncPump().catch(e => console.error('syncPump error:', e.message));
    }

    res.json({
      ok: true,
      mode: updated.config?.humidifierMode || 'manual_off',
      rhLow: updated.config?.rhLow ?? 60,
      rhHigh: updated.config?.rhHigh ?? 70
    });
  } catch (error) {
    console.error('Humidifier control error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get humidifier status from HA
// @route   GET /api/zones/:zoneId/humidifier/status
export const getHumidifierStatus = async (req, res) => {
  try {
    const { zoneId } = req.params;
    const zone = await Zone.findOne({ zoneId }).lean();
    if (!zone) return res.status(404).json({ message: 'Zone not found' });

    const haUrl = process.env.HA_URL || 'http://localhost:8123';
    const haToken = process.env.HA_TOKEN;

    let plugState = null;
    if (haToken) {
      const entityId = zone.config?.humidifierEntityId || 'switch.cuco_v2eur_189e_switch';
      try {
        const haResp = await fetch(`${haUrl}/api/states/${entityId}`, {
          headers: { 'Authorization': `Bearer ${haToken}` }
        });
        if (haResp.ok) {
          const data = await haResp.json();
          plugState = data.state; // 'on' or 'off'
        }
      } catch (e) {
        console.error('HA status fetch error:', e.message);
      }
    }

    res.json({
      mode: zone.config?.humidifierMode || 'manual_off',
      rhLow: zone.config?.rhLow ?? 60,
      rhHigh: zone.config?.rhHigh ?? 70,
      plugState,
      entityId: zone.config?.humidifierEntityId || 'switch.cuco_v2eur_189e_switch'
    });
  } catch (error) {
    console.error('Humidifier status error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get humidifier action log
// @route   GET /api/zones/:zoneId/humidifier/log
/**
 * Return Prague-local midnight for a given instant (as a UTC Date object).
 * Railway containers run in UTC, so Date#setHours(0) gives UTC midnight =
 * 02:00 Prague summer / 01:00 winter, which shifts daily stats by 1-2 hours.
 */
function pragueDayStart(now = new Date()) {
  const pragueStr = now.toLocaleString('en-US', { timeZone: 'Europe/Prague' });
  const pragueNow = new Date(pragueStr);
  const offsetMs = now.getTime() - pragueNow.getTime();
  pragueNow.setHours(0, 0, 0, 0);
  return new Date(pragueNow.getTime() + offsetMs);
}

/**
 * Sum ON-time inside [windowStart, windowEnd].
 * Handles the "already on at window start" case by looking up the last log
 * BEFORE the window; if it was 'on' we treat the humidifier as already on
 * at windowStart.
 */
async function computeOnMs(zoneId, windowStart, windowEnd) {
  const inWindow = await HumidifierLog.find({
    zoneId,
    timestamp: { $gte: windowStart, $lt: windowEnd },
  }).sort({ timestamp: 1 }).lean();

  const priorLog = await HumidifierLog.findOne({
    zoneId,
    timestamp: { $lt: windowStart },
  }).sort({ timestamp: -1 }).lean();

  let lastOn = priorLog?.action === 'on' ? windowStart.getTime() : null;
  let totalMs = 0;
  for (const log of inWindow) {
    const t = new Date(log.timestamp).getTime();
    if (log.action === 'on') {
      if (lastOn == null) lastOn = t; // ignore duplicate 'on' while already on
    } else if (log.action === 'off' && lastOn != null) {
      totalMs += t - lastOn;
      lastOn = null;
    }
  }
  if (lastOn != null) totalMs += windowEnd.getTime() - lastOn;
  return { totalMs, inWindow };
}

export const getHumidifierLog = async (req, res) => {
  try {
    const { zoneId } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const from = req.query.from ? new Date(req.query.from) : new Date(Date.now() - 7 * 24 * 3600 * 1000);

    const logs = await HumidifierLog.find({ zoneId, timestamp: { $gte: from } })
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();

    // Back-fill missing humidity on legacy entries (the rogue humidity-ctrl.py
    // POSTed without sensor fields, so ~half the rows have humidity=null).
    // Pick the closest SensorReading within ±3 min of the log timestamp.
    const missing = logs.filter(l => l.humidity == null);
    if (missing.length) {
      const tsList = missing.map(l => new Date(l.timestamp));
      const windowStart = new Date(Math.min(...tsList) - 3 * 60 * 1000);
      const windowEnd = new Date(Math.max(...tsList) + 3 * 60 * 1000);
      const readings = await SensorReading.find({
        zoneId,
        timestamp: { $gte: windowStart, $lte: windowEnd },
        $or: [
          { humidity_sht45: { $ne: null } },
          { humidity: { $ne: null } },
        ],
      }, { timestamp: 1, humidity: 1, humidity_sht45: 1 }).lean();

      if (readings.length) {
        // Sort by timestamp asc for binary-ish search
        readings.sort((a, b) => a.timestamp - b.timestamp);
        for (const log of missing) {
          const t = new Date(log.timestamp).getTime();
          let best = null;
          let bestDist = Infinity;
          for (const r of readings) {
            const d = Math.abs(new Date(r.timestamp).getTime() - t);
            if (d < bestDist) { bestDist = d; best = r; }
            else if (new Date(r.timestamp).getTime() > t + 3 * 60 * 1000) break;
          }
          if (best && bestDist <= 3 * 60 * 1000) {
            log.humidity = best.humidity_sht45 ?? best.humidity;
            log.humidityBackfilled = true; // hint for UI
          }
        }
      }
    }

    // Prague-local midnight → now (not server-local, fixes the 1-2h UTC skew)
    const todayStart = pragueDayStart();
    const nowDate = new Date();
    const todayLogs = logs.filter(l => new Date(l.timestamp) >= todayStart);
    const onCount = todayLogs.filter(l => l.action === 'on').length;
    const offCount = todayLogs.filter(l => l.action === 'off').length;

    const { totalMs } = await computeOnMs(zoneId, todayStart, nowDate);

    res.json({
      logs,
      stats: {
        todayOnCount: onCount,
        todayOffCount: offCount,
        todayOnMinutes: Math.round(totalMs / 60000)
      }
    });
  } catch (error) {
    console.error('Humidifier log error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// ============================================================
// Irrigation (Полив)
// ============================================================

// @desc    Control irrigation: manual on/off or update schedules
// @route   POST /api/zones/:zoneId/irrigation
export const controlIrrigation = async (req, res) => {
  try {
    const { zoneId } = req.params;
    const { action, schedules, enabled } = req.body;

    const haUrl = process.env.HA_URL || 'http://localhost:8123';
    const haToken = process.env.HA_TOKEN;

    // Get or create irrigation config for this zone
    let config = await IrrigationSchedule.findOne({ zoneId });
    if (!config) {
      config = await IrrigationSchedule.create({ zoneId });
    }

    // Manual on/off
    if (action === 'on' || action === 'off') {
      if (!haToken) return res.status(500).json({ message: 'HA_TOKEN not configured' });
      const entityId = config.entityId || 'switch.cuco_v2eur_f6d3_switch';
      try {
        const haResp = await fetch(`${haUrl}/api/services/switch/turn_${action}`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${haToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ entity_id: entityId })
        });
        if (!haResp.ok) {
          console.error(`HA irrigation error: ${haResp.status}`);
        }
      } catch (e) {
        console.error('HA irrigation request error:', e.message);
      }
      await IrrigationLog.create({ zoneId, action, trigger: 'manual' });
    }

    // Update schedules
    if (schedules !== undefined) {
      config.schedules = schedules;
    }
    if (enabled !== undefined) {
      config.enabled = enabled;
    }
    await config.save();

    res.json({
      ok: true,
      enabled: config.enabled,
      schedules: config.schedules,
      entityId: config.entityId
    });
  } catch (error) {
    console.error('Irrigation control error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get irrigation status (schedules + plug state from HA)
// @route   GET /api/zones/:zoneId/irrigation/status
export const getIrrigationStatus = async (req, res) => {
  try {
    const { zoneId } = req.params;

    let config = await IrrigationSchedule.findOne({ zoneId }).lean();
    if (!config) {
      config = { zoneId, name: 'Полив', entityId: 'switch.cuco_v2eur_f6d3_switch', enabled: true, schedules: [] };
    }

    const haUrl = process.env.HA_URL || 'http://localhost:8123';
    const haToken = process.env.HA_TOKEN;

    let plugState = null;
    if (haToken) {
      const entityId = config.entityId || 'switch.cuco_v2eur_f6d3_switch';
      try {
        const haResp = await fetch(`${haUrl}/api/states/${entityId}`, {
          headers: { 'Authorization': `Bearer ${haToken}` }
        });
        if (haResp.ok) {
          const data = await haResp.json();
          plugState = data.state; // 'on' or 'off'
        }
      } catch (e) {
        console.error('HA irrigation status fetch error:', e.message);
      }
    }

    res.json({
      enabled: config.enabled,
      schedules: config.schedules,
      plugState,
      entityId: config.entityId,
      liveState: config.liveState || 'unknown',
      liveStateAt: config.liveStateAt || null,
      stuck: config.stuck || false,
      stuckReason: config.stuckReason || ''
    });
  } catch (error) {
    console.error('Irrigation status error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get irrigation action log
// @route   GET /api/zones/:zoneId/irrigation/log
export const getIrrigationLog = async (req, res) => {
  try {
    const { zoneId } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const from = req.query.from ? new Date(req.query.from) : new Date(Date.now() - 7 * 24 * 3600 * 1000);

    const [logs, config] = await Promise.all([
      IrrigationLog.find({ zoneId, timestamp: { $gte: from } })
        .sort({ timestamp: -1 })
        .limit(limit)
        .lean(),
      IrrigationSchedule.findOne({ zoneId }).lean()
    ]);

    // Calculate stats
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayLogs = logs.filter(l => new Date(l.timestamp) >= today);
    const onCount = todayLogs.filter(l => l.action === 'on').length;
    const offCount = todayLogs.filter(l => l.action === 'off').length;

    // Calculate total ON time today
    let totalOnMs = 0;
    const sortedToday = [...todayLogs].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    let lastOn = null;
    for (const log of sortedToday) {
      if (log.action === 'on') {
        lastOn = new Date(log.timestamp);
      } else if (log.action === 'off' && lastOn) {
        totalOnMs += new Date(log.timestamp) - lastOn;
        lastOn = null;
      }
    }
    if (lastOn) totalOnMs += Date.now() - lastOn;

    res.json({
      logs,
      stats: {
        todayOnCount: onCount,
        todayOffCount: offCount,
        todayOnMinutes: Math.round(totalOnMs / 60000)
      },
      liveState: config?.liveState || 'unknown',
      liveStateAt: config?.liveStateAt || null,
      stuck: config?.stuck || false,
      stuckReason: config?.stuckReason || ''
    });
  } catch (error) {
    console.error('Irrigation log error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// ── Alert Config ──

// @desc    Get alert config for zone
// @route   GET /api/zones/:zoneId/alerts
export const getAlertConfig = async (req, res) => {
  try {
    const { zoneId } = req.params;
    const ALL_METRICS = [
      { metric: 'temperature', enabled: false, min: 18, max: 32, cooldownMin: 30 },
      { metric: 'humidity', enabled: false, min: 40, max: 80, cooldownMin: 30 },
      { metric: 'co2', enabled: false, min: null, max: 1500, cooldownMin: 30 },
      { metric: 'light', enabled: false, min: null, max: null, cooldownMin: 30 },
      { metric: 'vpd', enabled: false, min: 0.4, max: 1.6, cooldownMin: 30 },
      { metric: 'offline', enabled: false, min: null, max: 5, cooldownMin: 30 },
      { metric: 'light_anomaly', enabled: false, min: 6, max: 0, cooldownMin: 30 }
    ];

    let config = await AlertConfig.findOne({ zoneId }).lean();
    if (!config) {
      config = { zoneId, enabled: true, telegramChatId: null, rules: ALL_METRICS };
    } else {
      // Auto-add any new metrics that were added after initial config was saved
      const existing = new Set(config.rules.map(r => r.metric));
      for (const def of ALL_METRICS) {
        if (!existing.has(def.metric)) {
          config.rules.push(def);
        }
      }
    }
    res.json(config);
  } catch (error) {
    console.error('Get alert config error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Update alert config for zone
// @route   PUT /api/zones/:zoneId/alerts
export const updateAlertConfig = async (req, res) => {
  try {
    const { zoneId } = req.params;
    const { enabled, telegramChatId, rules } = req.body;

    const update = {};
    if (enabled !== undefined) update.enabled = enabled;
    if (telegramChatId !== undefined) update.telegramChatId = telegramChatId;
    if (rules) update.rules = rules;

    const config = await AlertConfig.findOneAndUpdate(
      { zoneId },
      { $set: { zoneId, ...update } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();

    res.json(config);
  } catch (error) {
    console.error('Update alert config error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get alert log for zone
// @route   GET /api/zones/:zoneId/alerts/log
export const getAlertLog = async (req, res) => {
  try {
    const { zoneId } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);

    const logs = await AlertLog.find({ zoneId })
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();

    res.json({ logs });
  } catch (error) {
    console.error('Alert log error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Send test Telegram alert
// @route   POST /api/alerts/test
export const testTelegramAlert = async (req, res) => {
  try {
    const { chatId } = req.body;
    const result = await sendTestAlert(chatId);
    res.json(result);
  } catch (error) {
    console.error('Test alert error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Send daily summary now (for testing)
// @route   POST /api/alerts/summary
export const triggerDailySummary = async (req, res) => {
  try {
    const result = await sendDailySummaryNow();
    res.json(result);
  } catch (error) {
    console.error('Daily summary error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};
