import RoomTask, { TASK_TYPES, TASK_LABELS } from '../models/RoomTask.js';
import FlowerRoom from '../models/FlowerRoom.js';
import RoomLog from '../models/RoomLog.js';

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

    const query = { room: roomId };
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
    const task = await RoomTask.findById(req.params.id);

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

    const task = await RoomTask.findById(req.params.id);

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
    const task = await RoomTask.findById(req.params.id);

    if (!task) {
      return res.status(404).json({ message: 'Задача не найдена' });
    }

    await task.deleteOne();

    res.json({ message: 'Задача удалена' });
  } catch (error) {
    console.error('Delete task error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

// @desc    Quick add common task
// @route   POST /api/tasks/quick
export const quickAddTask = async (req, res) => {
  try {
    const { roomId, type, product, dosage } = req.body;

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
      completedAt: new Date(),
      completedBy: req.user._id
    };

    if (type === 'spray') {
      taskData.sprayProduct = product || '';
      taskData.title = product ? `Опрыскивание: ${product}` : 'Опрыскивание';
    } else if (type === 'feed') {
      taskData.feedProduct = product || '';
      taskData.feedDosage = dosage || '';
      taskData.title = product ? `Подкормка: ${product}` : 'Подкормка';
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

    res.status(201).json(task);
  } catch (error) {
    console.error('Quick add task error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};
