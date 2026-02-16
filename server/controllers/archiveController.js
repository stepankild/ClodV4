import mongoose from 'mongoose';
import CycleArchive from '../models/CycleArchive.js';
import FlowerRoom from '../models/FlowerRoom.js';
import RoomTask from '../models/RoomTask.js';
import RoomLog from '../models/RoomLog.js';
import VegBatch from '../models/VegBatch.js';
import CloneCut from '../models/CloneCut.js';
import TrimLog from '../models/TrimLog.js';
import { createAuditLog } from '../utils/auditLog.js';
import { notDeleted, deletedOnly } from '../utils/softDelete.js';

// @desc    Get all archives
// @route   GET /api/archive
export const getArchives = async (req, res) => {
  try {
    const { roomId, strain, limit = 50, skip = 0 } = req.query;

    const query = { ...notDeleted };
    if (roomId) query.room = roomId;
    if (strain) query.strain = new RegExp(strain, 'i');

    const archives = await CycleArchive.find(query)
      .sort({ harvestDate: -1 })
      .skip(parseInt(skip))
      .limit(parseInt(limit))
      .lean();

    // Attach trim weight totals + date range from TrimLog
    const archiveIds = archives.map((a) => a._id);
    const trimAgg = await TrimLog.aggregate([
      { $match: { archive: { $in: archiveIds }, $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }] } },
      { $group: {
        _id: '$archive',
        totalTrimWeight: { $sum: '$weight' },
        trimEntries: { $sum: 1 },
        firstTrimDate: { $min: '$date' },
        lastTrimDate: { $max: '$date' }
      } }
    ]);
    const trimMap = new Map(trimAgg.map((t) => [String(t._id), t]));
    for (const a of archives) {
      const t = trimMap.get(String(a._id));
      a.trimLogWeight = t?.totalTrimWeight || 0;
      a.trimLogEntries = t?.trimEntries || 0;
      a.firstTrimDate = t?.firstTrimDate || null;
      a.lastTrimDate = t?.lastTrimDate || null;
    }

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
    const archive = await CycleArchive.findOne({ _id: req.params.id, ...notDeleted })
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
      { $match: { $and: [dateFilter, { $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }] }] } },
      {
        $group: {
          _id: null,
          totalCycles: { $sum: 1 },
          totalPlants: { $sum: '$plantsCount' },
          totalDryWeight: { $sum: '$harvestData.dryWeight' },
          totalWetWeight: { $sum: '$harvestData.wetWeight' },
          avgDaysFlowering: { $avg: '$actualDays' },
          avgGramsPerPlant: { $avg: '$metrics.gramsPerPlant' },
          avgGramsPerWatt: { $avg: '$metrics.gramsPerWatt' },
          avgGramsPerDay: { $avg: '$metrics.gramsPerDay' }
        }
      }
    ]);

    // Статистика по сортам
    const strainStats = await CycleArchive.aggregate([
      { $match: { $and: [dateFilter, { $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }] }] } },
      {
        $group: {
          _id: '$strain',
          cycles: { $sum: 1 },
          totalWeight: { $sum: '$harvestData.dryWeight' },
          avgWeight: { $avg: '$harvestData.dryWeight' },
          avgGramsPerPlant: { $avg: '$metrics.gramsPerPlant' },
          avgGramsPerWatt: { $avg: '$metrics.gramsPerWatt' },
          avgDays: { $avg: '$actualDays' }
        }
      },
      { $sort: { totalWeight: -1 } }
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
          avgGramsPerPlant: { $avg: '$metrics.gramsPerPlant' },
          avgGramsPerWatt: { $avg: '$metrics.gramsPerWatt' }
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

    // Total trim weight from TrimLog
    const trimTotalAgg = await TrimLog.aggregate([
      { $match: { $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }] } },
      { $group: { _id: null, totalTrimWeight: { $sum: '$weight' }, totalTrimEntries: { $sum: 1 } } }
    ]);

    const totalData = totalStats[0] || {
      totalCycles: 0,
      totalPlants: 0,
      totalDryWeight: 0,
      totalWetWeight: 0,
      avgDaysFlowering: 0,
      avgGramsPerPlant: 0,
      avgGramsPerWatt: 0,
      avgGramsPerDay: 0
    };
    totalData.totalTrimWeight = trimTotalAgg[0]?.totalTrimWeight || 0;
    totalData.totalTrimEntries = trimTotalAgg[0]?.totalTrimEntries || 0;

    res.json({
      total: totalData,
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

      // Количество клонов для этого цикла: sentToFlowerCount > initialQuantity > vegBatch.quantity
      const cycleCloneCount = vegBatch.sentToFlowerCount
        || vegBatch.initialQuantity
        || vegBatch.quantity
        || 0;
      const cycleCloneStrains = (vegBatch.sentToFlowerStrains?.length > 0)
        ? vegBatch.sentToFlowerStrains
        : vegBatch.strains || [];

      // Получаем данные клонов из источника веги
      if (vegBatch.sourceCloneCut) {
        const cloneCut = await CloneCut.findById(vegBatch.sourceCloneCut);
        if (cloneCut) {
          cloneData = {
            cutDate: cloneCut.cutDate,
            quantity: cycleCloneCount || cloneCut.strains?.reduce((sum, s) => sum + (s.quantity || 0), 0) || 0,
            strains: cycleCloneStrains.length > 0 ? cycleCloneStrains : (cloneCut.strains || []),
            notes: cloneCut.notes || ''
          };
        }
      } else {
        // Если нет прямой связи, берём из самой веги
        cloneData = {
          cutDate: vegBatch.cutDate,
          quantity: cycleCloneCount || vegBatch.strains?.reduce((sum, s) => sum + (s.quantity || 0), 0) || 0,
          strains: cycleCloneStrains,
          notes: ''
        };
      }
    }

    const harvestDate = new Date();
    const actualDays = room.currentDay;

    const totalWatts = (room.lighting?.lampCount && room.lighting?.lampWattage)
      ? room.lighting.lampCount * room.lighting.lampWattage : null;

    // Собираем список сортов из flowerStrains или из основного strain
    const strainsList = (room.flowerStrains && room.flowerStrains.length > 0)
      ? room.flowerStrains.map(s => s.strain || '').filter(Boolean)
      : [room.strain || '—'];
    const uniqueStrains = [...new Set(strainsList)];

    const strainDataArr = (room.flowerStrains && room.flowerStrains.length > 0)
      ? room.flowerStrains.map(s => ({
          strain: s.strain || '—',
          wetWeight: 0,
          dryWeight: 0,
          popcornWeight: 0
        }))
      : [{ strain: room.strain || '—', wetWeight: wetWeight || 0, dryWeight: dryWeight || 0, popcornWeight: 0 }];

    // Защита от дублей: если архив с этой комнатой и startDate уже существует — не создаём
    const existingArchive = await CycleArchive.findOne({
      room: roomId,
      startDate: room.startDate,
      $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }]
    });
    if (existingArchive) {
      return res.status(409).json({
        message: 'Архив для этого цикла уже существует',
        archive: existingArchive
      });
    }

    // Снимок карты комнаты (позиции кустов)
    const harvestMapData = {
      customRows: (room.roomLayout?.customRows || []).map(r => ({
        name: r.name || '',
        cols: r.cols || 4,
        rows: r.rows || 1,
        fillDirection: r.fillDirection || 'topDown'
      })),
      plants: (room.roomLayout?.plantPositions || []).map(pp => ({
        plantNumber: pp.plantNumber,
        row: pp.row,
        position: pp.position,
        strain: pp.strain || '',
        wetWeight: 0
      }))
    };

    // Создаём архивную запись
    const archive = await CycleArchive.create({
      room: roomId,
      roomNumber: room.roomNumber,
      roomName: room.name,
      squareMeters: room.squareMeters || null,
      lighting: {
        lampCount: room.lighting?.lampCount || null,
        lampWattage: room.lighting?.lampWattage || null,
        lampType: room.lighting?.lampType || null,
        totalWatts
      },
      cycleName: (cycleName && String(cycleName).trim()) || room.cycleName || '',
      strain: room.strain,
      plantsCount: room.plantsCount,
      startDate: room.startDate,
      harvestDate,
      floweringDays: room.floweringDays,
      actualDays,
      strains: uniqueStrains,
      strainData: strainDataArr,
      harvestData: {
        wetWeight: wetWeight || 0,
        dryWeight: dryWeight || 0,
        trimWeight: trimWeight || 0,
        quality: quality || 'medium',
        notes: harvestNotes || ''
      },
      metrics: {
        gramsPerPlant: room.plantsCount > 0 ? Math.round((dryWeight || 0) / room.plantsCount) : 0,
        gramsPerDay: actualDays > 0 ? Math.round((dryWeight || 0) / actualDays * 10) / 10 : 0,
        gramsPerWatt: (totalWatts && dryWeight > 0) ? Math.round((dryWeight / totalWatts) * 100) / 100 : 0
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
      })),
      harvestMapData
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

    // Мягкое удаление всех задач комнаты
    await RoomTask.updateMany(
      { room: roomId, deletedAt: null },
      { $set: { deletedAt: new Date() } }
    );

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
    // Очистить позиции кустов (сетка остаётся)
    if (room.roomLayout) {
      room.roomLayout.plantPositions = [];
    }

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

    const archive = await CycleArchive.findOne({ _id: req.params.id, ...notDeleted });

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
        archive.metrics.gramsPerWatt = (archive.lighting?.totalWatts > 0 && harvestData.dryWeight > 0)
          ? Math.round(harvestData.dryWeight / archive.lighting.totalWatts * 100) / 100
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
    const archive = await CycleArchive.findOne({ _id: req.params.id, ...notDeleted });

    if (!archive) {
      return res.status(404).json({ message: 'Архив не найден' });
    }

    const roomId = archive.room?.toString?.() || archive.room;
    await createAuditLog(req, { action: 'archive.delete', entityType: 'CycleArchive', entityId: archive._id, details: { cycleName: archive.cycleName, roomId, harvestDate: archive.harvestDate } });
    archive.deletedAt = new Date();
    await archive.save();

    res.json({ message: 'Архив удалён (можно восстановить)' });
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

