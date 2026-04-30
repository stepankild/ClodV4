import mongoose from 'mongoose';

const sensorReadingSchema = new mongoose.Schema({
  zoneId: { type: String, required: true },
  timestamp: { type: Date, required: true, default: Date.now },
  temperatures: [{
    sensorId: { type: String },
    location: { type: String },
    value: { type: Number }
  }],
  humidityReadings: [{
    sensorId: { type: String },
    location: { type: String },
    value: { type: Number }
  }],
  humidity: { type: Number, default: null },
  humidity_sht45: { type: Number, default: null },
  temperature: { type: Number, default: null },
  co2: { type: Number, default: null },
  light: { type: Number, default: null },
  humidifierState: { type: String, default: null },
  // Raspberry Pi self-health (reported by sensor_node.py)
  // pi_throttled: raw bitfield from `vcgencmd get_throttled` — 0 = clean,
  // bits 0-3 = currently happening, bits 16-19 = happened since boot.
  pi_temp: { type: Number, default: null },
  pi_throttled: { type: Number, default: null },
  pi_load: { type: Number, default: null }
}, {
  timestamps: false
});

sensorReadingSchema.index({ zoneId: 1, timestamp: -1 });
sensorReadingSchema.index({ timestamp: 1 }, { expireAfterSeconds: 90 * 24 * 3600 }); // 90 days TTL

export default mongoose.model('SensorReading', sensorReadingSchema);
