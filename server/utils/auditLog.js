import AuditLog from '../models/AuditLog.js';
import { getClientIp } from './getClientIp.js';

const MAX_UA = 300;
const MAX_DETAIL_STRING = 500;

// Ограничиваем строковые значения в details, чтобы лог не раздувался
const truncateDetails = (details) => {
  if (!details || typeof details !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(details)) {
    if (typeof v === 'string' && v.length > MAX_DETAIL_STRING) {
      out[k] = v.slice(0, MAX_DETAIL_STRING) + '…';
    } else {
      out[k] = v;
    }
  }
  return out;
};

/**
 * Создать запись в логе действий. Вызывать после успешного изменения данных.
 * @param {object} req - Express req (должен содержать req.user._id)
 * @param {object} opts - { action, entityType?, entityId?, details? }
 */
export async function createAuditLog(req, opts) {
  if (!req?.user?._id) return;
  try {
    const ua = req.get?.('user-agent') || '';
    await AuditLog.create({
      user: req.user._id,
      action: opts.action || 'unknown',
      entityType: opts.entityType || '',
      entityId: opts.entityId ?? null,
      details: truncateDetails(opts.details),
      ip: getClientIp(req),
      userAgent: ua.length > MAX_UA ? ua.slice(0, MAX_UA) : ua
    });
  } catch (err) {
    console.error('Audit log write error:', err);
  }
}
