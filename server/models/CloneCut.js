import mongoose from 'mongoose';

const cloneCutSchema = new mongoose.Schema({
  room: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'FlowerRoom',
    required: true,
    unique: true
  },
  cutDate: { type: Date, required: true },
  strain: { type: String, trim: true, default: '' },
  quantity: { type: Number, default: 0, min: 0 },
  strains: [{
    strain: { type: String, trim: true, default: '' },
    quantity: { type: Number, default: 0, min: 0 }
  }], // default [] if not set
  isDone: { type: Boolean, default: false },
  notes: { type: String, default: '' }
}, { timestamps: true });

cloneCutSchema.index({ room: 1 }, { unique: true });
cloneCutSchema.index({ cutDate: 1 });

const CloneCut = mongoose.model('CloneCut', cloneCutSchema);
export default CloneCut;
