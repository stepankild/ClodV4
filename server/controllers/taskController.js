import RoomTask, { TASK_TYPES, TASK_LABELS } from '../models/RoomTask.js';
import FlowerRoom from '../models/FlowerRoom.js';
import RoomLog from '../models/RoomLog.js';
import { createAuditLog } from '../utils/auditLog.js';
import { notDeleted, deletedOnly } from '../utils/softDelete.js';

// @desc    Get task types
// @route   GET /api/tasks/types
export const getTaskTypes = async (req, res) => {
  try {
    const types = Object.entries(TASK_LABELS).map(([key, label]) => ({
      value: key,
      label
    }));
    res.json(types);
  } catch (error) {
    console.error('Get task types error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

// @desc    Get tasks for a room
// @route   GET /api/tasks/room/:roomId
export const getRoomTasks = async (req, res) => {
  try {
    const { roomId } = req.params;
    const { completed, limit = 50 } = req.query;

    const query = { room: roomId, ...notDeleted };
    if (completed !== undefined) {
      query.completed = completed === 'true';
    }

    const tasks = await RoomTask.find(query)
      .populate('completedBy', 'name')
      .sort({ completed: 1, priority: -1, createdAt: -1 })
      .limit(parseInt(limit));

    res.json(tasks);
  } catch (error) {
    console.error('Get room tasks error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

// @desc    Create task
// @route   POST /api/tasks
export const createTask = async (req, res) => {
  try {
    const {
      roomId,
      type,
      title,
      description,
      sprayProduct,
      feedProduct,
      feedDosage,
      scheduledDate,
      priority
    } = req.body;

    const room = await FlowerRoom.findById(roomId);
    if (!room) {
      return res.status(404).json({ message: 'Комната не найдена' });
    }

    const task = await RoomTask.create({
      room: roomId,
      cycleId: room.currentCycleId,
      type,
      title: title || TASK_LABELS[type],
      description,
      sprayProduct,
      feedProduct,
      feedDosage,
      scheduledDate,
      priority,
      dayOfCycle: room.currentDay || null
    });

    await createAuditLog(req, { action: 'task.create', entityType: 'RoomTask', entityId: task._id, details: { title: task.title, roomName: room.name, type } });
    res.status(201).json(task);
  } catch (error) {
    console.error('Create task error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

// @desc    Toggle task completion
// @route   PUT /api/tasks/:id/toggle
export const toggleTask = async (req, res) => {
  try {
    const task = await RoomTask.findOne({ _id: req.params.id, ...notDeleted });

    if (!task) {
      return res.status(404).json({ message: 'Задача не найдена' });
    }

    const room = await FlowerRoom.findById(task.room);

    task.completed = !task.completed;
    if (task.completed) {
      task.completedAt = new Date();
      task.completedBy = req.user._id;
      task.dayOfCycle = room?.currentDay || null;

      // Создаём лог
      await RoomLog.create({
        room: task.room,
        cycleId: room?.currentCycleId,
        type: 'task_completed',
        title: `Выполнено: ${task.title}`,
        description: task.description,
        data: {
          taskId: task._id,
          taskType: task.type,
          sprayProduct: task.sprayProduct,
          feedProduct: task.feedProduct,
          feedDosage: task.feedDosage
        },
        user: req.user._id,
        dayOfCycle: room?.currentDay
      });
    } else {
      task.completedAt = null;
      task.completedBy = null;
    }

    await task.save();
    await task.populate('completedBy', 'name');

    await createAuditLog(req, { action: task.completed ? 'task.complete' : 'task.uncomplete', entityType: 'RoomTask', entityId: task._id, details: { title: task.title, roomId: task.room?.toString?.() || task.room } });
    res.json(task);
  } catch (error) {
    console.error('Toggle task error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

// @desc    Update task
// @route   PUT /api/tasks/:id
export const updateTask = async (req, res) => {
  try {
    const {
      title,
      description,
      sprayProduct,
      feedProduct,
      feedDosage,
      scheduledDate,
      priority
    } = req.body;

    const task = await RoomTask.findOne({ _id: req.params.id, ...notDeleted });

    if (!task) {
      return res.status(404).json({ message: 'Задача не найдена' });
    }

    if (title !== undefined) task.title = title;
    if (description !== undefined) task.description = description;
    if (sprayProduct !== undefined) task.sprayProduct = sprayProduct;
    if (feedProduct !== undefined) task.feedProduct = feedProduct;
    if (feedDosage !== undefined) task.feedDosage = feedDosage;
    if (scheduledDate !== undefined) task.scheduledDate = scheduledDate;
    if (priority !== undefined) task.priority = priority;

    await task.save();
    await task.populate('completedBy', 'name');

    await createAuditLog(req, { action: 'task.update', entityType: 'RoomTask', entityId: task._id, details: { title: task.title } });
    res.json(task);
  } catch (error) {
    console.error('Update task error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

// @desc    Delete task
// @route   DELETE /api/tasks/:id
export const deleteTask = async (req, res) => {
  try {
    const task = await RoomTask.findOne({ _id: req.params.id, ...notDeleted });

    if (!task) {
      return res.status(404).json({ message: 'Задача не найдена' });
    }

    const taskTitle = task.title || task.type || '';
    const roomId = task.room?.toString?.() || task.room;
    await createAuditLog(req, { action: 'task.delete', entityType: 'RoomTask', entityId: task._id, details: { title: taskTitle, roomId } });
    task.deletedAt = new Date();
    await task.save();

    res.json({ message: 'Задача удалена (можно восстановить)' });
  } catch (error) {
    console.error('Delete task error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

// @desc    Quick add common task
// @route   POST /api/tasks/quick
export const quickAddTask = async (req, res) => {
  try {
    const { roomId, type, product, dosage, completedAt, description } = req.body;

    const room = await FlowerRoom.findById(roomId);
    if (!room) {
      return res.status(404).json({ message: 'Комната не найдена' });
    }

    const taskData = {
      room: roomId,
      cycleId: room.currentCycleId,
      type,
      title: TASK_LABELS[type],
      dayOfCycle: room.currentDay || null,
      completed: true,
      completedAt: completedAt ? new Date(completedAt) : new Date(),
      completedBy: req.user._id
    };

    if (type === 'spray') {
      taskData.sprayProduct = product || '';
      taskData.title = product ? `Опрыскивание: ${product}` : 'Опрыскивание';
      if (description && description.trim()) {
        taskData.description = description.trim();
      }
    } else if (type === 'feed') {
      taskData.feedProduct = product || '';
      taskData.feedDosage = dosage || '';
      taskData.title = product ? `Подкормка: ${product}` : 'Подкормка';
    } else if (type === 'defoliation') {
      taskData.title = 'Дефолиация';
      if (description && description.trim()) {
        taskData.description = description.trim();
      }
    } else if (type === 'trim') {
      if (description && description.trim()) {
        taskData.description = description.trim();
        taskData.title = `Подрезка: ${description.trim()}`;
      } else {
        taskData.title = 'Подрезка';
      }
    } else if (type === 'net') {
      taskData.title = 'Натяжка сетки';
      if (description && description.trim()) {
        taskData.description = description.trim();
        taskData.title = `Сетка: ${description.trim()}`;
      }
    } else if (type === 'custom') {
      if (description && description.trim()) {
        taskData.title = description.trim();
        taskData.description = description.trim();
      } else {
        taskData.title = 'Другое';
      }
    }

    const task = await RoomTask.create(taskData);

    // Создаём лог
    await RoomLog.create({
      room: roomId,
      cycleId: room.currentCycleId,
      type: 'task_completed',
      title: task.title,
      data: {
        taskId: task._id,
        taskType: type,
        product,
        dosage
      },
      user: req.user._id,
      dayOfCycle: room.currentDay
    });

    await task.populate('completedBy', 'name');

    await createAuditLog(req, { action: 'task.quick_add', entityType: 'RoomTask', entityId: task._id, details: { title: task.title, roomName: room.name, type } });
    res.status(201).json(task);
  } catch (error) {
    console.error('Quick add task error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

export const getDeletedTasks = async (req, res) => {
  try {
    const list = await RoomTask.find(deletedOnly).populate('room', 'name roomNumber').populate('completedBy', 'name').sort({ deletedAt: -1 }).limit(100);
    res.json(list);
  } catch (error) {
    console.error('Get deleted tasks error:', error);
    res.status(500).json({ message: 'РћС€РёР±РєР° СЃРµСЂРІРµСЂР°' });
  }
};

export const restoreTask = async (req, res) => {
  try {
    const task = await RoomTask.findOne({ _id: req.params.id, ...deletedOnly });
    if (!task) return res.status(404).json({ message: 'Р—Р°РґР°С‡Р° РЅРµ РЅР°Р№РґРµРЅР° РёР»Рё СѓР¶Рµ РІРѕСЃСЃС‚Р°РЅРѕРІР»РµРЅР°' });
    task.deletedAt = null;
    await task.save();
    await task.populate('room', 'name roomNumber');
    await createAuditLog(req, { action: 'task.restore', entityType: 'RoomTask', entityId: task._id, details: { title: task.title } });
    res.json(task);
  } catch (error) {
    console.error('Restore task error:', error);
    res.status(500).json({ message: error.message || 'РћС€РёР±РєР° СЃРµСЂРІРµСЂР°' });
  }
};
