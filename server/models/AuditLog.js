import mongoose from 'mongoose';

const auditLogSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  action: {
    type: String,
    required: true,
    trim: true
  },
  entityType: {
    type: String,
    trim: true,
    default: ''
  },
  entityId: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  details: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  ip: { type: String, default: '' },
  userAgent: { type: String, default: '' }
}, {
  timestamps: true
});

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ user: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });
auditLogSchema.index({ entityType: 1, entityId: 1 });
// Составной индекс для getSessions: быстрые выборки auth.login/auth.logout по множеству юзеров
auditLogSchema.index({ action: 1, user: 1, createdAt: 1 });
// TTL: автоматически удаляем записи старше 2 лет (735 дней)
auditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 735 });

const AuditLog = mongoose.model('AuditLog', auditLogSchema);
export default AuditLog;
