import mongoose from 'mongoose';

const vegBatchSchema = new mongoose.Schema({
  name: { type: String, default: '' },
  sourceCloneCut: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CloneCut',
    default: null
  },
  strains: [{
    strain: { type: String, default: '' },
    quantity: { type: Number, default: 0 }
  }],
  strain: { type: String, default: '' },
  quantity: { type: Number, default: 0 },
  cutDate: { type: Date, required: true },
  transplantedToVegAt: { type: Date, required: true },
  vegDaysTarget: { type: Number, default: 21 },
  flowerRoom: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'FlowerRoom',
    default: null
  },
  transplantedToFlowerAt: { type: Date, default: null },
  notes: { type: String, default: '' }
}, {
  timestamps: true
});

vegBatchSchema.index({ flowerRoom: 1 });
vegBatchSchema.index({ transplantedToVegAt: -1 });

const VegBatch = mongoose.model('VegBatch', vegBatchSchema);

export default VegBatch;
