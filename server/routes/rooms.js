import express from 'express';
import {
  getRooms,
  getRoom,
  updateRoom,
  startCycle,
  harvestRoom
} from '../controllers/flowerRoomController.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

// All routes require authentication
router.use(protect);

router.get('/', getRooms);
router.get('/:id', getRoom);
router.put('/:id', updateRoom);
router.post('/:id/start', startCycle);
router.post('/:id/harvest', harvestRoom);

export default router;
