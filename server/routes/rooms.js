import express from 'express';
import {
  getRooms,
  getRoomsSummary,
  getRoom,
  updateRoom,
  startCycle,
  harvestRoom,
  addNote,
  transferCycle
} from '../controllers/flowerRoomController.js';
import { getPlans, createPlan, updatePlan, deletePlan, getDeletedPlans, restorePlan } from '../controllers/plannedController.js';
import { getTemplates, createTemplate, deleteTemplate, getDeletedTemplates, restoreTemplate } from '../controllers/roomTemplateController.js';
import { protect } from '../middleware/auth.js';
import { checkPermission } from '../middleware/rbac.js';

const router = express.Router();

// All routes require authentication
router.use(protect);

// Просмотр — доступно всем авторизованным (фильтруется через view-пермишены на фронте)
router.get('/', getRooms);
router.get('/summary', getRoomsSummary);

// Планы циклов (ПЕРЕД /:id, иначе Express считает "plans" за id)
router.get('/plans', getPlans);
router.get('/plans/deleted', checkPermission('cycles:plan'), getDeletedPlans);
router.post('/plans', checkPermission('cycles:plan'), createPlan);
router.put('/plans/:id', checkPermission('cycles:plan'), updatePlan);
router.delete('/plans/:id', checkPermission('cycles:plan'), deletePlan);
router.post('/plans/deleted/:id/restore', checkPermission('cycles:plan'), restorePlan);

// Шаблоны комнат (ПЕРЕД /:id)
router.get('/templates', getTemplates);
router.get('/templates/deleted', checkPermission('templates:manage'), getDeletedTemplates);
router.post('/templates', checkPermission('templates:manage'), createTemplate);
router.delete('/templates/:id', checkPermission('templates:manage'), deleteTemplate);
router.post('/templates/deleted/:id/restore', checkPermission('templates:manage'), restoreTemplate);

// Конкретная комната по ID (ПОСЛЕ специфичных маршрутов)
router.get('/:id', getRoom);

// Действия с комнатами
router.put('/:id', checkPermission('rooms:edit'), updateRoom);
router.post('/:id/start', checkPermission('rooms:start_cycle'), startCycle);
router.post('/:id/note', checkPermission('rooms:notes'), addNote);
router.post('/:id/harvest', checkPermission('harvest:complete'), harvestRoom);
router.post('/:sourceId/transfer/:targetId', checkPermission('rooms:start_cycle'), transferCycle);

export default router;
