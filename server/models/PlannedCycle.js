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

// Drop any legacy unique index on `room` — it was created when only one plan
// per room was allowed. The new schema uses a compound {room, order} index and
// supports multiple planned cycles per room.
PlannedCycle.collection.listIndexes().toArray().then((indexes) => {
  for (const idx of indexes) {
    if (idx.name === '_id_') continue;
    const keys = idx.key || {};
    const keyFields = Object.keys(keys);
    if (idx.unique && keyFields.length === 1 && keyFields[0] === 'room') {
      console.log(`[PlannedCycle] Dropping stale unique index: ${idx.name}`);
      PlannedCycle.collection.dropIndex(idx.name).catch((err) => {
        console.warn(`[PlannedCycle] Failed to drop index ${idx.name}:`, err?.message);
      });
    }
  }
}).catch(() => {});

export default PlannedCycle;
