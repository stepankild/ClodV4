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
  }]
}, { timestamps: true });

export default mongoose.model('IrrigationSchedule', irrigationScheduleSchema);
