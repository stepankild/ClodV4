import mongoose from 'mongoose';

const alertRuleSchema = new mongoose.Schema({
  metric: {
    type: String,
    enum: ['temperature', 'humidity', 'co2', 'light', 'vpd', 'offline', 'light_anomaly'],
    required: true
  },
  enabled: { type: Boolean, default: false },
  min: { type: Number, default: null },
  max: { type: Number, default: null },
  cooldownMin: { type: Number, default: 30 }
}, { _id: false });

const alertConfigSchema = new mongoose.Schema({
  zoneId: { type: String, required: true, unique: true },
  enabled: { type: Boolean, default: true },
  telegramChatId: { type: String, default: null }, // falls back to env TELEGRAM_CHAT_ID
  rules: {
    type: [alertRuleSchema],
    default: [
      { metric: 'temperature', enabled: false, min: 18, max: 32, cooldownMin: 30 },
      { metric: 'humidity', enabled: false, min: 40, max: 80, cooldownMin: 30 },
      { metric: 'co2', enabled: false, min: null, max: 1500, cooldownMin: 30 },
      { metric: 'light', enabled: false, min: null, max: null, cooldownMin: 30 },
      { metric: 'vpd', enabled: false, min: 0.4, max: 1.6, cooldownMin: 30 },
      { metric: 'offline', enabled: false, min: null, max: 5, cooldownMin: 30 },
      { metric: 'light_anomaly', enabled: false, min: 6, max: 0, cooldownMin: 30 }
    ]
  }
}, { timestamps: true });

export default mongoose.model('AlertConfig', alertConfigSchema);
