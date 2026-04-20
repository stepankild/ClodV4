import express from 'express';
import {
  listBackups,
  getAgentStatus,
  requestBackup,
  reportBackup,
} from '../controllers/backupController.js';
import { protect } from '../middleware/auth.js';
import { checkPermission } from '../middleware/rbac.js';
import { requireBackupApiKey } from '../middleware/backupAuth.js';

const router = express.Router();

// Отчёт от скриптов/агента — аутентификация по API-ключу, не JWT.
// Ставится ПЕРЕД общим protect, т.к. JWT тут не нужен.
router.post('/report', requireBackupApiKey, reportBackup);

// Всё остальное — только для залогиненных админов (audit:read).
router.use(protect);
router.get('/', checkPermission('audit:read'), listBackups);
router.get('/agent-status', checkPermission('audit:read'), getAgentStatus);
router.post('/run', checkPermission('audit:read'), requestBackup);

export default router;
