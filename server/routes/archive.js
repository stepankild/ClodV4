import express from 'express';
import {
  getArchives,
  getArchive,
  getArchiveStats,
  getDeletedArchives,
  harvestAndArchive,
  updateArchive,
  deleteArchive,
  restoreArchive,
  getRoomLogs
} from '../controllers/archiveController.js';
import { protect } from '../middleware/auth.js';
import { checkPermission } from '../middleware/rbac.js';

const router = express.Router();

router.use(protect);

router.get('/', getArchives);
router.get('/stats', checkPermission('stats:view'), getArchiveStats);
router.get('/deleted', getDeletedArchives);
router.post('/deleted/:id/restore', restoreArchive);
router.get('/logs/:roomId', getRoomLogs);
router.get('/:id', getArchive);
router.post('/harvest/:roomId', checkPermission('harvest:do'), harvestAndArchive);
router.put('/:id', updateArchive);
router.delete('/:id', deleteArchive);

export default router;
