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
  crew: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    role: {
      type: String,
      enum: ['cutting', 'room', 'carrying', 'weighing', 'hooks', 'hanging', 'observer']
    },
    joinedAt: { type: Date, default: Date.now },
    leftAt: { type: Date, default: null }
  }],
  plants: [{
    plantNumber: { type: Number, required: true },
    strain: { type: String, default: '' },
    wetWeight: { type: Number, required: true },
    recordedAt: { type: Date, default: Date.now },
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    errorNote: { type: String, default: '' }
  }],
  startedAt: { type: Date, default: Date.now },
  completedAt: { type: Date, default: null },
  // Данные для инфографики команды (заполняются при завершении)
  distanceToScale: { type: Number, default: null },     // метры (одна сторона)
  potWeight: { type: Number, default: null },            // кг
  branchesPerPlant: { type: Number, default: null },     // среднее кол-во веток с куста
  potsPerTrip: { type: Number, default: null },          // горшков за одну ходку
  plantsPerTrip: { type: Number, default: null }         // кустов за одну ходку
}, {
  timestamps: true
});

harvestSessionSchema.index({ room: 1, status: 1 });
harvestSessionSchema.index({ startedAt: -1 });

const HarvestSession = mongoose.model('HarvestSession', harvestSessionSchema);

export default HarvestSession;
