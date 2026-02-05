import mongoose from 'mongoose';

const developmentLogEntrySchema = new mongoose.Schema({
  date: { type: Date, required: true },
  text: { type: String, default: '' }
}, { _id: false });

const ratingSchema = new mongoose.Schema({
  criterion: { type: String, trim: true, default: '' },
  score: { type: Number, min: 0, max: 10, default: 0 }
}, { _id: false });

const selectionBatchSchema = new mongoose.Schema({
  name: { type: String, trim: true, required: true },
  strain: { type: String, trim: true, default: '' },
  startedAt: { type: Date, default: null },
  notes: { type: String, default: '' },
  firstCloneCutAt: { type: Date, default: null },
  developmentLog: {
    type: [developmentLogEntrySchema],
    default: []
  },
  traitsDescription: { type: String, default: '' },
  ratings: {
    type: [ratingSchema],
    default: []
  },
  status: {
    type: String,
    enum: ['active', 'archived'],
    default: 'active'
  }
}, {
  timestamps: true
});

selectionBatchSchema.index({ status: 1 });
selectionBatchSchema.index({ startedAt: -1 });

const SelectionBatch = mongoose.model('SelectionBatch', selectionBatchSchema);

export default SelectionBatch;
