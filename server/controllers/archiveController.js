import CycleArchive from '../models/CycleArchive.js';
import FlowerRoom from '../models/FlowerRoom.js';
import RoomTask from '../models/RoomTask.js';
import RoomLog from '../models/RoomLog.js';
import VegBatch from '../models/VegBatch.js';
import CloneCut from '../models/CloneCut.js';
import { createAuditLog } from '../utils/auditLog.js';

// @desc    Get all archives
// @route   GET /api/archive
export const getArchives = async (req, res) => {
  try {
    const { roomId, strain, limit = 50, skip = 0 } = req.query;

    const query = {};
    if (roomId) query.room = roomId;
    if (strain) query.strain = new RegExp(strain, 'i');

    const archives = await CycleArchive.find(query)
      .sort({ harvestDate: -1 })
      .skip(parseInt(skip))
      .limit(parseInt(limit));

    const total = await CycleArchive.countDocuments(query);

    res.json({ archives, total });
  } catch (error) {
    console.error('Get archives error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

// @desc    Get single archive
// @route   GET /api/archive/:id
export const getArchive = async (req, res) => {
  try {
    const archive = await CycleArchive.findById(req.params.id)
      .populate('completedTasks.completedBy', 'name');

    if (!archive) {
      return res.status(404).json({ message: 'Архив не найден' });
    }

    res.json(archive);
  } catch (error) {
    console.error('Get archive error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

// @desc    Get archive statistics
// @route   GET /api/archive/stats
export const getArchiveStats = async (req, res) => {
  try {
    const { period = 'all' } = req.query;

    let dateFilter = {};
    const now = new Date();

    if (period === 'year') {
      dateFilter = { harvestDate: { $gte: new Date(now.getFullYear(), 0, 1) } };
    } else if (period === '6months') {
      const sixMonthsAgo = new Date(now);
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      dateFilter = { harvestDate: { $gte: sixMonthsAgo } };
    } else if (period === '3months') {
      const threeMonthsAgo = new Date(now);
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
      dateFilter = { harvestDate: { $gte: threeMonthsAgo } };
    }

    // Общая статистика
    const totalStats = await CycleArchive.aggregate([
      { $match: dateFilter },
      {
        $group: {
          _id: null,
          totalCycles: { $sum: 1 },
          totalPlants: { $sum: '$plantsCount' },
          totalDryWeight: { $sum: '$harvestData.dryWeight' },
          totalWetWeight: { $sum: '$harvestData.wetWeight' },
          avgDaysFlowering: { $avg: '$actualDays' },
          avgGramsPerPlant: { $avg: '$metrics.gramsPerPlant' }
        }
      }
    ]);

    // Статистика по сортам
    const strainStats = await CycleArchive.aggregate([
      { $match: dateFilter },
      {
        $group: {
          _id: '$strain',
          cycles: { $sum: 1 },
          totalWeight: { $sum: '$harvestData.dryWeight' },
          avgWeight: { $avg: '$harvestData.dryWeight' },
          avgGramsPerPlant: { $avg: '$metrics.gramsPerPlant' },
          avgDays: { $avg: '$actualDays' }
        }
      },
      { $sort: { totalWeight: -1 } },
      { $limit: 10 }
    ]);

    // Статистика по месяцам (для графика)
    const monthlyStats = await CycleArchive.aggregate([
      { $match: dateFilter },
      {
        $group: {
          _id: {
            year: { $year: '$harvestDate' },
            month: { $month: '$harvestDate' }
          },
          cycles: { $sum: 1 },
          totalWeight: { $sum: '$harvestData.dryWeight' },
          avgGramsPerPlant: { $avg: '$metrics.gramsPerPlant' }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);

    // Статистика по комнатам (room = ObjectId для привязки к комнате)
    const roomStatsByRoomId = await CycleArchive.aggregate([
      { $match: dateFilter },
      {
        $group: {
          _id: '$room',
          cycles: { $sum: 1 },
          totalWeight: { $sum: '$harvestData.dryWeight' },
          avgWeight: { $avg: '$harvestData.dryWeight' },
          totalDays: { $sum: '$actualDays' },
          avgDays: { $avg: '$actualDays' }
        }
      }
    ]);

    const roomStats = await CycleArchive.aggregate([
      { $match: dateFilter },
      {
        $group: {
          _id: '$roomNumber',
          cycles: { $sum: 1 },
          totalWeight: { $sum: '$harvestData.dryWeight' },
          avgWeight: { $avg: '$harvestData.dryWeight' },
          totalDays: { $sum: '$actualDays' },
          avgDays: { $avg: '$actualDays' }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    res.json({
      total: totalStats[0] || {
        totalCycles: 0,
        totalPlants: 0,
        totalDryWeight: 0,
        avgDaysFlowering: 0,
        avgGramsPerPlant: 0
      },
      byStrain: strainStats,
      byMonth: monthlyStats,
      byRoom: roomStats,
      byRoomId: roomStatsByRoomId
    });
  } catch (error) {
    console.error('Get archive stats error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

// @desc    Complete harvest and archive cycle
// @route   POST /api/archive/harvest/:roomId
export const harvestAndArchive = async (req, res) => {
  try {
    const { roomId } = req.params;
    const {
      cycleName,
      wetWeight,
      dryWeight,
      trimWeight,
      quality,
      harvestNotes,
      environment
    } = req.body;

    const room = await FlowerRoom.findById(roomId);
    if (!room) {
      return res.status(404).json({ message: 'Комната не найдена' });
    }

    if (!room.isActive) {
      return res.status(400).json({ message: 'Комната не активна' });
    }

    // Получаем все выполненные задачи этого цикла
    const completedTasks = await RoomTask.find({
      room: roomId,
      completed: true
    }).populate('completedBy', 'name');

    // Получаем связанную вегу (последнюю пересаженную в эту комнату)
    const vegBatch = await VegBatch.findOne({ flowerRoom: roomId })
      .sort({ transplantedToFlowerAt: -1 });

    // Получаем данные о клонах если есть вега
    let cloneData = null;
    let vegData = null;

    if (vegBatch) {
      // Данные веги
      const vegDaysActual = vegBatch.transplantedToFlowerAt && vegBatch.transplantedToVegAt
        ? Math.floor((new Date(vegBatch.transplantedToFlowerAt) - new Date(vegBatch.transplantedToVegAt)) / (1000 * 60 * 60 * 24))
        : null;

      vegData = {
        transplantedToVegAt: vegBatch.transplantedToVegAt,
        vegDaysTarget: vegBatch.vegDaysTarget,
        vegDaysActual,
        transplantedToFlowerAt: vegBatch.transplantedToFlowerAt,
        notes: vegBatch.notes || ''
      };

      // Получаем данные клонов из источника веги
      if (vegBatch.sourceCloneCut) {
        const cloneCut = await CloneCut.findById(vegBatch.sourceCloneCut);
        if (cloneCut) {
          cloneData = {
            cutDate: cloneCut.cutDate,
            quantity: cloneCut.quantity || cloneCut.strains?.reduce((sum, s) => sum + (s.quantity || 0), 0) || 0,
            strains: cloneCut.strains || [],
            notes: cloneCut.notes || ''
          };
        }
      } else {
        // Если нет прямой связи, берём из самой веги
        cloneData = {
          cutDate: vegBatch.cutDate,
          quantity: vegBatch.quantity || vegBatch.strains?.reduce((sum, s) => sum + (s.quantity || 0), 0) || 0,
          strains: vegBatch.strains || [],
          notes: ''
        };
      }
    }

    const harvestDate = new Date();
    const actualDays = room.currentDay;

    // Создаём архивную запись (название/код цикла из комнаты или из запроса)
    const archive = await CycleArchive.create({
      room: roomId,
      roomNumber: room.roomNumber,
      roomName: room.name,
      cycleName: (cycleName && String(cycleName).trim()) || room.cycleName || '',
      strain: room.strain,
      plantsCount: room.plantsCount,
      startDate: room.startDate,
      harvestDate,
      floweringDays: room.floweringDays,
      actualDays,
      harvestData: {
        wetWeight: wetWeight || 0,
        dryWeight: dryWeight || 0,
        trimWeight: trimWeight || 0,
        quality: quality || 'medium',
        notes: harvestNotes || ''
      },
      metrics: {
        gramsPerPlant: room.plantsCount > 0 ? Math.round((dryWeight || 0) / room.plantsCount) : 0,
        gramsPerDay: actualDays > 0 ? Math.round((dryWeight || 0) / actualDays * 10) / 10 : 0
      },
      environment: environment || room.environment,
      notes: room.notes,
      cloneData,
      vegData,
      completedTasks: completedTasks.map(t => ({
        type: t.type,
        title: t.title,
        description: t.description,
        completedAt: t.completedAt,
        completedBy: t.completedBy?._id,
        dayOfCycle: t.dayOfCycle,
        sprayProduct: t.sprayProduct,
        feedProduct: t.feedProduct,
        feedDosage: t.feedDosage
      }))
    });

    // Создаём лог завершения цикла
    await RoomLog.create({
      room: roomId,
      cycleId: archive._id,
      type: 'cycle_end',
      title: `Урожай собран: ${room.strain}`,
      description: `Сухой вес: ${dryWeight || 0}г, Качество: ${quality || 'medium'}`,
      data: {
        archiveId: archive._id,
        dryWeight,
        wetWeight,
        actualDays
      },
      user: req.user._id,
      dayOfCycle: actualDays
    });

    // Удаляем все задачи комнаты
    await RoomTask.deleteMany({ room: roomId });

    // Сбрасываем комнату (переходим в «Планируется»)
    room.cycleName = '';
    room.strain = '';
    room.plantsCount = 0;
    room.startDate = null;
    room.expectedHarvestDate = null;
    room.notes = '';
    room.isActive = false;
    room.currentCycleId = null;
    room.totalCycles += 1;

    await room.save();

    await createAuditLog(req, {
      action: 'harvest.archive',
      entityType: 'CycleArchive',
      entityId: archive._id,
      details: { roomId, roomName: room.name, dryWeight, wetWeight, cycleName: archive.cycleName }
    });
    res.json({ archive, room });
  } catch (error) {
    console.error('Harvest and archive error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

// @desc    Update archive (add notes, correct data) — веса только с правом harvest:edit_weights
// @route   PUT /api/archive/:id
export const updateArchive = async (req, res) => {
  try {
    const { harvestData, issues, notes } = req.body;

    const archive = await CycleArchive.findById(req.params.id);

    if (!archive) {
      return res.status(404).json({ message: 'Архив не найден' });
    }

    if (harvestData) {
      const perms = await req.user.getPermissions();
      const hasWeightEdit = perms.includes('*') || perms.includes('harvest:edit_weights');
      if (!hasWeightEdit && (harvestData.wetWeight !== undefined || harvestData.dryWeight !== undefined || harvestData.trimWeight !== undefined)) {
        return res.status(403).json({ message: 'Нет прав на изменение весов при сборе урожая' });
      }
      archive.harvestData = { ...archive.harvestData, ...harvestData };
      // Пересчитываем метрики
      if (harvestData.dryWeight !== undefined) {
        archive.metrics.gramsPerPlant = archive.plantsCount > 0
          ? Math.round(harvestData.dryWeight / archive.plantsCount)
          : 0;
        archive.metrics.gramsPerDay = archive.actualDays > 0
          ? Math.round(harvestData.dryWeight / archive.actualDays * 10) / 10
          : 0;
      }
    }
    if (issues) archive.issues = issues;
    if (notes !== undefined) archive.notes = notes;

    await archive.save();

    await createAuditLog(req, { action: 'archive.update', entityType: 'CycleArchive', entityId: archive._id, details: { harvestData: !!harvestData } });
    res.json(archive);
  } catch (error) {
    console.error('Update archive error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

// @desc    Delete archive
// @route   DELETE /api/archive/:id
export const deleteArchive = async (req, res) => {
  try {
    const archive = await CycleArchive.findById(req.params.id);

    if (!archive) {
      return res.status(404).json({ message: 'Архив не найден' });
    }

    await archive.deleteOne();

    res.json({ message: 'Архив удалён' });
  } catch (error) {
    console.error('Delete archive error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

// @desc    Get room history (logs)
// @route   GET /api/archive/logs/:roomId
export const getRoomLogs = async (req, res) => {
  try {
    const { roomId } = req.params;
    const { cycleId, limit = 50 } = req.query;

    const query = { room: roomId };
    if (cycleId) query.cycleId = cycleId;

    const logs = await RoomLog.find(query)
      .populate('user', 'name')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit));

    res.json(logs);
  } catch (error) {
    console.error('Get room logs error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};
