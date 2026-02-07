import FlowerRoom from '../models/FlowerRoom.js';
import RoomTask from '../models/RoomTask.js';
import RoomLog from '../models/RoomLog.js';
import CycleArchive from '../models/CycleArchive.js';
import PlannedCycle from '../models/PlannedCycle.js';
import mongoose from 'mongoose';
import { createAuditLog } from '../utils/auditLog.js';
import { notDeleted } from '../utils/softDelete.js';

// @desc    Get all flower rooms
// @route   GET /api/rooms
export const getRooms = async (req, res) => {
  try {
    let rooms = await FlowerRoom.find().sort({ roomNumber: 1 });

    // If no rooms exist, create 5 default rooms
    if (rooms.length === 0) {
      const defaultRooms = [];
      for (let i = 1; i <= 5; i++) {
        defaultRooms.push({
          roomNumber: i,
          name: `Комната ${i}`,
          isActive: false
        });
      }
      rooms = await FlowerRoom.insertMany(defaultRooms);
    }

    // Добавляем количество невыполненных задач к каждой комнате
    const roomsWithTasks = await Promise.all(rooms.map(async (room) => {
      const pendingTasks = await RoomTask.countDocuments({
        room: room._id,
        completed: false
      });
      return {
        ...room.toObject(),
        pendingTasks
      };
    }));

    res.json(roomsWithTasks);
  } catch (error) {
    console.error('Get rooms error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

// @desc    Get all rooms with summary (for overview: trim week2, defoliation week4, last treatment)
// @route   GET /api/rooms/summary
export const getRoomsSummary = async (req, res) => {
  try {
    let rooms = await FlowerRoom.find().sort({ roomNumber: 1 });
    if (rooms.length === 0) {
      const defaultRooms = [];
      for (let i = 1; i <= 5; i++) {
        defaultRooms.push({ roomNumber: i, name: `Комната ${i}`, isActive: false });
      }
      rooms = await FlowerRoom.insertMany(defaultRooms);
    }
    const summary = await Promise.all(rooms.map(async (room) => {
      const roomId = room._id;
      const [completedTasksRaw, pendingTasksRaw, lastArchive, plannedCycle] = await Promise.all([
        RoomTask.find({ room: roomId, completed: true, ...notDeleted }).lean(),
        RoomTask.find({ room: roomId, completed: false, ...notDeleted }).lean(),
        CycleArchive.findOne({ room: roomId }).sort({ harvestDate: -1 }).lean(),
        PlannedCycle.findOne({ room: roomId, $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }] }).lean()
      ]);
      // Backward-compat fields
      const trimWeek2 = completedTasksRaw.find(t => t.type === 'trim');
      const defoliationWeek4 = completedTasksRaw.find(t => t.type === 'defoliation');
      const lastTreatment = completedTasksRaw.length
        ? completedTasksRaw.reduce((a, t) => {
            const tDate = t.completedAt ? new Date(t.completedAt).getTime() : 0;
            const aDate = a && a.completedAt ? new Date(a.completedAt).getTime() : 0;
            return tDate > aDate ? t : a;
          }, null)
        : null;
      // Group completed tasks by type
      const completedTasks = {};
      for (const task of completedTasksRaw) {
        if (!completedTasks[task.type]) completedTasks[task.type] = [];
        completedTasks[task.type].push({
          _id: task._id,
          title: task.title,
          completedAt: task.completedAt,
          sprayProduct: task.sprayProduct || null,
          feedProduct: task.feedProduct || null,
          dayOfCycle: task.dayOfCycle
        });
      }
      for (const type of Object.keys(completedTasks)) {
        completedTasks[type].sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));
      }
      const roomObj = room.toObject ? room.toObject() : { ...room };
      return {
        ...roomObj,
        trimWeek2Done: trimWeek2?.completedAt ?? null,
        defoliationWeek4Done: defoliationWeek4?.completedAt ?? null,
        lastTreatmentAt: lastTreatment?.completedAt ?? null,
        lastTreatmentTitle: lastTreatment?.title ?? null,
        completedTasks,
        pendingTasks: pendingTasksRaw.map(t => ({
          _id: t._id, type: t.type, title: t.title,
          scheduledDate: t.scheduledDate, priority: t.priority
        })),
        lastArchive: lastArchive ? {
          _id: lastArchive._id,
          cycleName: lastArchive.cycleName,
          strain: lastArchive.strain,
          harvestDate: lastArchive.harvestDate,
          harvestData: lastArchive.harvestData
        } : null,
        plannedCycle: plannedCycle ? {
          _id: plannedCycle._id,
          cycleName: plannedCycle.cycleName,
          strain: plannedCycle.strain,
          plannedStartDate: plannedCycle.plannedStartDate,
          plantsCount: plannedCycle.plantsCount,
          floweringDays: plannedCycle.floweringDays,
          notes: plannedCycle.notes
        } : null
      };
    }));
    res.json(summary);
  } catch (error) {
    console.error('Get rooms summary error:', error);
    const msg = error?.message || 'Ошибка сервера';
    res.status(500).json({ message: msg });
  }
};

