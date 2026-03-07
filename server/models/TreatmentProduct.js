import mongoose from 'mongoose';

const treatmentProductSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  type: {
    type: String,
    enum: ['chemical', 'biological'],
    required: true
  },
  description: { type: String, default: '' },
  defaultDosage: { type: String, default: '' },
  applicationMethod: {
    type: String,
    enum: ['spray', 'soil_drench', 'release', 'other'],
    default: 'spray'
  },
  notes: { type: String, default: '' },
  isActive: { type: Boolean, default: true },
  deletedAt: { type: Date, default: null }
}, { timestamps: true });

treatmentProductSchema.index({ type: 1 });
treatmentProductSchema.index({ deletedAt: 1 });

const TreatmentProduct = mongoose.model('TreatmentProduct', treatmentProductSchema);

export default TreatmentProduct;
