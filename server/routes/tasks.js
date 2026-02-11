import express from 'express';
import {
  getTaskTypes,
  getRoomTasks,
  getDeletedTasks,
  createTask,
  toggleTask,
  updateTask,
  deleteTask,
  restoreTask,
  quickAddTask
} from '../controllers/taskController.js';
import { protect } from '../middleware/auth.js';
import { checkPermission } from '../middleware/rbac.js';

const router = express.Router();

router.use(protect);

// Просмотр — доступно всем авторизованным
router.get('/types', getTaskTypes);
router.get('/room/:roomId', getRoomTasks);
router.get('/deleted', getDeletedTasks);

// Действия
router.post('/', checkPermission('tasks:create'), createTask);
router.post('/quick', checkPermission('tasks:create'), quickAddTask);
router.put('/:id/toggle', checkPermission('tasks:complete'), toggleTask);
router.put('/:id', checkPermission('tasks:create'), updateTask);
router.delete('/:id', checkPermission('tasks:delete'), deleteTask);
router.post('/deleted/:id/restore', checkPermission('tasks:delete'), restoreTask);

export default router;
