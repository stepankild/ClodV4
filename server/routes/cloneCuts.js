import express from 'express';
import { getCloneCuts, getDeletedCloneCuts, upsertCloneCut, updateCloneCut, deleteCloneCut, restoreCloneCut } from '../controllers/cloneCutController.js';
import { protect } from '../middleware/auth.js';
import { checkPermission } from '../middleware/rbac.js';

const router = express.Router();
router.use(protect);

// Просмотр
router.get('/', getCloneCuts);

// Действия
router.get('/deleted', checkPermission('clones:delete'), getDeletedCloneCuts);
router.post('/deleted/:id/restore', checkPermission('clones:delete'), restoreCloneCut);
router.post('/', checkPermission('clones:create'), upsertCloneCut);
router.put('/:id', checkPermission('clones:edit'), updateCloneCut);
router.delete('/:id', checkPermission('clones:delete'), deleteCloneCut);

export default router;
