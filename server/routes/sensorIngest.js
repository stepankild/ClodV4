import express from 'express';
import SensorReading from '../models/SensorReading.js';
import Zone from '../models/Zone.js';
import HumidifierLog from '../models/HumidifierLog.js';
import { setZoneOnlineFromHttp, setZigbeeData, getZigbeeDevices } from '../mqtt/index.js';

const router = express.Router();

// API key middleware — no JWT needed, for Pi/bridge daemon
function requireApiKey(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key || key !== process.env.SENSOR_API_KEY) {
    return res.status(401).json({ message: 'Invalid API key' });
  }
  next();
}

// POST /api/sensor-data — receive sensor readings from mqtt_bridge
// Accepts single reading or batch
router.post('/', requireApiKey, async (req, res) => {
  try {
    const readings = Array.isArray(req.body) ? req.body : [req.body];
    const io = req.app.get('io');
    const saved = [];

    for (const data of readings) {
      if (!data.zoneId) continue;

      // Handle Zigbee sensor data (propagators etc.)
      // zigbee_sensors: [{device, location, temperature, humidity, battery}]
      if (data.zigbee_sensors?.length) {
        for (const zs of data.zigbee_sensors) {
          if (zs.temperature == null && zs.humidity == null) continue;

          // Store in memory for live display
          setZigbeeData(data.zoneId, zs.device, {
            location: zs.location || zs.device,
            temperature: zs.temperature,
            humidity: zs.humidity,
            battery: zs.battery,
          });

          // Save to SensorReading for chart history
          const sensorId = `zigbee-${zs.device}`;
          await SensorReading.create({
            zoneId: data.zoneId,
            timestamp: new Date(),
            temperatures: zs.temperature != null ? [{
              sensorId,
              location: zs.location || zs.device,
              value: zs.temperature
            }] : [],
          });

          // Broadcast to browsers
          if (io) {
            io.emit('sensor:zigbee', {
              zoneId: data.zoneId,
              device: zs.device,
              location: zs.location || zs.device,
              temperature: zs.temperature,
              humidity: zs.humidity,
              battery: zs.battery,
              timestamp: new Date().toISOString(),
            });
          }

          console.log(`[zigbee] ${zs.device}: T=${zs.temperature}°C RH=${zs.humidity}%`);
        }
        continue;
      }

      const reading = await SensorReading.create({
        zoneId: data.zoneId,
        timestamp: data.timestamp || new Date(),
        temperatures: data.temperatures || [],
        humidity: data.humidity ?? null,
        humidity_sht45: data.humidity_sht45 ?? null,
        temperature: data.temperature ?? null,
        co2: data.co2 ?? null,
        light: data.light ?? null,
        humidifierState: data.humidifierState ?? null,
      });

      // Log humidifier state changes
      if (data.humidifierState && (data.humidifierState === 'on' || data.humidifierState === 'off')) {
        // Check if this is a state change (different from last log)
        const lastLog = await HumidifierLog.findOne({ zoneId: data.zoneId }).sort({ timestamp: -1 });
        if (!lastLog || lastLog.action !== data.humidifierState) {
          await HumidifierLog.create({
            zoneId: data.zoneId,
            action: data.humidifierState,
            trigger: 'auto',
            humidity: data.humidity ?? data.humidity_sht45 ?? null
          });
        }
      }

      // Update zone status + auto-register new sensors
      const sensorUpdates = [];
      if (data.temperatures?.length) {
        for (const t of data.temperatures) {
          sensorUpdates.push({
            type: t.sensorId === 'sht45' ? 'sht45' : 'ds18b20',
            sensorId: t.sensorId,
            location: t.location || 'unknown',
            enabled: true,
          });
        }
      }
      if (data.co2 != null) {
        // Don't auto-register CO2 sensor — it's already registered during zone setup
        // (avoids stcc4/scd41 confusion on auto-detect)
      }
      if (data.light != null) {
        sensorUpdates.push({ type: 'bh1750', sensorId: 'bh1750', location: 'light', enabled: true });
      }

      // Add sensors that don't already exist in zone.sensors
      if (sensorUpdates.length) {
        const zone = await Zone.findOne({ zoneId: data.zoneId });
        if (zone) {
          const existingIds = new Set(zone.sensors.map(s => s.sensorId));
          const newSensors = sensorUpdates.filter(s => !existingIds.has(s.sensorId));
          if (newSensors.length) {
            await Zone.updateOne(
              { zoneId: data.zoneId },
              {
                $push: { sensors: { $each: newSensors } },
                $set: { 'piStatus.online': true, 'piStatus.lastSeen': new Date() },
              }
            );
          } else {
            await Zone.updateOne(
              { zoneId: data.zoneId },
              { $set: { 'piStatus.online': true, 'piStatus.lastSeen': new Date() } }
            );
          }
        }
      } else {
        await Zone.updateOne(
          { zoneId: data.zoneId },
          { $set: { 'piStatus.online': true, 'piStatus.lastSeen': new Date() } }
        );
      }

      // Update in-memory zone state (so getZones works even without MQTT)
      setZoneOnlineFromHttp(data.zoneId, data);

      // Broadcast to browsers via Socket.io
      if (io) {
        io.emit('sensor:data', {
          zoneId: data.zoneId,
          timestamp: reading.timestamp,
          temperatures: data.temperatures,
          humidity: data.humidity,
          humidity_sht45: data.humidity_sht45,
          temperature: data.temperature,
          co2: data.co2,
          light: data.light,
        });
      }

      saved.push(reading._id);
    }

    res.status(201).json({ saved: saved.length });
  } catch (error) {
    console.error('Sensor ingest error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/sensor-data/status — zone online/offline
router.post('/status', requireApiKey, async (req, res) => {
  try {
    const { zoneId, online } = req.body;
    if (!zoneId) return res.status(400).json({ message: 'zoneId required' });

    await Zone.updateOne(
      { zoneId },
      { $set: { 'piStatus.online': !!online, 'piStatus.lastSeen': new Date() } }
    );

    const io = req.app.get('io');
    if (io) {
      io.emit('sensor:status', { zoneId, online: !!online });
    }

    res.json({ ok: true });
  } catch (error) {
    console.error('Sensor status error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/sensor-data/display/:zoneId — compact data for e-ink display (API key auth)
router.get('/display/:zoneId', requireApiKey, async (req, res) => {
  try {
    const { zoneId } = req.params;
    const zone = await Zone.findOne({ zoneId }).lean();
    if (!zone) return res.status(404).json({ message: 'Zone not found' });

    const lastReading = await SensorReading.findOne({ zoneId })
      .sort({ timestamp: -1 }).lean();
    if (!lastReading) return res.json({ zone: zone.name, online: false });

    // Light cycle from last 24h
    const since24h = new Date(Date.now() - 24 * 3600 * 1000);
    const [dayCount, totalCount] = await Promise.all([
      SensorReading.countDocuments({ zoneId, timestamp: { $gte: since24h }, light: { $gt: 50 } }),
      SensorReading.countDocuments({ zoneId, timestamp: { $gte: since24h }, light: { $ne: null } }),
    ]);
    const dayH = totalCount > 0 ? Math.round((dayCount / totalCount) * 240) / 10 : null;

    // VPD
    let vpd = null;
    const canopyT = lastReading.temperatures?.find(t => t.location === 'canopy')?.value;
    const airT = lastReading.temperature;
    const rh = lastReading.humidity_sht45 ?? lastReading.humidity;
    if (canopyT != null && airT != null && rh != null) {
      const svpL = 0.6108 * Math.exp(17.27 * canopyT / (canopyT + 237.3));
      const svpA = 0.6108 * Math.exp(17.27 * airT / (airT + 237.3));
      vpd = Math.round(Math.max(0, svpL - svpA * rh / 100) * 100) / 100;
    }

    // Sparkline history: last 24h, ~48 points (every 30 min)
    const since24hHist = new Date(Date.now() - 24 * 3600 * 1000);
    const bucketMs = 30 * 60 * 1000; // 30 min buckets
    const histPipeline = [
      { $match: { zoneId, timestamp: { $gte: since24hHist } } },
      { $sort: { timestamp: 1 } },
      { $group: {
        _id: { $toDate: { $subtract: [{ $toLong: '$timestamp' }, { $mod: [{ $toLong: '$timestamp' }, bucketMs] }] } },
        t: { $avg: '$temperature' },
        rh: { $avg: { $ifNull: ['$humidity_sht45', '$humidity'] } },
        co2: { $avg: '$co2' },
      }},
      { $sort: { _id: 1 } },
      { $project: { _id: 0, t: { $round: ['$t', 1] }, rh: { $round: ['$rh', 0] }, co2: { $round: ['$co2', 0] } } },
    ];
    const hist = await SensorReading.aggregate(histPipeline);

    // Also get canopy temps for VPD sparkline
    const canopyPipeline = [
      { $match: { zoneId, timestamp: { $gte: since24hHist } } },
      { $unwind: '$temperatures' },
      { $match: { 'temperatures.location': 'canopy' } },
      { $group: {
        _id: { $toDate: { $subtract: [{ $toLong: '$timestamp' }, { $mod: [{ $toLong: '$timestamp' }, bucketMs] }] } },
        ct: { $avg: '$temperatures.value' },
      }},
      { $sort: { _id: 1 } },
      { $project: { _id: 0, ct: { $round: ['$ct', 1] } } },
    ];
    const canopyHist = await SensorReading.aggregate(canopyPipeline);

    res.json({
      zone: zone.name,
      online: true,
      ts: lastReading.timestamp,
      temps: (lastReading.temperatures || []).map(t => ({
        loc: t.location || '', v: Math.round(t.value * 10) / 10,
      })),
      airT: lastReading.temperature != null ? Math.round(lastReading.temperature * 10) / 10 : null,
      rh: lastReading.humidity != null ? Math.round(lastReading.humidity * 10) / 10 : null,
      rh2: lastReading.humidity_sht45 != null ? Math.round(lastReading.humidity_sht45 * 10) / 10 : null,
      co2: lastReading.co2 != null ? Math.round(lastReading.co2) : null,
      lux: lastReading.light != null ? Math.round(lastReading.light) : null,
      vpd,
      photo: dayH != null ? { day: dayH, night: Math.round((24 - dayH) * 10) / 10 } : null,
      // Sparkline arrays (last 6h, ~30 points)
      hist: hist.map(h => ({ t: h.t, rh: h.rh, co2: h.co2 })),
      canopyHist: canopyHist.map(h => h.ct),
      // Zigbee devices (propagators etc.) — in-memory + persisted
      propagators: await (async () => {
        const all = { ...(zone.zigbeeDevices || {}), ...getZigbeeDevices(zoneId) };
        const names = Object.keys(all);
        if (!names.length) return [];
        // Compute today's min/max for each propagator from SensorReading
        const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
        const minMaxPipeline = [
          { $match: { zoneId, timestamp: { $gte: startOfDay } } },
          { $unwind: '$temperatures' },
          { $match: { 'temperatures.sensorId': { $in: names.map(n => `zigbee-${n}`) } } },
          { $group: {
            _id: '$temperatures.sensorId',
            tMin: { $min: '$temperatures.value' },
            tMax: { $max: '$temperatures.value' },
          }},
        ];
        const stats = await SensorReading.aggregate(minMaxPipeline);
        const statMap = {};
        for (const s of stats) statMap[s._id] = s;
        return names.map(name => {
          const d = all[name];
          const sid = `zigbee-${name}`;
          const s = statMap[sid];
          return {
            name,
            loc: d.location || name,
            t: d.temperature != null ? Math.round(d.temperature * 10) / 10 : null,
            rh: d.humidity != null ? Math.round(d.humidity * 10) / 10 : null,
            bat: d.battery ?? null,
            tMin: s?.tMin != null ? Math.round(s.tMin * 10) / 10 : null,
            tMax: s?.tMax != null ? Math.round(s.tMax * 10) / 10 : null,
          };
        });
      })(),
    });
  } catch (error) {
    console.error('Display data error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/sensor-data/zone-config/:zoneId — zone config for humidity controller
router.get('/zone-config/:zoneId', requireApiKey, async (req, res) => {
  try {
    const zone = await Zone.findOne({ zoneId: req.params.zoneId }).lean();
    if (!zone) return res.status(404).json({ message: 'Zone not found' });
    res.json({ config: zone.config });
  } catch (error) {
    console.error('Zone config error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
