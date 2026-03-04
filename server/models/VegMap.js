import mongoose from 'mongoose';

const vegMapSchema = new mongoose.Schema({
  customRows: [{
    name: { type: String, default: '' },
    cols: { type: Number, default: 4, min: 1 },
    rows: { type: Number, default: 1, min: 1 },
    fillDirection: { type: String, enum: ['topDown', 'bottomUp'], default: 'topDown' }
  }],
  batchPositions: [{
    row: { type: Number, required: true },
    position: { type: Number, required: true },
    batchId: { type: mongoose.Schema.Types.ObjectId, ref: 'VegBatch', required: true }
  }],
  fillDirection: { type: String, enum: ['topDown', 'bottomUp'], default: 'topDown' }
}, {
  timestamps: true
});

const VegMap = mongoose.model('VegMap', vegMapSchema);

export default VegMap;
