import express from 'express';
import { getCloneCuts, getDeletedCloneCuts, upsertCloneCut, updateCloneCut, deleteCloneCut, restoreCloneCut } from '../controllers/cloneCutController.js';
import { protect } from '../middleware/auth.js';
import { checkPermission } from '../middleware/rbac.js';

const router = express.Router();
router.use(protect);

router.get('/', getCloneCuts);
router.get('/deleted', checkPermission('clones:create'), getDeletedCloneCuts);
router.post('/deleted/:id/restore', checkPermission('clones:create'), restoreCloneCut);
router.post('/', checkPermission('clones:create'), upsertCloneCut);
router.put('/:id', checkPermission('clones:create'), updateCloneCut);
router.delete('/:id', checkPermission('clones:create'), deleteCloneCut);

export default router;
