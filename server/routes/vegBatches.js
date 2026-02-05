import express from 'express';
import { getVegBatches, createVegBatch, updateVegBatch, deleteVegBatch } from '../controllers/vegBatchController.js';
import { protect } from '../middleware/auth.js';
import { checkPermission } from '../middleware/rbac.js';

const router = express.Router();
router.use(protect);

router.get('/', getVegBatches);
router.post('/', checkPermission('vegetation:create'), createVegBatch);
router.put('/:id', checkPermission('vegetation:create'), updateVegBatch);
router.delete('/:id', checkPermission('vegetation:create'), deleteVegBatch);

export default router;
