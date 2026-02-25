import mongoose from 'mongoose';

const APPLICATION_METHODS = ['spray', 'drench', 'fogger', 'granular', 'other'];
const TREATMENT_STATUSES = ['planned', 'completed', 'skipped'];

const treatmentRecordSchema = new mongoose.Schema({
  room: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'FlowerRoom',
    required: true
  },
  cycleId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CycleArchive',
    default: null
  },
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TreatmentProduct',
    default: null
  },
  // Денормализованные поля для архива (если продукт удалят)
  productName: { type: String, default: '' },
  productType: { type: String, default: '' },
  dosage: { type: String, default: '' },
  applicationMethod: {
    type: String,
    enum: APPLICATION_METHODS,
    default: 'spray'
  },
  status: {
    type: String,
    enum: TREATMENT_STATUSES,
    default: 'planned'
  },
  scheduledDate: {
    type: Date,
    required: true
  },
  completedAt: { type: Date, default: null },
  completedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  worker: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  notes: { type: String, default: '' },
  dayOfCycle: { type: Number, default: null },
  deletedAt: { type: Date, default: null }
}, {
  timestamps: true
});

// Индексы
treatmentRecordSchema.index({ room: 1, scheduledDate: 1 });
treatmentRecordSchema.index({ scheduledDate: 1, status: 1 });
treatmentRecordSchema.index({ room: 1, cycleId: 1 });
treatmentRecordSchema.index({ product: 1 });
treatmentRecordSchema.index({ deletedAt: 1 });

export const APPLICATION_METHODS_LIST = APPLICATION_METHODS;
export const TREATMENT_STATUSES_LIST = TREATMENT_STATUSES;

const TreatmentRecord = mongoose.model('TreatmentRecord', treatmentRecordSchema);

export default TreatmentRecord;
