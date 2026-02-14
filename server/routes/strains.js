import express from 'express';
import {
  getStrains,
  createStrain,
  updateStrain,
  deleteStrain,
  getDeletedStrains,
  restoreStrain,
  migrateStrains,
  mergeStrains
} from '../controllers/strainController.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

router.use(protect);

router.post('/migrate', migrateStrains);
router.post('/merge', mergeStrains);
router.get('/deleted', getDeletedStrains);
router.post('/deleted/:id/restore', restoreStrain);

router.get('/', getStrains);
router.post('/', createStrain);
router.put('/:id', updateStrain);
router.delete('/:id', deleteStrain);

export default router;
