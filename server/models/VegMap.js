import mongoose from 'mongoose';

const vegMapSchema = new mongoose.Schema({
  // Новая структура: ряды → столы → растения
  vegRows: [{
    name: { type: String, default: '' },
    tablesCount: { type: Number, default: 8, min: 1 },
    plantsPerTable: { type: Number, default: 54, min: 1 },
    tableCols: { type: Number, default: 4, min: 1 },
    tableGapAfterCol: { type: Number, default: 2 } // 0 = нет разрыва
  }],
  // Старая структура для обратной совместимости (не удаляем)
  customRows: [{
    name: { type: String, default: '' },
    cols: { type: Number, default: 4, min: 1 },
    rows: { type: Number, default: 1, min: 1 },
    fillDirection: { type: String, enum: ['topDown', 'bottomUp'], default: 'topDown' }
  }],
  batchPositions: [{
    row: { type: Number, required: true },      // flat table index (0-based)
    position: { type: Number, required: true },  // position within table (0-based)
    batchId: { type: mongoose.Schema.Types.ObjectId, ref: 'VegBatch', required: true }
  }],
  fillDirection: { type: String, enum: ['topDown', 'bottomUp'], default: 'topDown' }
}, {
  timestamps: true
});

const VegMap = mongoose.model('VegMap', vegMapSchema);

export default VegMap;
