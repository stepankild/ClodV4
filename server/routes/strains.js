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

// Создание/редактирование сорта — доступно любой роли, которая работает с растениями
// (гровер при добавлении плана клонов, менеджер при настройке и т.д.)
const cultivationWrite = checkPermission(
  'users:update',
  'mothers:manage',
  'clones:create',
  'clones:edit',
  'vegetation:create',
  'vegetation:edit',
  'rooms:edit',
  'cycles:plan'
);

router.post('/', cultivationWrite, createStrain);
router.put('/:id', cultivationWrite, updateStrain);
// Удаление оставляем за теми, кто имеет право управлять пользователями/настройками
router.delete('/:id', checkPermission('users:update'), deleteStrain);

export default router;
