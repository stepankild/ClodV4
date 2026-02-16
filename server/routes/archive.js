import express from 'express';
import {
  getArchives,
  getArchive,
  getArchiveStats,
  getStrainDetailStats,
  getRoomDetailStats,
  getDeletedArchives,
  harvestAndArchive,
  updateArchive,
  deleteArchive,
  restoreArchive,
  getRoomLogs,
  fixCloneCounts
} from '../controllers/archiveController.js';
import { protect } from '../middleware/auth.js';
import { checkPermission } from '../middleware/rbac.js';

const router = express.Router();

router.use(protect);

// Просмотр — доступно всем с archive:view (проверяется на фронте через ProtectedRoute)
router.get('/', getArchives);
router.get('/stats', checkPermission('stats:view'), getArchiveStats);
router.get('/stats/strain/:strain', checkPermission('stats:view'), getStrainDetailStats);
router.get('/stats/room/:roomId', checkPermission('stats:view'), getRoomDetailStats);
router.get('/logs/:roomId', getRoomLogs);
router.get('/:id', getArchive);

// Действия
router.get('/deleted', checkPermission('archive:delete'), getDeletedArchives);
router.post('/deleted/:id/restore', checkPermission('archive:delete'), restoreArchive);
router.post('/harvest/:roomId', checkPermission('harvest:complete'), harvestAndArchive);
router.put('/:id', checkPermission('archive:edit'), updateArchive);
router.delete('/:id', checkPermission('archive:delete'), deleteArchive);

// One-time migration
router.post('/fix-clone-counts', checkPermission('archive:edit'), fixCloneCounts);

export default router;
