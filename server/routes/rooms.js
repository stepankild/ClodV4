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
import { getTemplates, createTemplate, deleteTemplate } from '../controllers/roomTemplateController.js';
import { protect } from '../middleware/auth.js';
import { checkPermission } from '../middleware/rbac.js';

const router = express.Router();

// All routes require authentication
router.use(protect);

// Просмотр — доступно всем авторизованным (фильтруется через view-пермишены на фронте)
router.get('/', getRooms);
router.get('/summary', getRoomsSummary);
router.get('/:id', getRoom);

// Планы циклов
router.get('/plans', getPlans);
router.get('/plans/deleted', getDeletedPlans);
router.post('/plans', checkPermission('cycles:plan'), createPlan);
router.put('/plans/:id', checkPermission('cycles:plan'), updatePlan);
router.delete('/plans/:id', checkPermission('cycles:plan'), deletePlan);
router.post('/plans/deleted/:id/restore', checkPermission('cycles:plan'), restorePlan);

// Шаблоны комнат
router.get('/templates', getTemplates);
router.post('/templates', checkPermission('templates:manage'), createTemplate);
router.delete('/templates/:id', checkPermission('templates:manage'), deleteTemplate);

// Действия с комнатами
router.put('/:id', checkPermission('rooms:edit'), updateRoom);
router.post('/:id/start', checkPermission('rooms:start_cycle'), startCycle);
router.post('/:id/note', checkPermission('rooms:notes'), addNote);
router.post('/:id/harvest', checkPermission('harvest:complete'), harvestRoom);

export default router;
