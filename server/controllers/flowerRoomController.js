import FlowerRoom from '../models/FlowerRoom.js';
import RoomTask from '../models/RoomTask.js';
import RoomLog from '../models/RoomLog.js';
import CycleArchive from '../models/CycleArchive.js';
import PlannedCycle from '../models/PlannedCycle.js';
import HarvestSession from '../models/HarvestSession.js';
import CloneCut from '../models/CloneCut.js';
import VegBatch from '../models/VegBatch.js';
import mongoose from 'mongoose';
import { createAuditLog } from '../utils/auditLog.js';
import { notDeleted } from '../utils/softDelete.js';
import { applyDefaultProtocol } from './treatmentController.js';
import RoomTreatmentSchedule from '../models/RoomTreatmentSchedule.js';
import { t } from '../utils/i18n.js';

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
    res.status(500).json({ message: t('common.serverError', req.lang) });
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
      // Фильтр задач по текущему циклу (если есть cycleId)
      const cycleFilter = room.currentCycleId ? { cycleId: room.currentCycleId } : {};
      const [completedTasksRaw, pendingTasksRaw, lastArchive, plannedCyclesRaw, cloneCutsRaw, vegBatchesRaw] = await Promise.all([
        RoomTask.find({ room: roomId, completed: true, ...cycleFilter, ...notDeleted }).lean(),
        RoomTask.find({ room: roomId, completed: false, ...notDeleted }).lean(),
        CycleArchive.findOne({ room: roomId }).sort({ harvestDate: -1 }).lean(),
        PlannedCycle.find({ room: roomId, $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }] }).sort({ order: 1 }).lean(),
        CloneCut.find({ room: roomId, isDone: { $ne: true }, $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }] }).lean(),
        VegBatch.find({ flowerRoom: roomId, transplantedToFlowerAt: null, $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }] }).lean()
      ]);
      const plannedCycle = plannedCyclesRaw.find(p => (p.order ?? 0) === 0) || plannedCyclesRaw[0] || null;

      // Build "pipeline" batches: individual clone-cut / veg-batch entries in motion
      // toward this room's next cycle. Batches are atomic — each one is meant for ONE
      // upcoming cycle; leftovers after assignment are just disposed of, not carried over.
      const vegSourceCutIds = new Set(
        vegBatchesRaw.map(b => b.sourceCloneCut?.toString()).filter(Boolean)
      );
      const activeCuts = cloneCutsRaw.filter(c => !vegSourceCutIds.has(c._id.toString()));

      const pipelineBatches = [];

      for (const c of activeCuts) {
        const cutDate = c.cutDate || c.createdAt || null;
        if (Array.isArray(c.strains) && c.strains.length > 0) {
          for (const s of c.strains) {
            const q = Number(s.quantity) || 0;
            if (q <= 0) continue;
            pipelineBatches.push({
              _id: `${c._id}:${s.strain || ''}`,
              kind: 'cut',
              strain: (s.strain || '').trim(),
              quantity: q,
              cutDate,
            });
          }
        } else {
          const q = Number(c.quantity) || 0;
          if (q > 0) {
            pipelineBatches.push({
              _id: String(c._id),
              kind: 'cut',
              strain: (c.strain || '').trim(),
              quantity: q,
              cutDate,
            });
          }
        }
      }

      for (const v of vegBatchesRaw) {
        const totalQty = Number(v.quantity) || 0;
        const sent = Number(v.sentToFlowerCount) || 0;
        const died = Number(v.diedCount) || 0;
        const disposed = Number(v.disposedCount) || 0;
        const remaining = Math.max(0, totalQty - sent - died - disposed);
        if (remaining <= 0) continue;
        const cutDate = v.cutDate || v.transplantedToVegAt || v.createdAt || null;

        if (Array.isArray(v.strains) && v.strains.length > 0) {
          const strainsTotal = v.strains.reduce((s, x) => s + (Number(x.quantity) || 0), 0);
          for (const s of v.strains) {
            const share = strainsTotal > 0 ? (Number(s.quantity) || 0) / strainsTotal : 0;
            const q = Math.round(remaining * share);
            if (q <= 0) continue;
            pipelineBatches.push({
              _id: `${v._id}:${s.strain || ''}`,
              kind: 'veg',
              strain: (s.strain || '').trim(),
              quantity: q,
              cutDate,
              transplantedToVegAt: v.transplantedToVegAt || null,
            });
          }
        } else {
          pipelineBatches.push({
            _id: String(v._id),
            kind: 'veg',
            strain: (v.strain || '').trim(),
            quantity: remaining,
            cutDate,
            transplantedToVegAt: v.transplantedToVegAt || null,
          });
        }
      }

      // Sort batches oldest-first so earlier cycles pick them up first
      pipelineBatches.sort((a, b) => {
        const da = a.cutDate ? new Date(a.cutDate).getTime() : 0;
        const db = b.cutDate ? new Date(b.cutDate).getTime() : 0;
        return da - db;
      });

      const pipeline = { batches: pipelineBatches };
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
          order: plannedCycle.order ?? 0,
          notes: plannedCycle.notes
        } : null,
        plannedCycles: plannedCyclesRaw.map(pc => ({
          _id: pc._id,
          cycleName: pc.cycleName,
          strain: pc.strain,
          plannedStartDate: pc.plannedStartDate,
          plantsCount: pc.plantsCount,
          floweringDays: pc.floweringDays,
          order: pc.order ?? 0,
          notes: pc.notes
        })),
        pipeline
      };
    }));
    res.json(summary);
  } catch (error) {
    console.error('Get rooms summary error:', error);
    res.status(500).json({ message: t('common.serverError', req.lang) });
  }
};

