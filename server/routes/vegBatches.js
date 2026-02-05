import express from 'express';
import { getVegBatches, getDeletedVegBatches, createVegBatch, updateVegBatch, deleteVegBatch, restoreVegBatch } from '../controllers/vegBatchController.js';
import { protect } from '../middleware/auth.js';
import { checkPermission } from '../middleware/rbac.js';

const router = express.Router();
router.use(protect);

router.get('/', getVegBatches);
router.get('/deleted', checkPermission('vegetation:create'), getDeletedVegBatches);
router.post('/deleted/:id/restore', checkPermission('vegetation:create'), restoreVegBatch);
router.post('/', checkPermission('vegetation:create'), createVegBatch);
router.put('/:id', checkPermission('vegetation:create'), updateVegBatch);
router.delete('/:id', checkPermission('vegetation:create'), deleteVegBatch);

export default router;
