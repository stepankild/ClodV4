import mongoose from 'mongoose';

const scheduledTreatmentSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TreatmentProduct',
    required: true
  },
  intervalDays: { type: Number, required: true, min: 1 },
  dosage: { type: String, default: '' },
  startDay: { type: Number, default: 1 },
  endDay: { type: Number, default: null },
  notes: { type: String, default: '' },
  isActive: { type: Boolean, default: true }
}, { _id: true });

const completionSchema = new mongoose.Schema({
  entryId: { type: mongoose.Schema.Types.ObjectId, required: true },
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'TreatmentProduct' },
  dayOfCycle: { type: Number, required: true },
  completedAt: { type: Date, default: () => new Date() },
  completedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  taskId: { type: mongoose.Schema.Types.ObjectId, ref: 'RoomTask', default: null },
  notes: { type: String, default: '' }
}, { _id: true });

const roomTreatmentScheduleSchema = new mongoose.Schema({
  targetType: {
    type: String,
    enum: ['FlowerRoom', 'VegBatch'],
    required: true
  },
  targetId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  cycleId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null
  },
  sourceProtocol: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TreatmentProtocol',
    default: null
  },
  entries: [scheduledTreatmentSchema],
  completions: [completionSchema],
  isActive: { type: Boolean, default: true },
  deletedAt: { type: Date, default: null }
}, { timestamps: true });

roomTreatmentScheduleSchema.index({ targetType: 1, targetId: 1, isActive: 1 });
roomTreatmentScheduleSchema.index({ cycleId: 1 });
roomTreatmentScheduleSchema.index({ deletedAt: 1 });

const RoomTreatmentSchedule = mongoose.model('RoomTreatmentSchedule', roomTreatmentScheduleSchema);

export default RoomTreatmentSchedule;
