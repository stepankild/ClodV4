import Zone from '../models/Zone.js';
import SensorReading from '../models/SensorReading.js';
import { getZoneStates, getZoneState } from '../mqtt/index.js';

// @desc    Get all zones with status and latest reading
// @route   GET /api/zones
export const getZones = async (req, res) => {
  try {
    const zones = await Zone.find().sort({ zoneId: 1 }).lean();
    const states = getZoneStates();

    // Attach live status and last data to each zone
    const result = zones.map(zone => {
      const live = states[zone.zoneId];
      return {
        ...zone,
        piStatus: {
          ...zone.piStatus,
          online: live?.online ?? zone.piStatus?.online ?? false,
          lastSeen: live?.lastSeen ?? zone.piStatus?.lastSeen,
        },
        lastData: live?.lastData ?? null,
      };
    });

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
    zone.lastData = live?.lastData ?? null;

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
      // Aggregated query
      const pipeline = [
        { $match: match },
        { $sort: { timestamp: 1 } },
        {
          $group: {
            _id: {
              $toDate: {
                $subtract: [
                  { $toLong: '$timestamp' },
                  { $mod: [{ $toLong: '$timestamp' }, intervalMinutes * 60 * 1000] }
                ]
              }
            },
            temperature: { $avg: '$temperature' },
            humidity: { $avg: '$humidity' },
            co2: { $avg: '$co2' },
            light: { $avg: '$light' },
            temperatures: { $first: '$temperatures' },
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
            co2: { $round: ['$co2', 0] },
            light: { $round: ['$light', 0] },
            temperatures: 1,
            count: 1,
          }
        }
      ];
      const readings = await SensorReading.aggregate(pipeline);
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
