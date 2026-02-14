import mongoose from 'mongoose';

const strainSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  deletedAt: { type: Date, default: null }
}, {
  timestamps: true
});

strainSchema.index({ name: 1 }, { unique: true });
strainSchema.index({ deletedAt: 1 });

const Strain = mongoose.model('Strain', strainSchema);

export default Strain;
