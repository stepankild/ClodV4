import mongoose from 'mongoose';

const cloneCutSchema = new mongoose.Schema({
  room: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'FlowerRoom',
    default: null
  },
  cutDate: { type: Date, required: true },
  strains: [{
    strain: { type: String, default: '' },
    quantity: { type: Number, default: 0 }
  }],
  strain: { type: String, default: '' },
  quantity: { type: Number, default: 0 },
  isDone: { type: Boolean, default: false },
  notes: { type: String, default: '' },
  deletedAt: { type: Date, default: null }
}, {
  timestamps: true
});

cloneCutSchema.index({ room: 1 });
cloneCutSchema.index({ deletedAt: 1 });
cloneCutSchema.index({ cutDate: 1 });

const CloneCut = mongoose.model('CloneCut', cloneCutSchema);

// Удалить артефактные unique-индексы, оставшиеся от предыдущих версий
CloneCut.collection.getIndexes().then((indexes) => {
  for (const [name, keys] of Object.entries(indexes)) {
    if (name === '_id_') continue;
    // Mongoose-created indexes already declared above are not unique;
    // drop any stale unique index on 'room' that blocks new documents
    const keyFields = Object.keys(keys);
    const isUnique = name.includes('unique') || false;
    // MongoDB stores index info differently — check via listIndexes instead
  }
  // Simpler: just try to drop any unique room index
  return CloneCut.collection.listIndexes().toArray();
}).then((indexes) => {
  for (const idx of indexes) {
    if (idx.unique && idx.key && idx.key.room !== undefined && idx.name !== '_id_') {
      console.log(`[CloneCut] Dropping stale unique index: ${idx.name}`);
      CloneCut.collection.dropIndex(idx.name).catch(() => {});
    }
  }
}).catch(() => {});

export default CloneCut;
