import mongoose from 'mongoose';

const plannedCycleSchema = new mongoose.Schema({
  room: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'FlowerRoom',
    required: true
  },
  cycleName: { type: String, trim: true, default: '' },
  strain: { type: String, trim: true, default: '' },
  plannedStartDate: { type: Date, default: null },
  plantsCount: { type: Number, default: 0, min: 0 },
  floweringDays: { type: Number, default: 56, min: 1 },
  notes: { type: String, default: '' }
}, { timestamps: true });

plannedCycleSchema.index({ room: 1 }, { unique: true });

const PlannedCycle = mongoose.model('PlannedCycle', plannedCycleSchema);
export default PlannedCycle;
