import mongoose from 'mongoose';

const harvestSessionSchema = new mongoose.Schema({
  room: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'FlowerRoom',
    required: true
  },
  roomNumber: { type: Number, required: true },
  roomName: { type: String, required: true },
  cycleName: { type: String, default: '' },
  strain: { type: String, default: '' },
  plantsCount: { type: Number, required: true }, // ожидаемое количество кустов
  startedAt: { type: Date, default: Date.now },
  completedAt: { type: Date, default: null },
  status: {
    type: String,
    enum: ['in_progress', 'completed'],
    default: 'in_progress'
  },
  plants: [{
    plantNumber: { type: Number, required: true },
    wetWeight: { type: Number, required: true }, // граммы
    recordedAt: { type: Date, default: Date.now },
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    errorNote: { type: String, default: '' } // пометка об ошибке (удалять нельзя)
  }]
}, { timestamps: true });

harvestSessionSchema.index({ room: 1, status: 1 });
harvestSessionSchema.index({ status: 1, startedAt: -1 });

const HarvestSession = mongoose.model('HarvestSession', harvestSessionSchema);
export default HarvestSession;
