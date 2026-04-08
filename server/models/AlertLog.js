import mongoose from 'mongoose';

const alertLogSchema = new mongoose.Schema({
  zoneId: { type: String, required: true },
  metric: { type: String, required: true },
  type: { type: String, enum: ['alert', 'recovery'], default: 'alert' },
  value: { type: Number, default: null },
  threshold: { type: String, default: null }, // e.g. ">32" or "<18"
  message: { type: String, required: true },
  timestamp: { type: Date, default: Date.now }
});

alertLogSchema.index({ zoneId: 1, timestamp: -1 });
alertLogSchema.index({ timestamp: 1 }, { expireAfterSeconds: 90 * 24 * 3600 }); // 90 days TTL

export default mongoose.model('AlertLog', alertLogSchema);