// @desc    Get single room with tasks
// @route   GET /api/rooms/:id
export const getRoom = async (req, res) => {
  try {
    const room = await FlowerRoom.findById(req.params.id);

    if (!room) {
      return res.status(404).json({ message: t('rooms.notFound', req.lang) });
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
    res.status(500).json({ message: t('common.serverError', req.lang) });
  }
};

// @desc    Update room
// @route   PUT /api/rooms/:id
export const updateRoom = async (req, res) => {
  try {
    const { cycleName, strain, plantsCount, startDate, floweringDays, notes, isActive, name, environment, squareMeters, lighting, roomDimensions, potSize, ventilation, roomLayout } = req.body;

    const room = await FlowerRoom.findById(req.params.id);

    if (!room) {
      return res.status(404).json({ message: t('rooms.notFound', req.lang) });
    }

    if (cycleName !== undefined) {
      const perms = await req.user.getPermissions();
      if (!perms.includes('*') && !perms.includes('cycles:edit_name')) {
        return res.status(403).json({ message: t('rooms.noPermissionCycleName', req.lang) });
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
    if (squareMeters !== undefined) room.squareMeters = squareMeters;
    if (lighting !== undefined) room.lighting = { ...(room.lighting?.toObject?.() || {}), ...lighting };
    if (roomDimensions !== undefined) room.roomDimensions = { ...(room.roomDimensions?.toObject?.() || {}), ...roomDimensions };
    if (potSize !== undefined) room.potSize = potSize;
    if (ventilation !== undefined) room.ventilation = { ...(room.ventilation?.toObject?.() || {}), ...ventilation };
    if (roomLayout !== undefined) room.roomLayout = roomLayout;

    await room.save();

    await createAuditLog(req, { action: 'room.update', entityType: 'FlowerRoom', entityId: room._id, details: { roomName: room.name, cycleName: room.cycleName } });
    res.json(room);
  } catch (error) {
    console.error('Update room error:', error);
    res.status(500).json({ message: t('common.serverError', req.lang) });
  }
};

// @desc    Start new cycle in room
// @route   POST /api/rooms/:id/start
export const startCycle = async (req, res) => {
  try {
    const { cycleName, strain, plantsCount, floweringDays, notes, environment, startDate, flowerStrains } = req.body;

    const room = await FlowerRoom.findById(req.params.id);

    if (!room) {
      return res.status(404).json({ message: t('rooms.notFound', req.lang) });
    }

    if (room.isActive) {
      return res.status(400).json({ message: t('rooms.cycleAlreadyActive', req.lang) });
    }

    // Генерируем ID для нового цикла
    const cycleId = new mongoose.Types.ObjectId();

    room.cycleName = (cycleName && String(cycleName).trim()) || '';
    room.strain = strain || '';
    room.plantsCount = plantsCount || 0;
    if (flowerStrains !== undefined && Array.isArray(flowerStrains) && flowerStrains.length > 0) {
      room.flowerStrains = flowerStrains
        .filter((s) => s && (s.strain !== undefined || s.quantity > 0))
        .map((s) => ({ strain: String(s.strain || '').trim(), quantity: Math.max(0, parseInt(s.quantity, 10) || 0) }));
      // Вычисляем диапазоны номеров кустов последовательно по сортам
      let currentStart = 1;
      for (const fs of room.flowerStrains) {
        if (fs.quantity > 0) {
          fs.startNumber = currentStart;
          fs.endNumber = currentStart + fs.quantity - 1;
          currentStart = fs.endNumber + 1;
        }
      }
      // Auto-compute plantsCount и legacy strain
      room.plantsCount = room.flowerStrains.reduce((sum, fs) => sum + fs.quantity, 0);
      if (!room.strain) {
        room.strain = room.flowerStrains.map(s => s.strain).filter(Boolean).join(' / ');
      }
    } else {
      room.flowerStrains = [];
    }
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

    // Auto-apply default flower treatment protocol
    await applyDefaultProtocol('flower', 'FlowerRoom', room._id, cycleId);

    await createAuditLog(req, { action: 'room.cycle_start', entityType: 'FlowerRoom', entityId: room._id, details: { roomName: room.name, strain, plantsCount, floweringDays } });
    res.json(room);
  } catch (error) {
    console.error('Start cycle error:', error);
    res.status(500).json({ message: t('common.serverError', req.lang) });
  }
};

// @desc    Add note to room
// @route   POST /api/rooms/:id/note
export const addNote = async (req, res) => {
  try {
    const { note } = req.body;
    const room = await FlowerRoom.findById(req.params.id);

    if (!room) {
      return res.status(404).json({ message: t('rooms.notFound', req.lang) });
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

    await createAuditLog(req, { action: 'room.note', entityType: 'FlowerRoom', entityId: room._id, details: { roomName: room.name, note: note?.substring(0, 100) } });
    res.json(room);
  } catch (error) {
    console.error('Add note error:', error);
    res.status(500).json({ message: t('common.serverError', req.lang) });
  }
};

// @desc    End cycle in room (simple reset, for backward compatibility)
// @route   POST /api/rooms/:id/harvest
export const harvestRoom = async (req, res) => {
  try {
    const room = await FlowerRoom.findById(req.params.id);

    if (!room) {
      return res.status(404).json({ message: t('rooms.notFound', req.lang) });
    }

    // Deactivate treatment schedules
    await RoomTreatmentSchedule.updateMany(
      { targetType: 'FlowerRoom', targetId: room._id, isActive: true },
      { $set: { isActive: false } }
    );

    // Мягкое удаление задач комнаты
    await RoomTask.updateMany(
      { room: room._id, deletedAt: null },
      { $set: { deletedAt: new Date() } }
    );

    // Reset room
    room.cycleName = '';
    room.strain = '';
    room.plantsCount = 0;
    room.startDate = null;
    room.expectedHarvestDate = null;
    room.notes = '';
    room.isActive = false;
    room.currentCycleId = null;
    // Очистить позиции кустов (сетка остаётся)
    if (room.roomLayout) {
      room.roomLayout.plantPositions = [];
    }

    await room.save();

    await createAuditLog(req, { action: 'room.harvest_reset', entityType: 'FlowerRoom', entityId: room._id, details: { roomName: room.name } });
    res.json(room);
  } catch (error) {
    console.error('Harvest room error:', error);
    res.status(500).json({ message: t('common.serverError', req.lang) });
  }
};

// @desc    Transfer active cycle from one room to another (full or partial)
// @route   POST /api/rooms/:sourceId/transfer/:targetId
// @body    { reason, transferStrains?: [{ strain, quantity }] }
export const transferCycle = async (req, res) => {
  try {
    const { sourceId, targetId } = req.params;
    const { reason, transferStrains } = req.body;

    // Validate IDs
    if (!mongoose.Types.ObjectId.isValid(sourceId) || !mongoose.Types.ObjectId.isValid(targetId)) {
      return res.status(400).json({ message: t('rooms.invalidRoomId', req.lang) });
    }
    if (sourceId === targetId) {
      return res.status(400).json({ message: t('rooms.sameRoom', req.lang) });
    }

    // Load both rooms
    const [sourceRoom, targetRoom] = await Promise.all([
      FlowerRoom.findById(sourceId),
      FlowerRoom.findById(targetId)
    ]);

    if (!sourceRoom) return res.status(404).json({ message: t('rooms.sourceNotFound', req.lang) });
    if (!targetRoom) return res.status(404).json({ message: t('rooms.targetNotFound', req.lang) });

    // Validate states
    if (!sourceRoom.isActive) {
      return res.status(400).json({ message: t('rooms.sourceNotActive', req.lang) });
    }
    if (targetRoom.isActive) {
      return res.status(400).json({ message: t('rooms.targetAlreadyActive', req.lang) });
    }

    // Check no active harvest session
    const activeHarvest = await HarvestSession.findOne({
      room: sourceId,
      status: 'in_progress'
    });
    if (activeHarvest) {
      // Auto-close stale harvest session to allow transfer
      activeHarvest.status = 'completed';
      activeHarvest.completedAt = new Date();
      await activeHarvest.save();
    }

    const cycleId = sourceRoom.currentCycleId;
    const currentDay = sourceRoom.currentDay;
    const sourceRoomName = sourceRoom.name;
    const targetRoomName = targetRoom.name;
    const originalPlantsCount = sourceRoom.plantsCount;

    // Determine transferred vs disposed strains
    const isPartial = Array.isArray(transferStrains) && transferStrains.length > 0;
    let targetFlowerStrains;
    let transferredTotal = 0;
    let disposedTotal = 0;
    const transferDetails = [];

    if (isPartial) {
      // Build a map of transfer quantities by strain name
      const transferMap = new Map(
        transferStrains.map(s => [String(s.strain || '').trim(), Math.max(0, parseInt(s.quantity, 10) || 0)])
      );

      // Validate and build target strains
      targetFlowerStrains = [];
      for (const original of (sourceRoom.flowerStrains || [])) {
        const strainName = original.strain || '';
        const origQty = original.quantity || 0;
        const transferQty = Math.min(transferMap.get(strainName) || 0, origQty);
        const disposedQty = origQty - transferQty;

        transferDetails.push({ strain: strainName, original: origQty, transferred: transferQty, disposed: disposedQty });
        transferredTotal += transferQty;
        disposedTotal += disposedQty;

        if (transferQty > 0) {
          targetFlowerStrains.push({ strain: strainName, quantity: transferQty });
        }
      }

      if (transferredTotal === 0) {
        return res.status(400).json({ message: t('rooms.transferAtLeastOne', req.lang) });
      }

      // Recalculate sequential numbering for target
      let currentStart = 1;
      for (const fs of targetFlowerStrains) {
        fs.startNumber = currentStart;
        fs.endNumber = currentStart + fs.quantity - 1;
        currentStart = fs.endNumber + 1;
      }
    } else {
      // Full transfer — copy everything
      targetFlowerStrains = (sourceRoom.flowerStrains || []).map(s => ({
        strain: s.strain, quantity: s.quantity, startNumber: s.startNumber, endNumber: s.endNumber
      }));
      transferredTotal = originalPlantsCount;

      for (const s of (sourceRoom.flowerStrains || [])) {
        transferDetails.push({ strain: s.strain || '', original: s.quantity || 0, transferred: s.quantity || 0, disposed: 0 });
      }
    }

    // Transfer cycle data to target room
    targetRoom.cycleName = sourceRoom.cycleName;
    targetRoom.strain = targetFlowerStrains.map(s => s.strain).filter(Boolean).join(' / ') || sourceRoom.strain;
    targetRoom.plantsCount = transferredTotal;
    targetRoom.flowerStrains = targetFlowerStrains;
    targetRoom.startDate = sourceRoom.startDate;
    targetRoom.floweringDays = sourceRoom.floweringDays;
    targetRoom.currentCycleId = cycleId;
    targetRoom.notes = sourceRoom.notes;
    targetRoom.isActive = true;
    targetRoom.environment = sourceRoom.environment;

    // Reset source room
    sourceRoom.cycleName = '';
    sourceRoom.strain = '';
    sourceRoom.plantsCount = 0;
    sourceRoom.flowerStrains = [];
    sourceRoom.startDate = null;
    sourceRoom.expectedHarvestDate = null;
    sourceRoom.notes = '';
    sourceRoom.isActive = false;
    sourceRoom.currentCycleId = null;
    if (sourceRoom.roomLayout) {
      sourceRoom.roomLayout.plantPositions = [];
    }

    // Save both rooms (target first for safety)
    await targetRoom.save();
    await sourceRoom.save();

    // Transfer tasks and logs to target room
    await RoomTask.updateMany(
      { room: sourceId, cycleId: cycleId },
      { $set: { room: targetId } }
    );
    await RoomLog.updateMany(
      { room: sourceId, cycleId: cycleId },
      { $set: { room: targetId } }
    );

    // Archive old CloneCut records in target room (from previous cycles)
    await CloneCut.updateMany(
      { room: targetId, deletedAt: null },
      { $set: { deletedAt: new Date() } }
    );

    // Transfer CloneCut records from source room to target room
    await CloneCut.updateMany(
      { room: sourceId, deletedAt: null },
      { $set: { room: targetId } }
    );

    // Build log description
    const reasonText = reason || t('rooms.noReason', req.lang);
    const transferSummary = transferDetails
      .map(d => `${d.strain || '—'}: ${d.transferred}/${d.original}` + (d.disposed > 0 ? ` (списано ${d.disposed})` : ''))
      .join(', ');
    const logDescription = disposedTotal > 0
      ? `${reasonText}\nПеренесено ${transferredTotal} из ${originalPlantsCount} кустов (списано ${disposedTotal}): ${transferSummary}`
      : reasonText;

    await RoomLog.create({
      room: sourceId,
      cycleId: null,
      type: 'cycle_transfer',
      title: `Цикл перенесён в ${targetRoomName}`,
      description: logDescription,
      data: { targetRoomId: targetId, targetRoomName, transferredCycleId: cycleId, transferDetails },
      user: req.user._id,
      dayOfCycle: currentDay
    });

    await RoomLog.create({
      room: targetId,
      cycleId: cycleId,
      type: 'cycle_transfer',
      title: `Цикл принят из ${sourceRoomName}`,
      description: logDescription,
      data: { sourceRoomId: sourceId, sourceRoomName, transferredCycleId: cycleId, transferDetails },
      user: req.user._id,
      dayOfCycle: currentDay
    });

    // Audit log
    await createAuditLog(req, {
      action: 'room.cycle_transfer',
      entityType: 'FlowerRoom',
      entityId: sourceId,
      details: {
        sourceRoom: sourceRoomName,
        targetRoom: targetRoomName,
        cycleName: targetRoom.cycleName,
        strain: targetRoom.strain,
        reason: reasonText,
        dayOfCycle: currentDay,
        transferred: transferredTotal,
        disposed: disposedTotal,
        transferDetails
      }
    });

    res.json({
      source: sourceRoom,
      target: targetRoom,
      message: `Цикл перенесён из ${sourceRoomName} в ${targetRoomName}` + (disposedTotal > 0 ? ` (списано ${disposedTotal} кустов)` : '')
    });
  } catch (error) {
    console.error('Transfer cycle error:', error);
    res.status(500).json({ message: t('common.serverError', req.lang) });
  }
};
