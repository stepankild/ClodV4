import mongoose from 'mongoose';

const irrigationScheduleSchema = new mongoose.Schema({
  zoneId: { type: String, required: true, unique: true },
  name: { type: String, default: 'Полив' },
  entityId: { type: String, default: 'switch.cuco_v2eur_f6d3_switch' },
  enabled: { type: Boolean, default: true },
  schedules: [{
    time: { type: String, required: true },      // HH:MM format
    duration: { type: Number, required: true },   // minutes
    enabled: { type: Boolean, default: true }
  }],
  // Live state as last observed from Home Assistant. Updated by the scheduler
  // on every tick so the UI can show whether the pump is physically on/off
  // regardless of whether our own commands succeeded.
  liveState: { type: String, enum: ['on', 'off', 'unknown'], default: 'unknown' },
  liveStateAt: { type: Date, default: null },
  // Set when the pump has been running past its scheduled off time and we
  // couldn't reach HA to stop it, or when HA reports the pump on without a
  // matching active schedule. Cleared once the pump is confirmed off.
  stuck: { type: Boolean, default: false },
  stuckReason: { type: String, default: '' }
}, { timestamps: true });

export default mongoose.model('IrrigationSchedule', irrigationScheduleSchema);
