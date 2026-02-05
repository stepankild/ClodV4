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
import { checkPermission } from '../middleware/rbac.js';

const router = express.Router();

router.use(protect);

router.get('/scale', getScaleReading);
router.get('/session', checkPermission('harvest:view'), getSessionByRoom);
router.post('/session', checkPermission('harvest:do'), createSession);
router.post('/session/:sessionId/plant', checkPermission('harvest:do'), addPlant);
router.patch('/session/:sessionId/plant/:plantNumber', checkPermission('harvest:do'), setPlantErrorNote);
router.post('/session/:sessionId/complete', checkPermission('harvest:do'), completeSession);
router.get('/sessions', checkPermission('harvest:view'), getSessions);

export default router;
