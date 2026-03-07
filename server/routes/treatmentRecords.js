import express from 'express';
import {
  getRecords,
  getCalendar,
  getRoomHistory,
  createRecord,
  updateRecord,
  completeRecord,
  skipRecord,
  deleteRecord,
  getDeletedRecords,
  restoreRecord
} from '../controllers/treatmentRecordController.js';
import { protect } from '../middleware/auth.js';
import { checkPermission } from '../middleware/rbac.js';

const router = express.Router();

router.use(protect);

// Чтение — доступно всем авторизованным
router.get('/', getRecords);
router.get('/calendar', getCalendar);
router.get('/room/:roomId', getRoomHistory);

// Удалённые / восстановление
router.get('/deleted', checkPermission('treatments:delete'), getDeletedRecords);
router.post('/deleted/:id/restore', checkPermission('treatments:delete'), restoreRecord);

// Действия
router.post('/', checkPermission('treatments:create'), createRecord);
router.put('/:id', checkPermission('treatments:edit'), updateRecord);
router.put('/:id/complete', checkPermission('treatments:create'), completeRecord);
router.put('/:id/skip', checkPermission('treatments:edit'), skipRecord);
router.delete('/:id', checkPermission('treatments:delete'), deleteRecord);

export default router;
