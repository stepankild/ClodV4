import express from 'express';
import { getCloneCuts, upsertCloneCut, updateCloneCut, deleteCloneCut } from '../controllers/cloneCutController.js';
import { protect } from '../middleware/auth.js';
import { checkPermission } from '../middleware/rbac.js';

const router = express.Router();
router.use(protect);

router.get('/', getCloneCuts);
router.post('/', checkPermission('clones:create'), upsertCloneCut);
router.put('/:id', checkPermission('clones:create'), updateCloneCut);
router.delete('/:id', checkPermission('clones:create'), deleteCloneCut);

export default router;
