import mongoose from 'mongoose';

const trimLogSchema = new mongoose.Schema({
  archive: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CycleArchive',
    required: true
  },
  room: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'FlowerRoom',
    required: true
  },
  roomName: {
    type: String,
    default: ''
  },
  strain: {
    type: String,
    default: ''
  },
  weight: {
    type: Number,
    required: true,
    min: 0
  },
  date: {
    type: Date,
    required: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  deletedAt: { type: Date, default: null }
}, {
  timestamps: true
});

trimLogSchema.index({ archive: 1, date: -1 });
trimLogSchema.index({ deletedAt: 1 });

const TrimLog = mongoose.model('TrimLog', trimLogSchema);

export default TrimLog;
