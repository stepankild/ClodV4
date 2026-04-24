import express from 'express';
import {
  getLatest,
  getHistory,
  triggerRefresh,
  report,
} from '../controllers/systemStatusController.js';
import { protect } from '../middleware/auth.js';
import { checkPermission } from '../middleware/rbac.js';
import { requireBackupApiKey } from '../middleware/backupAuth.js';

const router = express.Router();

// HTTP-fallback отчёт от probe. API-key auth (тот же backupApiKey — у probe
// уже есть SCALE_API_KEY, который идентичен сидит в .env, но middleware ждёт
// X-Backup-Api-Key; проще не путать — возьмём через backupAuth).
// Ставим до protect т.к. JWT не нужен.
router.post('/report', requireBackupApiKey, report);

router.use(protect);
router.get('/latest', checkPermission('audit:read'), getLatest);
router.get('/history', checkPermission('audit:read'), getHistory);
router.post('/refresh', checkPermission('audit:read'), triggerRefresh);

export default router;
