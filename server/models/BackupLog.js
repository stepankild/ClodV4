import mongoose from 'mongoose';

// Логи запусков локальных бэкап-скриптов (PowerShell на ноуте админа).
// Заполняется двумя способами:
//   1. PS-скрипты сами шлют отчёт в /api/backups/report при завершении (scheduled runs)
//   2. Агент на ноуте создаёт запись при получении ручного запроса и апдейтит её
//      после того как дочерний PS-процесс завершился
//
// Append-only с точки зрения UI: смотрим, не удаляем.

const backupLogSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['weekly', 'monthly', 'manual-weekly', 'manual-monthly'],
    required: true,
  },
  status: {
    type: String,
    enum: ['pending', 'running', 'ok', 'failed'],
    default: 'pending',
    index: true,
  },
  startedAt: { type: Date, default: Date.now, index: true },
  finishedAt: Date,
  durationSec: Number,
  sizeMB: Number,
  gitSha: String,
  gitBranch: String,
  host: String,
  // Кто инициировал. Для scheduled runs — строка 'schedule'. Для ручных из UI — User._id.
  triggeredBy: { type: mongoose.Schema.Types.Mixed },
  triggeredByName: String,
  warnings: [String],
  sections: { type: mongoose.Schema.Types.Mixed }, // { code: '2.6 MB', 'db-dump': '0.01 MB', ... }
  errorMessage: String,
  manifestText: String, // полный MANIFEST.txt, опционально
}, { timestamps: true });

backupLogSchema.index({ startedAt: -1 });

export default mongoose.model('BackupLog', backupLogSchema);
