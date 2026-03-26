import mongoose from 'mongoose';

const sensorReadingSchema = new mongoose.Schema({
  zoneId: { type: String, required: true },
  timestamp: { type: Date, required: true, default: Date.now },
  temperatures: [{
    sensorId: { type: String },
    location: { type: String },
    value: { type: Number }
  }],
  humidity: { type: Number, default: null },
  temperature: { type: Number, default: null },
  co2: { type: Number, default: null },
  light: { type: Number, default: null },
  humidifierState: { type: String, default: null }
}, {
  timestamps: false
});

sensorReadingSchema.index({ zoneId: 1, timestamp: -1 });
sensorReadingSchema.index({ timestamp: 1 }, { expireAfterSeconds: 90 * 24 * 3600 }); // 90 days TTL

export default mongoose.model('SensorReading', sensorReadingSchema);
