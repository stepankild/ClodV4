import mongoose from 'mongoose';

const vegBatchSchema = new mongoose.Schema({
  name: { type: String, trim: true, default: '' },
  // Ссылка на нарезку клонов (опционально)
  sourceCloneCut: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CloneCut',
    default: null
  },
  strain: { type: String, trim: true, default: '' },
  quantity: { type: Number, default: 0, min: 0 },
  strains: [{
    strain: { type: String, trim: true, default: '' },
    quantity: { type: Number, default: 0, min: 0 }
  }], // default [] if not set
  cutDate: { type: Date, required: true },
  transplantedToVegAt: { type: Date, required: true },
  vegDaysTarget: { type: Number, default: 21, min: 1 },
  // Привязка к комнате цветения (когда бэтч отправили в цвет)
  flowerRoom: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'FlowerRoom',
    default: null
  },
  transplantedToFlowerAt: { type: Date, default: null },
  notes: { type: String, default: '' }
}, { timestamps: true });

vegBatchSchema.index({ flowerRoom: 1 });
vegBatchSchema.index({ transplantedToVegAt: -1 });
vegBatchSchema.index({ sourceCloneCut: 1 });

const VegBatch = mongoose.model('VegBatch', vegBatchSchema);
export default VegBatch;
