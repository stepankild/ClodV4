import express from 'express';
import {
  getSelectionBatches,
  getSelectionBatch,
  getDeletedSelectionBatches,
  createSelectionBatch,
  updateSelectionBatch,
  deleteSelectionBatch,
  restoreSelectionBatch
} from '../controllers/selectionController.js';
import { protect } from '../middleware/auth.js';
import { checkPermission } from '../middleware/rbac.js';

const router = express.Router();
router.use(protect);

router.get('/', checkPermission('selection:view'), getSelectionBatches);
router.get('/deleted', checkPermission('selection:create'), getDeletedSelectionBatches);
router.post('/deleted/:id/restore', checkPermission('selection:create'), restoreSelectionBatch);
router.get('/:id', checkPermission('selection:view'), getSelectionBatch);
router.post('/', checkPermission('selection:create'), createSelectionBatch);
router.put('/:id', checkPermission('selection:create'), updateSelectionBatch);
router.delete('/:id', checkPermission('selection:create'), deleteSelectionBatch);

export default router;
