import AuditLog from '../models/AuditLog.js';

/**
 * Создать запись в логе действий. Вызывать после успешного изменения данных.
 * @param {object} req - Express req (должен содержать req.user._id)
 * @param {object} opts - { action, entityType?, entityId?, details? }
 */
export async function createAuditLog(req, opts) {
  if (!req?.user?._id) return;
  try {
    await AuditLog.create({
      user: req.user._id,
      action: opts.action || 'unknown',
      entityType: opts.entityType || '',
      entityId: opts.entityId ?? null,
      details: opts.details || {},
      ip: req.ip || req.connection?.remoteAddress || '',
      userAgent: req.get?.('user-agent') || ''
    });
  } catch (err) {
    console.error('Audit log write error:', err);
  }
}