// @desc    Get detailed stats for a specific strain
// @route   GET /api/archive/stats/strain/:strain
export const getStrainDetailStats = async (req, res) => {
  try {
    const strainName = decodeURIComponent(req.params.strain);
    const { period = 'all' } = req.query;

    let dateFilter = {};
    const now = new Date();
    if (period === 'year') {
      dateFilter = { harvestDate: { $gte: new Date(now.getFullYear(), 0, 1) } };
    } else if (period === '6months') {
      const d = new Date(now); d.setMonth(d.getMonth() - 6);
      dateFilter = { harvestDate: { $gte: d } };
    } else if (period === '3months') {
      const d = new Date(now); d.setMonth(d.getMonth() - 3);
      dateFilter = { harvestDate: { $gte: d } };
    }

    const baseMatch = {
      strain: strainName,
      ...dateFilter,
      $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }]
    };

    // All cycles for this strain, chronological
    const cycles = await CycleArchive.find(baseMatch)
      .sort({ harvestDate: 1 })
      .select('cycleName roomName roomNumber plantsCount harvestDate startDate actualDays harvestData metrics environment strains strainData quality')
      .lean();

    if (cycles.length === 0) {
      return res.json({ strain: strainName, summary: null, cycles: [], byRoom: [] });
    }

    // Summary aggregation
    const summaryAgg = await CycleArchive.aggregate([
      { $match: baseMatch },
      {
        $group: {
          _id: null,
          totalCycles: { $sum: 1 },
          totalPlants: { $sum: '$plantsCount' },
          totalDryWeight: { $sum: '$harvestData.dryWeight' },
          totalWetWeight: { $sum: '$harvestData.wetWeight' },
          avgDryPerCycle: { $avg: '$harvestData.dryWeight' },
          avgGramsPerPlant: { $avg: '$metrics.gramsPerPlant' },
          avgGramsPerWatt: { $avg: '$metrics.gramsPerWatt' },
          avgDays: { $avg: '$actualDays' },
          maxDry: { $max: '$harvestData.dryWeight' },
          minDry: { $min: '$harvestData.dryWeight' },
          maxGpp: { $max: '$metrics.gramsPerPlant' },
          minGpp: { $min: '$metrics.gramsPerPlant' }
        }
      }
    ]);

    const s = summaryAgg[0];

    // Best & worst cycle
    const bestCycle = cycles.reduce((best, c) =>
      (c.metrics?.gramsPerPlant || 0) > (best.metrics?.gramsPerPlant || 0) ? c : best, cycles[0]);
    const worstCycle = cycles.reduce((worst, c) =>
      (c.metrics?.gramsPerPlant || 0) < (worst.metrics?.gramsPerPlant || 0) ? c : worst, cycles[0]);

    // Trend: compare avg of last 3 cycles vs first 3 cycles
    let trend = 'stable';
    if (cycles.length >= 4) {
      const first3 = cycles.slice(0, 3);
      const last3 = cycles.slice(-3);
      const avgFirst = first3.reduce((sum, c) => sum + (c.metrics?.gramsPerPlant || 0), 0) / first3.length;
      const avgLast = last3.reduce((sum, c) => sum + (c.metrics?.gramsPerPlant || 0), 0) / last3.length;
      if (avgLast > avgFirst * 1.1) trend = 'up';
      else if (avgLast < avgFirst * 0.9) trend = 'down';
    }

    // By room breakdown
    const byRoom = await CycleArchive.aggregate([
      { $match: baseMatch },
      {
        $group: {
          _id: { room: '$room', roomName: '$roomName', roomNumber: '$roomNumber' },
          cycles: { $sum: 1 },
          totalWeight: { $sum: '$harvestData.dryWeight' },
          avgGramsPerPlant: { $avg: '$metrics.gramsPerPlant' },
          avgDays: { $avg: '$actualDays' }
        }
      },
      { $sort: { totalWeight: -1 } }
    ]);

    res.json({
      strain: strainName,
      summary: {
        totalCycles: s.totalCycles,
        totalPlants: s.totalPlants,
        totalDryWeight: s.totalDryWeight,
        totalWetWeight: s.totalWetWeight,
        avgDryPerCycle: Math.round(s.avgDryPerCycle || 0),
        avgGramsPerPlant: Math.round((s.avgGramsPerPlant || 0) * 10) / 10,
        avgGramsPerWatt: Math.round((s.avgGramsPerWatt || 0) * 100) / 100,
        avgDays: Math.round(s.avgDays || 0),
        bestCycle: {
          cycleName: bestCycle.cycleName,
          roomName: bestCycle.roomName,
          harvestDate: bestCycle.harvestDate,
          dryWeight: bestCycle.harvestData?.dryWeight,
          gramsPerPlant: bestCycle.metrics?.gramsPerPlant
        },
        worstCycle: {
          cycleName: worstCycle.cycleName,
          roomName: worstCycle.roomName,
          harvestDate: worstCycle.harvestDate,
          dryWeight: worstCycle.harvestData?.dryWeight,
          gramsPerPlant: worstCycle.metrics?.gramsPerPlant
        },
        trend
      },
      cycles: cycles.map(c => ({
        _id: c._id,
        cycleName: c.cycleName,
        roomName: c.roomName,
        roomNumber: c.roomNumber,
        plantsCount: c.plantsCount,
        harvestDate: c.harvestDate,
        startDate: c.startDate,
        actualDays: c.actualDays,
        dryWeight: c.harvestData?.dryWeight || 0,
        wetWeight: c.harvestData?.wetWeight || 0,
        gramsPerPlant: c.metrics?.gramsPerPlant || 0,
        gramsPerWatt: c.metrics?.gramsPerWatt || 0,
        quality: c.harvestData?.quality || 'medium'
      })),
      byRoom: byRoom.map(r => ({
        roomId: r._id.room,
        roomName: r._id.roomName,
        roomNumber: r._id.roomNumber,
        cycles: r.cycles,
        totalWeight: Math.round(r.totalWeight),
        avgGramsPerPlant: Math.round((r.avgGramsPerPlant || 0) * 10) / 10,
        avgDays: Math.round(r.avgDays || 0)
      }))
    });
  } catch (error) {
    console.error('Get strain detail stats error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

// @desc    Get detailed stats for a specific room
// @route   GET /api/archive/stats/room/:roomId
export const getRoomDetailStats = async (req, res) => {
  try {
    const { roomId } = req.params;
    const { period = 'all' } = req.query;

    let dateFilter = {};
    const now = new Date();
    if (period === 'year') {
      dateFilter = { harvestDate: { $gte: new Date(now.getFullYear(), 0, 1) } };
    } else if (period === '6months') {
      const d = new Date(now); d.setMonth(d.getMonth() - 6);
      dateFilter = { harvestDate: { $gte: d } };
    } else if (period === '3months') {
      const d = new Date(now); d.setMonth(d.getMonth() - 3);
      dateFilter = { harvestDate: { $gte: d } };
    }

    const baseMatch = {
      room: new mongoose.Types.ObjectId(roomId),
      ...dateFilter,
      $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }]
    };

    // All cycles for this room, chronological
    const cycles = await CycleArchive.find({
      room: roomId,
      ...dateFilter,
      $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }]
    })
      .sort({ harvestDate: 1 })
      .select('cycleName strain roomName roomNumber plantsCount harvestDate startDate actualDays harvestData metrics environment strains')
      .lean();

    if (cycles.length === 0) {
      const room = await FlowerRoom.findById(roomId).select('name roomNumber').lean();
      return res.json({
        roomId,
        roomName: room?.name || '—',
        roomNumber: room?.roomNumber,
        summary: null,
        cycles: [],
        byStrain: []
      });
    }

    const roomName = cycles[0].roomName;
    const roomNumber = cycles[0].roomNumber;

    // Summary aggregation
    const summaryAgg = await CycleArchive.aggregate([
      { $match: baseMatch },
      {
        $group: {
          _id: null,
          totalCycles: { $sum: 1 },
          totalPlants: { $sum: '$plantsCount' },
          totalDryWeight: { $sum: '$harvestData.dryWeight' },
          totalWetWeight: { $sum: '$harvestData.wetWeight' },
          avgDryPerCycle: { $avg: '$harvestData.dryWeight' },
          avgGramsPerPlant: { $avg: '$metrics.gramsPerPlant' },
          avgGramsPerWatt: { $avg: '$metrics.gramsPerWatt' },
          avgDays: { $avg: '$actualDays' }
        }
      }
    ]);

    const sm = summaryAgg[0];

    // Best & worst cycle
    const bestCycle = cycles.reduce((best, c) =>
      (c.metrics?.gramsPerPlant || 0) > (best.metrics?.gramsPerPlant || 0) ? c : best, cycles[0]);
    const worstCycle = cycles.reduce((worst, c) =>
      (c.metrics?.gramsPerPlant || 0) < (worst.metrics?.gramsPerPlant || 0) ? c : worst, cycles[0]);

    // Trend
    let trend = 'stable';
    if (cycles.length >= 4) {
      const first3 = cycles.slice(0, 3);
      const last3 = cycles.slice(-3);
      const avgFirst = first3.reduce((s, c) => s + (c.metrics?.gramsPerPlant || 0), 0) / first3.length;
      const avgLast = last3.reduce((s, c) => s + (c.metrics?.gramsPerPlant || 0), 0) / last3.length;
      if (avgLast > avgFirst * 1.1) trend = 'up';
      else if (avgLast < avgFirst * 0.9) trend = 'down';
    }

    // By strain breakdown
    const byStrain = await CycleArchive.aggregate([
      { $match: baseMatch },
      {
        $group: {
          _id: '$strain',
          cycles: { $sum: 1 },
          totalWeight: { $sum: '$harvestData.dryWeight' },
          avgGramsPerPlant: { $avg: '$metrics.gramsPerPlant' },
          avgDays: { $avg: '$actualDays' }
        }
      },
      { $sort: { totalWeight: -1 } }
    ]);

    res.json({
      roomId,
      roomName,
      roomNumber,
      summary: {
        totalCycles: sm.totalCycles,
        totalPlants: sm.totalPlants,
        totalDryWeight: sm.totalDryWeight,
        totalWetWeight: sm.totalWetWeight,
        avgDryPerCycle: Math.round(sm.avgDryPerCycle || 0),
        avgGramsPerPlant: Math.round((sm.avgGramsPerPlant || 0) * 10) / 10,
        avgGramsPerWatt: Math.round((sm.avgGramsPerWatt || 0) * 100) / 100,
        avgDays: Math.round(sm.avgDays || 0),
        bestCycle: {
          cycleName: bestCycle.cycleName,
          strain: bestCycle.strain,
          harvestDate: bestCycle.harvestDate,
          dryWeight: bestCycle.harvestData?.dryWeight,
          gramsPerPlant: bestCycle.metrics?.gramsPerPlant
        },
        worstCycle: {
          cycleName: worstCycle.cycleName,
          strain: worstCycle.strain,
          harvestDate: worstCycle.harvestDate,
          dryWeight: worstCycle.harvestData?.dryWeight,
          gramsPerPlant: worstCycle.metrics?.gramsPerPlant
        },
        trend
      },
      cycles: cycles.map(c => ({
        _id: c._id,
        cycleName: c.cycleName,
        strain: c.strain,
        plantsCount: c.plantsCount,
        harvestDate: c.harvestDate,
        startDate: c.startDate,
        actualDays: c.actualDays,
        dryWeight: c.harvestData?.dryWeight || 0,
        wetWeight: c.harvestData?.wetWeight || 0,
        gramsPerPlant: c.metrics?.gramsPerPlant || 0,
        gramsPerWatt: c.metrics?.gramsPerWatt || 0,
        quality: c.harvestData?.quality || 'medium'
      })),
      byStrain: byStrain.map(s => ({
        strain: s._id,
        cycles: s.cycles,
        totalWeight: Math.round(s.totalWeight),
        avgGramsPerPlant: Math.round((s.avgGramsPerPlant || 0) * 10) / 10,
        avgDays: Math.round(s.avgDays || 0)
      }))
    });
  } catch (error) {
    console.error('Get room detail stats error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

export const getDeletedArchives = async (req, res) => {
  try {
    const list = await CycleArchive.find(deletedOnly).sort({ deletedAt: -1 }).limit(100);
    res.json(list);
  } catch (error) {
    console.error('Get deleted archives error:', error);
    res.status(500).json({ message: 'РћС€РёР±РєР° СЃРµСЂРІРµСЂР°' });
  }
};

export const restoreArchive = async (req, res) => {
  try {
    const doc = await CycleArchive.findOne({ _id: req.params.id, ...deletedOnly });
    if (!doc) return res.status(404).json({ message: 'РђСЂС…РёРІ РЅРµ РЅР°Р№РґРµРЅ РёР»Рё СѓР¶Рµ РІРѕСЃСЃС‚Р°РЅРѕРІР»РµРЅ' });
    doc.deletedAt = null;
    await doc.save();
    await createAuditLog(req, { action: 'archive.restore', entityType: 'CycleArchive', entityId: doc._id, details: { cycleName: doc.cycleName } });
    res.json(doc);
  } catch (error) {
    console.error('Restore archive error:', error);
    res.status(500).json({ message: error.message || 'РћС€РёР±РєР° СЃРµСЂРІРµСЂР°' });
  }
};

// @desc    One-time migration: fix cloneData.quantity in existing archives
// @route   POST /api/archive/fix-clone-counts
export const fixCloneCounts = async (req, res) => {
  try {
    const archives = await CycleArchive.find({
      cloneData: { $ne: null },
      ...notDeleted
    }).lean();

    const results = [];
    let fixed = 0;

    for (const arc of archives) {
      if (!arc.room) continue;

      const veg = await VegBatch.findOne({ flowerRoom: arc.room })
        .sort({ transplantedToFlowerAt: -1 })
        .lean();

      if (!veg) {
        results.push({ room: arc.roomName, strain: arc.strain, status: 'no vegbatch' });
        continue;
      }

      const correctCount = veg.sentToFlowerCount || veg.initialQuantity || veg.quantity || 0;
      const correctStrains = (veg.sentToFlowerStrains?.length > 0) ? veg.sentToFlowerStrains : veg.strains || [];
      const oldCount = arc.cloneData?.quantity;

      if (correctCount && correctCount !== oldCount) {
        const update = { 'cloneData.quantity': correctCount };
        if (correctStrains.length > 0) update['cloneData.strains'] = correctStrains;
        await CycleArchive.updateOne({ _id: arc._id }, { $set: update });
        results.push({ room: arc.roomName, strain: arc.strain, old: oldCount, new: correctCount });
        fixed++;
      } else {
        results.push({ room: arc.roomName, strain: arc.strain, count: oldCount, status: 'ok' });
      }
    }

    res.json({ total: archives.length, fixed, results });
  } catch (error) {
    console.error('Fix clone counts error:', error);
    res.status(500).json({ message: 'Ошибка миграции' });
  }
};
