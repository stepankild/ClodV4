import mongoose from 'mongoose';

const protocolEntrySchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TreatmentProduct',
    required: true
  },
  intervalDays: { type: Number, required: true, min: 1 },
  dosage: { type: String, default: '' },
  startDay: { type: Number, default: 1 },
  endDay: { type: Number, default: null },
  notes: { type: String, default: '' }
}, { _id: true });

const treatmentProtocolSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  phase: {
    type: String,
    enum: ['veg', 'flower'],
    required: true
  },
  isDefault: { type: Boolean, default: false },
  entries: [protocolEntrySchema],
  notes: { type: String, default: '' },
  deletedAt: { type: Date, default: null }
}, { timestamps: true });

treatmentProtocolSchema.index({ phase: 1, isDefault: 1 });
treatmentProtocolSchema.index({ deletedAt: 1 });

const TreatmentProtocol = mongoose.model('TreatmentProtocol', treatmentProtocolSchema);

export default TreatmentProtocol;
