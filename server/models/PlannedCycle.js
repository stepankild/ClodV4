import mongoose from 'mongoose';

const plannedCycleSchema = new mongoose.Schema({
  room: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'FlowerRoom',
    required: true
  },
  cycleName: { type: String, default: '' },
  // Legacy single-strain fields (kept for backward compat with Overview/Clones)
  strain: { type: String, default: '' },
  plantsCount: { type: Number, default: 0 },
  // Multi-strain layout: one entry per strain in this cycle
  strains: [{
    strain: { type: String, default: '' },
    quantity: { type: Number, default: 0 }
  }],
  plannedStartDate: { type: Date, default: null },
  floweringDays: { type: Number, default: 56 },
  // How many days before the PREVIOUS cycle's end to cut clones for this one
  cutLeadDays: { type: Number, default: 28 },
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
