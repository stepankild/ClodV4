import mongoose from 'mongoose';

const PRODUCT_TYPES = ['insecticide', 'fungicide', 'acaricide', 'bio', 'fertilizer', 'ph_adjuster', 'other'];


const treatmentProductSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  type: {
    type: String,
    enum: PRODUCT_TYPES,
    default: 'other'
  },
  activeIngredient: { type: String, default: '' },
  concentration: { type: String, default: '' },
  targetPests: [{ type: String, trim: true }],
  safetyIntervalDays: { type: Number, default: null },
  instructions: { type: String, default: '' },
  notes: { type: String, default: '' },
  deletedAt: { type: Date, default: null }
}, {
  timestamps: true
});

treatmentProductSchema.index({ name: 1 }, { unique: true });
treatmentProductSchema.index({ deletedAt: 1 });
treatmentProductSchema.index({ type: 1 });

export const PRODUCT_TYPES_LIST = PRODUCT_TYPES;

const TreatmentProduct = mongoose.model('TreatmentProduct', treatmentProductSchema);

export default TreatmentProduct;
