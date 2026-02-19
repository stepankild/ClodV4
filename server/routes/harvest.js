import express from 'express';
import {
  getScaleReading,
  getSessionByRoom,
  createSession,
  addPlant,
  removePlant,
  setPlantErrorNote,
  completeSession,
  getSessions
} from '../controllers/harvestController.js';
import { protect } from '../middleware/auth.js';
import { checkPermission } from '../middleware/rbac.js';

const router = express.Router();

router.use(protect);

// Просмотр
router.get('/scale', getScaleReading);
router.get('/session', checkPermission('harvest:view'), getSessionByRoom);
router.get('/sessions', checkPermission('harvest:view'), getSessions);

// Действия
router.post('/session', checkPermission('harvest:record'), createSession);
router.post('/session/:sessionId/plant', checkPermission('harvest:record'), addPlant);
router.delete('/session/:sessionId/plant/:plantNumber', checkPermission('harvest:record'), removePlant);
router.patch('/session/:sessionId/plant/:plantNumber', checkPermission('harvest:edit_weights'), setPlantErrorNote);
router.post('/session/:sessionId/complete', checkPermission('harvest:complete'), completeSession);

export default router;
