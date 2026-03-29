import mongoose from 'mongoose';

const humidifierLogSchema = new mongoose.Schema({
  zoneId: { type: String, required: true },
  action: { type: String, enum: ['on', 'off'], required: true },
  trigger: { type: String, default: 'auto' }, // auto, manual, api
  humidity: { type: Number, default: null },   // RH at time of action
  timestamp: { type: Date, default: Date.now }
});

humidifierLogSchema.index({ zoneId: 1, timestamp: -1 });
humidifierLogSchema.index({ timestamp: 1 }, { expireAfterSeconds: 90 * 24 * 3600 }); // 90 days TTL

export default mongoose.model('HumidifierLog', humidifierLogSchema);
