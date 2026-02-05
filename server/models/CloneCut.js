import mongoose from 'mongoose';

const cloneCutSchema = new mongoose.Schema({
  room: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'FlowerRoom',
    default: null
  },
  cutDate: { type: Date, required: true },
  strains: [{
    strain: { type: String, default: '' },
    quantity: { type: Number, default: 0 }
  }],
  strain: { type: String, default: '' },
  quantity: { type: Number, default: 0 },
  isDone: { type: Boolean, default: false },
  notes: { type: String, default: '' }
}, {
  timestamps: true
});

cloneCutSchema.index({ room: 1 });
cloneCutSchema.index({ cutDate: 1 });

const CloneCut = mongoose.model('CloneCut', cloneCutSchema);

export default CloneCut;
