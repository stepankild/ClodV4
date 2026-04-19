import mongoose from 'mongoose';

const irrigationLogSchema = new mongoose.Schema({
  zoneId: { type: String, required: true },
  // 'failure' is used for events where a command or reconciliation didn't
  // succeed (HA unreachable, pump didn't turn on after retries, schedule
  // tick missed because Railway was restarting, etc.). 'miss' for when a
  // scheduled time passed without any ON fire at all.
  action: { type: String, enum: ['on', 'off', 'failure', 'miss'], required: true },
  trigger: { type: String, default: 'manual' },    // schedule, manual, api, external, system
  scheduleTime: { type: String, default: null },    // which schedule triggered it (HH:MM)
  duration: { type: Number, default: null },         // planned duration in minutes
  // For ON entries: when the pump should be turned off. Used by the scheduler
  // tick to reconcile missed off-events (e.g. after a server restart wiped
  // the in-memory setTimeout). Null on manual events and on OFF entries.
  expectedOffAt: { type: Date, default: null },
  // Human-readable notes (failure reasons, reconciliation context, etc.)
  notes: { type: String, default: null },
  timestamp: { type: Date, default: Date.now }
});

irrigationLogSchema.index({ zoneId: 1, timestamp: -1 });
irrigationLogSchema.index({ timestamp: 1 }, { expireAfterSeconds: 90 * 24 * 3600 }); // 90 days TTL

export default mongoose.model('IrrigationLog', irrigationLogSchema);
