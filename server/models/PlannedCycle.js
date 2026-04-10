import mongoose from 'mongoose';

const plannedCycleSchema = new mongoose.Schema({
  room: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'FlowerRoom',
    required: true
  },
  cycleName: { type: String, default: '' },
  strain: { type: String, default: '' },
  plannedStartDate: { type: Date, default: null },
  plantsCount: { type: Number, default: 0 },
  floweringDays: { type: Number, default: 56 },
  // Queue position within a room: 0 = next cycle, 1 = the one after, ...
  order: { type: Number, default: 0, index: true },
  notes: { type: String, default: '' },
  deletedAt: { type: Date, default: null }
}, {
  timestamps: true
});

plannedCycleSchema.index({ room: 1, order: 1 });
plannedCycleSchema.index({ deletedAt: 1 });

const PlannedCycle = mongoose.model('PlannedCycle', plannedCycleSchema);

export default PlannedCycle;
