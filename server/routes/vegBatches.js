import express from 'express';
import { getVegBatches, getDeletedVegBatches, createVegBatch, updateVegBatch, deleteVegBatch, restoreVegBatch } from '../controllers/vegBatchController.js';
import { protect } from '../middleware/auth.js';
import { checkPermission } from '../middleware/rbac.js';

const router = express.Router();
router.use(protect);

// Просмотр
router.get('/', getVegBatches);

// Действия
router.get('/deleted', checkPermission('vegetation:delete'), getDeletedVegBatches);
router.post('/deleted/:id/restore', checkPermission('vegetation:delete'), restoreVegBatch);
router.post('/', checkPermission('vegetation:create'), createVegBatch);
router.put('/:id', checkPermission('vegetation:edit'), updateVegBatch);
router.delete('/:id', checkPermission('vegetation:delete'), deleteVegBatch);

export default router;
