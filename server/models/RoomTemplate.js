import mongoose from 'mongoose';

const roomTemplateSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  customRows: [{
    name: { type: String, default: '' },
    cols: { type: Number, default: 4, min: 1 },
    rows: { type: Number, default: 1, min: 1 },
    fillDirection: { type: String, enum: ['topDown', 'bottomUp'], default: 'topDown' }
  }],
  deletedAt: { type: Date, default: null }
}, {
  timestamps: true
});

roomTemplateSchema.index({ deletedAt: 1 });

const RoomTemplate = mongoose.model('RoomTemplate', roomTemplateSchema);

export default RoomTemplate;
