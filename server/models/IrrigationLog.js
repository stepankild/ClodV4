import mongoose from 'mongoose';

const irrigationLogSchema = new mongoose.Schema({
  zoneId: { type: String, required: true },
  action: { type: String, enum: ['on', 'off'], required: true },
  trigger: { type: String, default: 'manual' },    // schedule, manual, api
  scheduleTime: { type: String, default: null },    // which schedule triggered it (HH:MM)
  duration: { type: Number, default: null },         // planned duration in minutes
  // For ON entries: when the pump should be turned off. Used by the scheduler
  // tick to reconcile missed off-events (e.g. after a server restart wiped
  // the in-memory setTimeout). Null on manual events and on OFF entries.
  expectedOffAt: { type: Date, default: null },
  timestamp: { type: Date, default: Date.now }
});

irrigationLogSchema.index({ zoneId: 1, timestamp: -1 });
irrigationLogSchema.index({ timestamp: 1 }, { expireAfterSeconds: 90 * 24 * 3600 }); // 90 days TTL

export default mongoose.model('IrrigationLog', irrigationLogSchema);
