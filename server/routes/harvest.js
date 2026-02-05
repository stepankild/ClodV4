import express from 'express';
import {
  getScaleReading,
  getSessionByRoom,
  createSession,
  addPlant,
  setPlantErrorNote,
  completeSession,
  getSessions
} from '../controllers/harvestController.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();
router.use(protect);

router.get('/scale', getScaleReading);
router.get('/session', getSessionByRoom);
router.post('/session', createSession);
router.get('/sessions', getSessions);
router.post('/session/:sessionId/plant', addPlant);
router.patch('/session/:sessionId/plant/:plantNumber', setPlantErrorNote);
router.post('/session/:sessionId/complete', completeSession);

export default router;
