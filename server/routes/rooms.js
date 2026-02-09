import express from 'express';
import {
  getRooms,
  getRoomsSummary,
  getRoom,
  updateRoom,
  startCycle,
  harvestRoom,
  addNote
} from '../controllers/flowerRoomController.js';
import { getPlans, createPlan, updatePlan, deletePlan, getDeletedPlans, restorePlan } from '../controllers/plannedController.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

// All routes require authentication
router.use(protect);

router.get('/', getRooms);
router.get('/summary', getRoomsSummary);
router.get('/plans', getPlans);
router.get('/plans/deleted', getDeletedPlans);
router.post('/plans', createPlan);
router.put('/plans/:id', updatePlan);
router.delete('/plans/:id', deletePlan);
router.post('/plans/deleted/:id/restore', restorePlan);
router.get('/:id', getRoom);
router.put('/:id', updateRoom);
router.post('/:id/start', startCycle);
router.post('/:id/note', addNote);
router.post('/:id/harvest', harvestRoom);

export default router;
