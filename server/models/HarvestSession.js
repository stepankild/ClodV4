import mongoose from 'mongoose';

const harvestSessionSchema = new mongoose.Schema({
  room: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'FlowerRoom',
    required: true
  },
  roomNumber: { type: Number, default: 0 },
  roomName: { type: String, default: '' },
  cycleName: { type: String, default: '' },
  strain: { type: String, default: '' },
  plantsCount: { type: Number, default: 0 },
  status: {
    type: String,
    enum: ['in_progress', 'completed'],
    default: 'in_progress'
  },
  plants: [{
    plantNumber: { type: Number, required: true },
    strain: { type: String, default: '' },
    wetWeight: { type: Number, required: true },
    recordedAt: { type: Date, default: Date.now },
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    errorNote: { type: String, default: '' }
  }],
  startedAt: { type: Date, default: Date.now },
  completedAt: { type: Date, default: null }
}, {
  timestamps: true
});

harvestSessionSchema.index({ room: 1, status: 1 });
harvestSessionSchema.index({ startedAt: -1 });

const HarvestSession = mongoose.model('HarvestSession', harvestSessionSchema);

export default HarvestSession;
