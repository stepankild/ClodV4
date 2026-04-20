// Auth для бэкап-endpoints, вызываемых НЕ браузером (PS-скрипты, агент).
// Использует статический ключ BACKUP_API_KEY, заданный в env Railway.
// Клиент передаёт ключ в заголовке X-Backup-Api-Key.

export function requireBackupApiKey(req, res, next) {
  const expected = process.env.BACKUP_API_KEY;
  if (!expected) {
    console.warn('BACKUP_API_KEY not set — /api/backups/report rejected');
    return res.status(503).json({ message: 'Backup API key not configured on server' });
  }
  const provided = req.get('X-Backup-Api-Key') || req.get('x-backup-api-key');
  if (!provided || provided !== expected) {
    return res.status(401).json({ message: 'Invalid backup API key' });
  }
  next();
}
