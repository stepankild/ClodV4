import Zone from '../models/Zone.js';
import SensorReading from '../models/SensorReading.js';
import HumidifierLog from '../models/HumidifierLog.js';
import { getZoneStates, getZoneState } from '../mqtt/index.js';

// @desc    Get all zones with status and latest reading
// @route   GET /api/zones
export const getZones = async (req, res) => {
  try {
    const zones = await Zone.find().sort({ zoneId: 1 }).lean();
    const states = getZoneStates();

    // Attach live status and last reading to each zone
    const result = await Promise.all(zones.map(async (zone) => {
      const live = states[zone.zoneId];
      const lastReading = await SensorReading.findOne({ zoneId: zone.zoneId })
        .sort({ timestamp: -1 }).lean();
      return {
        ...zone,
        piStatus: {
          ...zone.piStatus,
          online: live?.online ?? zone.piStatus?.online ?? false,
          lastSeen: live?.lastSeen ?? zone.piStatus?.lastSeen,
        },
        lastData: live?.lastData ?? lastReading ?? null,
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
    const lastReading = await SensorReading.findOne({ zoneId: zone.zoneId })
      .sort({ timestamp: -1 }).lean();
    zone.lastData = live?.lastData ?? lastReading ?? null;

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
      intervalMinutes = 30; // 30min for >24h
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

      const [scalarReadings, tempReadings] = await Promise.all([
        SensorReading.aggregate(scalarPipeline),
        SensorReading.aggregate(tempPipeline),
      ]);

      // Merge: attach per-sensor temperatures to each scalar bucket
      const tempMap = new Map(tempReadings.map(t => [t._id.getTime(), t.temperatures]));
      const readings = scalarReadings.map(r => ({
        ...r,
        temperatures: tempMap.get(new Date(r.timestamp).getTime()) || [],
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
    const reading = await SensorReading.findOne({ zoneId: req.params.zoneId })
      .sort({ timestamp: -1 })
      .lean();
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
    const lastReading = await SensorReading.findOne({ zoneId })
      .sort({ timestamp: -1 }).lean();
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
      const canopyT = data.temperatures?.find(t => t.location === 'canopy')?.value;
      const airT = data.temperature;
      const rh = data.humidity_sht45 ?? data.humidity;
      if (canopyT != null && airT != null && rh != null) {
        const svpLeaf = 0.6108 * Math.exp(17.27 * canopyT / (canopyT + 237.3));
        const svpAir = 0.6108 * Math.exp(17.27 * airT / (airT + 237.3));
        vpd = Math.max(0, svpLeaf - svpAir * rh / 100);
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
export const getHumidifierLog = async (req, res) => {
  try {
    const { zoneId } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const from = req.query.from ? new Date(req.query.from) : new Date(Date.now() - 7 * 24 * 3600 * 1000);

    const logs = await HumidifierLog.find({ zoneId, timestamp: { $gte: from } })
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();

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
    // If still on, count to now
    if (lastOn) totalOnMs += Date.now() - lastOn;

    res.json({
      logs,
      stats: {
        todayOnCount: onCount,
        todayOffCount: offCount,
        todayOnMinutes: Math.round(totalOnMs / 60000)
      }
    });
  } catch (error) {
    console.error('Humidifier log error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};
