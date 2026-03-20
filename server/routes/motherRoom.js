import express from 'express';
import {
  getPlants, createPlant, updatePlant,
  recordPrune, retirePlant, deletePlant,
  getDeletedPlants, restorePlant,
  getMap, updateMap, clearMapPositions
} from '../controllers/motherRoomController.js';
import { protect } from '../middleware/auth.js';
import { checkPermission } from '../middleware/rbac.js';

const router = express.Router();
router.use(protect);

// Plants
router.get('/plants/deleted', checkPermission('mothers:manage'), getDeletedPlants);
router.post('/plants/deleted/:id/restore', checkPermission('mothers:manage'), restorePlant);
router.get('/plants', getPlants);
router.post('/plants', checkPermission('mothers:manage'), createPlant);
router.put('/plants/:id', checkPermission('mothers:manage'), updatePlant);
router.post('/plants/:id/prune', checkPermission('mothers:manage'), recordPrune);
router.post('/plants/:id/retire', checkPermission('mothers:manage'), retirePlant);
router.delete('/plants/:id', checkPermission('mothers:manage'), deletePlant);

// Map
router.get('/map', getMap);
router.put('/map', checkPermission('mothers:manage'), updateMap);
router.delete('/map/positions', checkPermission('mothers:manage'), clearMapPositions);

export default router;
