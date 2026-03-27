import express from 'express';
import SensorReading from '../models/SensorReading.js';
import Zone from '../models/Zone.js';

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
        sensorUpdates.push({ type: 'stcc4', sensorId: 'stcc4', location: 'co2', enabled: true });
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

export default router;