// @desc    Get single room with tasks
// @route   GET /api/rooms/:id
export const getRoom = async (req, res) => {
  try {
    const room = await FlowerRoom.findById(req.params.id);

    if (!room) {
      return res.status(404).json({ message: 'Комната не найдена' });
    }

    // Получаем задачи комнаты
    const tasks = await RoomTask.find({ room: room._id })
      .populate('completedBy', 'name')
      .sort({ completed: 1, createdAt: -1 });

    // Получаем последние логи
    const recentLogs = await RoomLog.find({ room: room._id })
      .populate('user', 'name')
      .sort({ createdAt: -1 })
      .limit(10);

    res.json({
      ...room.toObject(),
      tasks,
      recentLogs
    });
  } catch (error) {
    console.error('Get room error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

// @desc    Update room
// @route   PUT /api/rooms/:id
export const updateRoom = async (req, res) => {
  try {
    const { cycleName, strain, plantsCount, startDate, floweringDays, notes, isActive, name, environment } = req.body;

    const room = await FlowerRoom.findById(req.params.id);

    if (!room) {
      return res.status(404).json({ message: 'Комната не найдена' });
    }

    if (cycleName !== undefined) {
      const perms = await req.user.getPermissions();
      if (!perms.includes('*') && !perms.includes('cycles:edit_name')) {
        return res.status(403).json({ message: 'Нет прав на изменение названия цикла' });
      }
      room.cycleName = String(cycleName).trim();
    }
    if (name !== undefined) room.name = name;
    if (strain !== undefined) room.strain = strain;
    if (plantsCount !== undefined) room.plantsCount = plantsCount;
    if (startDate !== undefined) room.startDate = startDate;
    if (floweringDays !== undefined) room.floweringDays = floweringDays;
    if (notes !== undefined) room.notes = notes;
    if (isActive !== undefined) room.isActive = isActive;
    if (environment !== undefined) room.environment = { ...room.environment, ...environment };

    await room.save();

    await createAuditLog(req, { action: 'room.update', entityType: 'FlowerRoom', entityId: room._id, details: { roomName: room.name, cycleName: room.cycleName } });
    res.json(room);
  } catch (error) {
    console.error('Update room error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

// @desc    Start new cycle in room
// @route   POST /api/rooms/:id/start
export const startCycle = async (req, res) => {
  try {
    const { cycleName, strain, plantsCount, floweringDays, notes, environment, startDate } = req.body;

    const room = await FlowerRoom.findById(req.params.id);

    if (!room) {
      return res.status(404).json({ message: 'Комната не найдена' });
    }

    // Генерируем ID для нового цикла
    const cycleId = new mongoose.Types.ObjectId();

    room.cycleName = (cycleName && String(cycleName).trim()) || '';
    room.strain = strain || '';
    room.plantsCount = plantsCount || 0;
    room.startDate = startDate ? new Date(startDate) : new Date();
    room.floweringDays = floweringDays || 56;
    room.notes = notes || '';
    room.isActive = true;
    room.currentCycleId = cycleId;
    if (environment) {
      room.environment = { ...room.environment, ...environment };
    }

    await room.save();

    // Создаём лог начала цикла
    await RoomLog.create({
      room: room._id,
      cycleId,
      type: 'cycle_start',
      title: `Начат цикл: ${strain || 'Без названия'}`,
      description: `Кустов: ${plantsCount || 0}, Дней цветения: ${floweringDays || 56}`,
      data: {
        strain,
        plantsCount,
        floweringDays
      },
      user: req.user._id,
      dayOfCycle: 1
    });

    await createAuditLog(req, { action: 'room.cycle_start', entityType: 'FlowerRoom', entityId: room._id, details: { roomName: room.name, strain, plantsCount, floweringDays } });
    res.json(room);
  } catch (error) {
    console.error('Start cycle error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

// @desc    Add note to room
// @route   POST /api/rooms/:id/note
export const addNote = async (req, res) => {
  try {
    const { note } = req.body;
    const room = await FlowerRoom.findById(req.params.id);

    if (!room) {
      return res.status(404).json({ message: 'Комната не найдена' });
    }

    // Добавляем заметку к существующим
    const timestamp = new Date().toLocaleString('ru-RU');
    const newNote = `[${timestamp}] ${note}`;
    room.notes = room.notes ? `${room.notes}\n${newNote}` : newNote;

    await room.save();

    // Логируем
    await RoomLog.create({
      room: room._id,
      cycleId: room.currentCycleId,
      type: 'note_added',
      title: 'Добавлена заметка',
      description: note,
      user: req.user._id,
      dayOfCycle: room.currentDay
    });

    res.json(room);
  } catch (error) {
    console.error('Add note error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

// @desc    End cycle in room (simple reset, for backward compatibility)
// @route   POST /api/rooms/:id/harvest
export const harvestRoom = async (req, res) => {
  try {
    const room = await FlowerRoom.findById(req.params.id);

    if (!room) {
      return res.status(404).json({ message: 'Комната не найдена' });
    }

    // Удаляем все задачи комнаты
    await RoomTask.deleteMany({ room: room._id });

    // Reset room
    room.cycleName = '';
    room.strain = '';
    room.plantsCount = 0;
    room.startDate = null;
    room.expectedHarvestDate = null;
    room.notes = '';
    room.isActive = false;
    room.currentCycleId = null;

    await room.save();

    res.json(room);
  } catch (error) {
    console.error('Harvest room error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};
