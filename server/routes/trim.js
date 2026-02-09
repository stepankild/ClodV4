import express from 'express';
import {
  getActiveTrimArchives,
  getTrimDailyStats,
  addTrimLog,
  getTrimLogs,
  deleteTrimLog,
  updateTrimArchive,
  completeTrim,
  getDeletedTrimLogs,
  restoreTrimLog
} from '../controllers/trimController.js';
import { protect } from '../middleware/auth.js';
import { checkPermission } from '../middleware/rbac.js';

const router = express.Router();

router.use(protect);

router.get('/active', checkPermission('trim:view'), getActiveTrimArchives);
router.get('/stats/daily', checkPermission('trim:view'), getTrimDailyStats);
router.get('/deleted', checkPermission('trim:view'), getDeletedTrimLogs);
router.post('/deleted/:id/restore', checkPermission('trim:edit'), restoreTrimLog);
router.post('/log', checkPermission('trim:create'), addTrimLog);
router.get('/logs/:archiveId', checkPermission('trim:view'), getTrimLogs);
router.delete('/log/:id', checkPermission('trim:edit'), deleteTrimLog);
router.put('/archive/:archiveId', checkPermission('trim:edit'), updateTrimArchive);
router.post('/complete/:archiveId', checkPermission('trim:edit'), completeTrim);

export default router;
