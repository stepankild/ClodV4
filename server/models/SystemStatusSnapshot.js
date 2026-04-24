import mongoose from 'mongoose';

// Снапшоты здоровья main Pi. Заполняются демоном pi-health-probe,
// который каждые 5 минут шлёт `pi:health` событие по Socket.io.
// Использует TTL-индекс: снимки старше 7 дней удаляются автоматически
// (тот же паттерн что в SensorReading.js и AlertLog.js).
//
// `checks` — произвольная вложенная структура: услуги/сканер/весы/HA/
// tailscale/iptables/piZero/usb/system. Формат стабилен но не жёстко-типизирован,
// чтобы можно было добавлять новые проверки на Pi без миграций в Mongo.

const systemStatusSnapshotSchema = new mongoose.Schema({
  timestamp: { type: Date, required: true, default: Date.now },
  host: { type: String, required: true },       // 'farm' (main Pi hostname)
  durationMs: Number,                           // сколько probe выполнялся
  checks: { type: mongoose.Schema.Types.Mixed, required: true },
  // rawPayload — целиком что прислал probe (для дебага новых чеков)
  rawPayload: mongoose.Schema.Types.Mixed,
}, { timestamps: true });

// TTL: 7 дней хранения. MongoDB удаляет expired docs раз в ~60 сек в фоне.
systemStatusSnapshotSchema.index(
  { timestamp: 1 },
  { expireAfterSeconds: 7 * 24 * 3600 }
);

export default mongoose.model('SystemStatusSnapshot', systemStatusSnapshotSchema);
