import express from 'express';
import {
  getStrains,
  createStrain,
  updateStrain,
  deleteStrain,
  getDeletedStrains,
  restoreStrain,
  restoreRecentStrains,
  migrateStrains,
  mergeStrains
} from '../controllers/strainController.js';
import { protect } from '../middleware/auth.js';
import { checkPermission } from '../middleware/rbac.js';

const router = express.Router();

router.use(protect);

// Чтение — доступно всем авторизованным
router.get('/', getStrains);

// Опасные массовые операции — только суперадмин
router.post('/migrate', checkPermission('*'), migrateStrains);
router.post('/merge', checkPermission('*'), mergeStrains);
router.post('/restore-recent', checkPermission('*'), restoreRecentStrains);

// Удалённые / восстановление — только админ
router.get('/deleted', checkPermission('audit:read'), getDeletedStrains);
router.post('/deleted/:id/restore', checkPermission('audit:read'), restoreStrain);

// CRUD — требует право на редактирование пользователей (есть только у менеджеров/админов)
router.post('/', checkPermission('users:update'), createStrain);
router.put('/:id', checkPermission('users:update'), updateStrain);
router.delete('/:id', checkPermission('users:update'), deleteStrain);

export default router;
