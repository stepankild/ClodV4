import mongoose from 'mongoose';

const motherPlantSchema = new mongoose.Schema({
  name: { type: String, required: true },
  strain: { type: String, default: '' },
  plantedDate: { type: Date, required: true },
  lastPruneDate: { type: Date, default: null },
  pruneHistory: [{
    date: { type: Date, required: true },
    notes: { type: String, default: '' }
  }],
  health: {
    type: String,
    enum: ['excellent', 'good', 'satisfactory', 'poor', 'critical'],
    default: 'good'
  },
  notes: { type: String, default: '' },
  retiredAt: { type: Date, default: null },
  retiredReason: { type: String, default: '' },
  deletedAt: { type: Date, default: null }
}, {
  timestamps: true
});

motherPlantSchema.index({ deletedAt: 1 });
motherPlantSchema.index({ retiredAt: 1 });
motherPlantSchema.index({ strain: 1 });

const MotherPlant = mongoose.model('MotherPlant', motherPlantSchema);

export default MotherPlant;
