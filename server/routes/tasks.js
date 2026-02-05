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

const router = express.Router();

router.use(protect);

router.get('/types', getTaskTypes);
router.get('/room/:roomId', getRoomTasks);
router.get('/deleted', getDeletedTasks);
router.post('/deleted/:id/restore', restoreTask);
router.post('/', createTask);
router.post('/quick', quickAddTask);
router.put('/:id/toggle', toggleTask);
router.put('/:id', updateTask);
router.delete('/:id', deleteTask);

export default router;
