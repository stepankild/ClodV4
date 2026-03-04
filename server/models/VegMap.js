import mongoose from 'mongoose';

const vegMapSchema = new mongoose.Schema({
  // Структура: ряды → столы → растения
  // Ряд = вертикальная колонка столов (столы друг под другом)
  // Стол = сетка tableCols × tableRows, с возможными пропусками (deadSpots)
  vegRows: [{
    name: { type: String, default: '' },
    tablesCount: { type: Number, default: 8, min: 1 },
    plantsPerTable: { type: Number, default: 54, min: 1 },
    tableCols: { type: Number, default: 5, min: 1 },
    tableRows: { type: Number, default: 11, min: 1 },
    // Мёртвые зоны (слив и т.д.) — позиции где нельзя поставить горшок
    // Формат: [row*cols+col, ...] — индексы позиций в сетке
    deadSpots: [{ type: Number }]
  }],
  // Старая структура для обратной совместимости
  customRows: [{
    name: { type: String, default: '' },
    cols: { type: Number, default: 4, min: 1 },
    rows: { type: Number, default: 1, min: 1 },
    fillDirection: { type: String, enum: ['topDown', 'bottomUp'], default: 'topDown' }
  }],
  batchPositions: [{
    row: { type: Number, required: true },      // flat table index (0-based)
    position: { type: Number, required: true },  // position within table (0-based, skipping dead spots)
    batchId: { type: mongoose.Schema.Types.ObjectId, ref: 'VegBatch', required: true }
  }],
  fillDirection: { type: String, enum: ['topDown', 'bottomUp'], default: 'topDown' }
}, {
  timestamps: true
});

const VegMap = mongoose.model('VegMap', vegMapSchema);

export default VegMap;
