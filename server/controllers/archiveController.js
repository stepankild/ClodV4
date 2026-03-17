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
import { escapeRegex } from '../utils/escapeRegex.js';
import { t } from '../utils/i18n.js';

// @desc    Get all archives
// @route   GET /api/archive
export const getArchives = async (req, res) => {
  try {
    const { roomId, strain, limit = 50, skip = 0 } = req.query;

    const query = { ...notDeleted };
    if (roomId) query.room = roomId;
    if (strain) query.strain = new RegExp(escapeRegex(strain), 'i');

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
    res.status(500).json({ message: t('common.serverError', req.lang) });
  }
};

// @desc    Get single archive
// @route   GET /api/archive/:id
export const getArchive = async (req, res) => {
  try {
    const archive = await CycleArchive.findOne({ _id: req.params.id, ...notDeleted })
      .populate('completedTasks.completedBy', 'name');

    if (!archive) {
      return res.status(404).json({ message: t('archive.notFound', req.lang) });
    }

    res.json(archive);
  } catch (error) {
    console.error('Get archive error:', error);
    res.status(500).json({ message: t('common.serverError', req.lang) });
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
          // Усушка: wet → finalProduct. finalWeight (ручной ввод) если есть, иначе trimWeight (fallback для старых данных)
          shrinkageWet: { $sum: { $cond: [{ $and: [{ $gt: ['$harvestData.wetWeight', 0] }, { $gt: [{ $cond: [{ $gt: [{ $ifNull: ['$harvestData.finalWeight', 0] }, 0] }, { $ifNull: ['$harvestData.finalWeight', 0] }, { $ifNull: ['$harvestData.trimWeight', 0] }] }, 0] }] }, '$harvestData.wetWeight', 0] } },
          shrinkageFinal: { $sum: { $cond: [{ $and: [{ $gt: ['$harvestData.wetWeight', 0] }, { $gt: [{ $cond: [{ $gt: [{ $ifNull: ['$harvestData.finalWeight', 0] }, 0] }, { $ifNull: ['$harvestData.finalWeight', 0] }, { $ifNull: ['$harvestData.trimWeight', 0] }] }, 0] }] }, { $cond: [{ $gt: [{ $ifNull: ['$harvestData.finalWeight', 0] }, 0] }, { $ifNull: ['$harvestData.finalWeight', 0] }, { $ifNull: ['$harvestData.trimWeight', 0] }] }, 0] } },
          shrinkageCycles: { $sum: { $cond: [{ $and: [{ $gt: ['$harvestData.wetWeight', 0] }, { $gt: [{ $cond: [{ $gt: [{ $ifNull: ['$harvestData.finalWeight', 0] }, 0] }, { $ifNull: ['$harvestData.finalWeight', 0] }, { $ifNull: ['$harvestData.trimWeight', 0] }] }, 0] }] }, 1, 0] } },
          avgDaysFlowering: { $avg: '$actualDays' },
          // Средние показатели: только по циклам с dryWeight > 0
          _gppSum: { $sum: { $cond: [{ $gt: ['$harvestData.dryWeight', 0] }, { $ifNull: ['$metrics.gramsPerPlant', 0] }, 0] } },
          _gppCount: { $sum: { $cond: [{ $gt: ['$harvestData.dryWeight', 0] }, 1, 0] } },
          _gpwSum: { $sum: { $cond: [{ $gt: ['$harvestData.dryWeight', 0] }, { $ifNull: ['$metrics.gramsPerWatt', 0] }, 0] } },
          _gpdSum: { $sum: { $cond: [{ $gt: ['$harvestData.dryWeight', 0] }, { $ifNull: ['$metrics.gramsPerDay', 0] }, 0] } },
          // Потери на триме: считаем только по завершённым циклам (trimStatus = completed, dry > 0)
          // finalProduct = finalWeight если есть, иначе trimWeight (fallback)
          trimLossDry: { $sum: { $cond: [{ $and: [{ $eq: ['$trimStatus', 'completed'] }, { $gt: ['$harvestData.dryWeight', 0] }] }, '$harvestData.dryWeight', 0] } },
          trimLossFinalProduct: { $sum: { $cond: [{ $and: [{ $eq: ['$trimStatus', 'completed'] }, { $gt: ['$harvestData.dryWeight', 0] }] }, { $cond: [{ $gt: [{ $ifNull: ['$harvestData.finalWeight', 0] }, 0] }, { $ifNull: ['$harvestData.finalWeight', 0] }, { $ifNull: ['$harvestData.trimWeight', 0] }] }, 0] } },
          trimLossPopcorn: { $sum: { $cond: [{ $and: [{ $eq: ['$trimStatus', 'completed'] }, { $gt: ['$harvestData.dryWeight', 0] }] }, { $add: [{ $ifNull: ['$harvestData.popcornWeight', 0] }, { $ifNull: ['$harvestData.popcornMachine', 0] }] }, 0] } },
          trimLossCycles: { $sum: { $cond: [{ $and: [{ $eq: ['$trimStatus', 'completed'] }, { $gt: ['$harvestData.dryWeight', 0] }] }, 1, 0] } }
        }
      }
    ]);

    // Статистика по сортам — используем strainData (реальные веса по сорту) + harvestMapData.plants (кусты по сорту)
    const strainStats = await CycleArchive.aggregate([
      { $match: { $and: [dateFilter, { $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }] }] } },
      // Строим массив данных по сортам: если есть strainData с весами — используем его,
      // иначе делаем fallback на равномерное деление
      {
        $addFields: {
          _strainEntries: {
            $cond: {
              if: { $and: [{ $isArray: '$strainData' }, { $gt: [{ $size: '$strainData' }, 0] }] },
              then: '$strainData',
              else: [{
                strain: { $ifNull: ['$strain', '—'] },
                dryWeight: { $ifNull: ['$harvestData.dryWeight', 0] },
                wetWeight: { $ifNull: ['$harvestData.wetWeight', 0] }
              }]
            }
          },
          // Считаем кол-во кустов по сортам из harvestMapData.plants
          _plantsByStrain: {
            $cond: {
              if: { $and: [{ $isArray: '$harvestMapData.plants' }, { $gt: [{ $size: '$harvestMapData.plants' }, 0] }] },
              then: '$harvestMapData.plants',
              else: []
            }
          }
        }
      },
      { $unwind: '$_strainEntries' },
      // Для каждого сорта считаем кол-во кустов из harvestMapData
      {
        $addFields: {
          _strainPlantsCount: {
            $size: {
              $filter: {
                input: '$_plantsByStrain',
                as: 'p',
                cond: { $eq: ['$$p.strain', '$_strainEntries.strain'] }
              }
            }
          },
          // Если strainData.dryWeight > 0, используем реальный вес, иначе fallback на общий / кол-во сортов
          _entryDryWeight: {
            $cond: {
              if: { $gt: [{ $ifNull: ['$_strainEntries.dryWeight', 0] }, 0] },
              then: '$_strainEntries.dryWeight',
              else: { $ifNull: ['$harvestData.dryWeight', 0] }
            }
          }
        }
      },
      // Вычисляем г/куст для конкретного сорта
      {
        $addFields: {
          _strainGpp: {
            $cond: {
              if: { $gt: ['$_strainPlantsCount', 0] },
              then: { $divide: ['$_entryDryWeight', '$_strainPlantsCount'] },
              // fallback: используем общий metrics.gramsPerPlant
              else: { $ifNull: ['$metrics.gramsPerPlant', 0] }
            }
          },
          _strainGpw: {
            $cond: {
              if: { $and: [{ $gt: [{ $ifNull: ['$lighting.totalWatts', 0] }, 0] }, { $gt: ['$_entryDryWeight', 0] }] },
              then: { $divide: ['$_entryDryWeight', '$lighting.totalWatts'] },
              else: { $ifNull: ['$metrics.gramsPerWatt', 0] }
            }
          }
        }
      },
      // Исключаем циклы без сухого веса из статистики по сортам
      { $match: { _entryDryWeight: { $gt: 0 } } },
      {
        $group: {
          _id: '$_strainEntries.strain',
          cycles: { $sum: 1 },
          totalWeight: { $sum: '$_entryDryWeight' },
          avgWeight: { $avg: '$_entryDryWeight' },
          avgGramsPerPlant: { $avg: '$_strainGpp' },
          avgGramsPerWatt: { $avg: '$_strainGpw' },
          avgDays: { $avg: '$actualDays' }
        }
      },
      { $sort: { totalWeight: -1 } }
    ]);

    // Статистика по месяцам (для графика)
    const monthlyStats = await CycleArchive.aggregate([
      { $match: { $and: [dateFilter, { $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }] }] } },
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
      { $match: { $and: [dateFilter, { $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }] }] } },
      {
        $group: {
          _id: '$room',
          cycles: { $sum: 1 },
          totalWeight: { $sum: '$harvestData.dryWeight' },
          totalWetWeight: { $sum: '$harvestData.wetWeight' },
          avgWeight: { $avg: '$harvestData.dryWeight' },
          totalPlants: { $sum: '$plantsCount' },
          totalDays: { $sum: '$actualDays' },
          avgDays: { $avg: '$actualDays' },
          avgGramsPerPlant: { $avg: '$metrics.gramsPerPlant' },
          avgGramsPerWatt: { $avg: '$metrics.gramsPerWatt' }
        }
      }
    ]);

    // Total trim weight from TrimLog
    const trimTotalAgg = await TrimLog.aggregate([
      { $match: { $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }] } },
      { $group: { _id: null, totalTrimWeight: { $sum: '$weight' }, totalTrimEntries: { $sum: 1 } } }
    ]);

    const raw = totalStats[0] || {};
    const gppCount = raw._gppCount || 0;
    const totalData = {
      totalCycles: raw.totalCycles || 0,
      totalPlants: raw.totalPlants || 0,
      totalDryWeight: raw.totalDryWeight || 0,
      totalWetWeight: raw.totalWetWeight || 0,
      shrinkageWet: raw.shrinkageWet || 0,
      shrinkageFinal: raw.shrinkageFinal || 0,
      shrinkageCycles: raw.shrinkageCycles || 0,
      avgDaysFlowering: raw.avgDaysFlowering || 0,
      // Средние только по циклам с dryWeight > 0
      avgGramsPerPlant: gppCount > 0 ? raw._gppSum / gppCount : 0,
      avgGramsPerWatt: gppCount > 0 ? raw._gpwSum / gppCount : 0,
      avgGramsPerDay: gppCount > 0 ? raw._gpdSum / gppCount : 0,
      trimLossDry: raw.trimLossDry || 0,
      trimLossTrimmed: raw.trimLossTrimmed || 0,
      trimLossPopcorn: raw.trimLossPopcorn || 0,
      trimLossPopcornMachine: raw.trimLossPopcornMachine || 0,
      trimLossCycles: raw.trimLossCycles || 0
    };
    totalData.totalTrimWeight = trimTotalAgg[0]?.totalTrimWeight || 0;
    totalData.totalTrimEntries = trimTotalAgg[0]?.totalTrimEntries || 0;

    res.json({
      total: totalData,
      byStrain: strainStats,
      byMonth: monthlyStats,
      byRoomId: roomStatsByRoomId
    });
  } catch (error) {
    console.error('Get archive stats error:', error);
    res.status(500).json({ message: t('common.serverError', req.lang) });
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
      return res.status(404).json({ message: t('rooms.notFound', req.lang) });
    }

    if (!room.isActive) {
      return res.status(400).json({ message: t('archive.roomNotActive', req.lang) });
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
        vegPlantsCount: vegBatch.initialQuantity || vegBatch.quantity || 0,
        vegDaysTarget: vegBatch.vegDaysTarget,
        vegDaysActual,
        transplantedToFlowerAt: vegBatch.transplantedToFlowerAt,
        flowerPlantsCount: vegBatch.sentToFlowerCount || 0,
        notes: vegBatch.notes || ''
      };

      // Получаем данные клонов из источника веги
      if (vegBatch.sourceCloneCut) {
        const cloneCut = await CloneCut.findById(vegBatch.sourceCloneCut);
        if (cloneCut) {
          // Количество изначально нарезанных клонов
          const originalCutQuantity = cloneCut.initialQuantity
            || (cloneCut.quantity + (vegBatch.initialQuantity || vegBatch.quantity || 0))
            || cloneCut.quantity
            || 0;
          cloneData = {
            cutDate: cloneCut.cutDate,
            quantity: originalCutQuantity,
            strains: cloneCut.strains || [],
            notes: cloneCut.notes || ''
          };
        }
      } else {
        // Если нет прямой связи, берём из самой веги
        cloneData = {
          cutDate: vegBatch.cutDate,
          quantity: vegBatch.initialQuantity || vegBatch.quantity || 0,
          strains: vegBatch.strains || [],
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
          popcornWeight: 0,
          popcornMachine: 0
        }))
      : [{ strain: room.strain || '—', wetWeight: wetWeight || 0, dryWeight: dryWeight || 0, popcornWeight: 0, popcornMachine: 0 }];

    // Защита от дублей: если архив с этой комнатой и startDate уже существует — не создаём
    const existingArchive = await CycleArchive.findOne({
      room: roomId,
      startDate: room.startDate,
      $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }]
    });
    if (existingArchive) {
      return res.status(409).json({
        message: t('archive.alreadyExists', req.lang),
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
    res.status(500).json({ message: t('common.serverError', req.lang) });
  }
};

// @desc    Update archive (add notes, correct data) — веса только с правом harvest:edit_weights
// @route   PUT /api/archive/:id
export const updateArchive = async (req, res) => {
  try {
    const { harvestData, cloneData, issues, notes } = req.body;

    const archive = await CycleArchive.findOne({ _id: req.params.id, ...notDeleted });

    if (!archive) {
      return res.status(404).json({ message: t('archive.notFound', req.lang) });
    }

    // Обновление данных клонов
    if (cloneData) {
      if (!archive.cloneData) archive.cloneData = {};
      if (cloneData.quantity !== undefined) archive.cloneData.quantity = cloneData.quantity;
      if (cloneData.strains !== undefined) archive.cloneData.strains = cloneData.strains;
      if (cloneData.cutDate !== undefined) archive.cloneData.cutDate = cloneData.cutDate;
      if (cloneData.notes !== undefined) archive.cloneData.notes = cloneData.notes;
      archive.markModified('cloneData');
    }

    if (harvestData) {
      const perms = await req.user.getPermissions();
      const hasWeightEdit = perms.includes('*') || perms.includes('harvest:edit_weights');
      if (!hasWeightEdit && (harvestData.wetWeight !== undefined || harvestData.dryWeight !== undefined || harvestData.trimWeight !== undefined)) {
        return res.status(403).json({ message: t('archive.noWeightPermission', req.lang) });
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
    res.status(500).json({ message: t('common.serverError', req.lang) });
  }
};

// @desc    Delete archive
// @route   DELETE /api/archive/:id
export const deleteArchive = async (req, res) => {
  try {
    const archive = await CycleArchive.findOne({ _id: req.params.id, ...notDeleted });

    if (!archive) {
      return res.status(404).json({ message: t('archive.notFound', req.lang) });
    }

    const roomId = archive.room?.toString?.() || archive.room;
    await createAuditLog(req, { action: 'archive.delete', entityType: 'CycleArchive', entityId: archive._id, details: { cycleName: archive.cycleName, roomId, harvestDate: archive.harvestDate } });
    archive.deletedAt = new Date();
    await archive.save();

    res.json({ message: t('archive.deleted', req.lang) });
  } catch (error) {
    console.error('Delete archive error:', error);
    res.status(500).json({ message: t('common.serverError', req.lang) });
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
    res.status(500).json({ message: t('common.serverError', req.lang) });
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

    // Ищем циклы, где этот сорт встречается: в strain, strains[] или strainData[]
    const baseMatch = {
      $or: [
        { strain: strainName },
        { strains: strainName },
        { 'strainData.strain': strainName }
      ],
      ...dateFilter,
      $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }]
    };
    // MongoDB не поддерживает два $or на верхнем уровне — объединяем через $and
    const baseMatchFull = {
      $and: [
        {
          $or: [
            { strain: strainName },
            { strains: strainName },
            { 'strainData.strain': strainName }
          ]
        },
        dateFilter,
        { $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }] }
      ]
    };

    // All cycles for this strain, chronological
    const cycles = await CycleArchive.find(baseMatchFull)
      .sort({ harvestDate: 1 })
      .select('cycleName roomName roomNumber plantsCount harvestDate startDate actualDays harvestData metrics environment strains strainData harvestMapData quality lighting')
      .lean();

    if (cycles.length === 0) {
      return res.json({ strain: strainName, summary: null, cycles: [], byRoom: [] });
    }

    // Хелпер: извлечь данные конкретного сорта из цикла
    const getStrainCycleData = (c) => {
      const sd = (c.strainData || []).find(s => s.strain === strainName);
      const plantsOfStrain = (c.harvestMapData?.plants || []).filter(p => p.strain === strainName);
      const strainPlantsCount = plantsOfStrain.length || null;

      const dryWeight = (sd && sd.dryWeight > 0) ? sd.dryWeight : (c.harvestData?.dryWeight || 0);
      const wetWeight = (sd && sd.wetWeight > 0) ? sd.wetWeight : (c.harvestData?.wetWeight || 0);
      const gpp = strainPlantsCount && dryWeight > 0 ? dryWeight / strainPlantsCount : (c.metrics?.gramsPerPlant || 0);
      const totalWatts = c.lighting?.totalWatts || 0;
      const gpw = totalWatts > 0 && dryWeight > 0 ? dryWeight / totalWatts : (c.metrics?.gramsPerWatt || 0);

      return { dryWeight, wetWeight, gpp, gpw, plantsCount: strainPlantsCount || c.plantsCount };
    };

    // Обогащаем циклы данными по сорту
    const enriched = cycles.map(c => ({ ...c, _sd: getStrainCycleData(c) }));

    // Summary
    const totalCycles = enriched.length;
    const totalPlants = enriched.reduce((sum, c) => sum + (c._sd.plantsCount || 0), 0);
    const totalDryWeight = enriched.reduce((sum, c) => sum + c._sd.dryWeight, 0);
    const totalWetWeight = enriched.reduce((sum, c) => sum + c._sd.wetWeight, 0);
    const avgDryPerCycle = totalDryWeight / totalCycles;
    const avgGpp = enriched.reduce((sum, c) => sum + c._sd.gpp, 0) / totalCycles;
    const avgGpw = enriched.reduce((sum, c) => sum + c._sd.gpw, 0) / totalCycles;
    const avgDays = enriched.reduce((sum, c) => sum + (c.actualDays || 0), 0) / totalCycles;

    // Best & worst cycle by g/plant
    const bestCycle = enriched.reduce((best, c) => c._sd.gpp > best._sd.gpp ? c : best, enriched[0]);
    const worstCycle = enriched.reduce((worst, c) => c._sd.gpp < worst._sd.gpp ? c : worst, enriched[0]);

    // Trend: compare avg of last 3 cycles vs first 3 cycles
    let trend = 'stable';
    if (enriched.length >= 4) {
      const first3 = enriched.slice(0, 3);
      const last3 = enriched.slice(-3);
      const avgFirst = first3.reduce((sum, c) => sum + c._sd.gpp, 0) / first3.length;
      const avgLast = last3.reduce((sum, c) => sum + c._sd.gpp, 0) / last3.length;
      if (avgLast > avgFirst * 1.1) trend = 'up';
      else if (avgLast < avgFirst * 0.9) trend = 'down';
    }

    // By room breakdown
    const roomMap = {};
    for (const c of enriched) {
      const key = String(c.room);
      if (!roomMap[key]) {
        roomMap[key] = { room: c.room, roomName: c.roomName, roomNumber: c.roomNumber, cycles: 0, totalWeight: 0, gppSum: 0, daysSum: 0 };
      }
      roomMap[key].cycles++;
      roomMap[key].totalWeight += c._sd.dryWeight;
      roomMap[key].gppSum += c._sd.gpp;
      roomMap[key].daysSum += (c.actualDays || 0);
    }
    const byRoom = Object.values(roomMap)
      .map(r => ({
        roomId: r.room,
        roomName: r.roomName,
        roomNumber: r.roomNumber,
        cycles: r.cycles,
        totalWeight: Math.round(r.totalWeight),
        avgGramsPerPlant: Math.round((r.gppSum / r.cycles) * 10) / 10,
        avgDays: Math.round(r.daysSum / r.cycles)
      }))
      .sort((a, b) => b.totalWeight - a.totalWeight);

    res.json({
      strain: strainName,
      summary: {
        totalCycles,
        totalPlants,
        totalDryWeight,
        totalWetWeight,
        avgDryPerCycle: Math.round(avgDryPerCycle || 0),
        avgGramsPerPlant: Math.round((avgGpp || 0) * 10) / 10,
        avgGramsPerWatt: Math.round((avgGpw || 0) * 100) / 100,
        avgDays: Math.round(avgDays || 0),
        bestCycle: {
          cycleName: bestCycle.cycleName,
          roomName: bestCycle.roomName,
          harvestDate: bestCycle.harvestDate,
          dryWeight: bestCycle._sd.dryWeight,
          gramsPerPlant: Math.round(bestCycle._sd.gpp * 10) / 10
        },
        worstCycle: {
          cycleName: worstCycle.cycleName,
          roomName: worstCycle.roomName,
          harvestDate: worstCycle.harvestDate,
          dryWeight: worstCycle._sd.dryWeight,
          gramsPerPlant: Math.round(worstCycle._sd.gpp * 10) / 10
        },
        trend
      },
      cycles: enriched.map(c => ({
        _id: c._id,
        cycleName: c.cycleName,
        roomName: c.roomName,
        roomNumber: c.roomNumber,
        plantsCount: c._sd.plantsCount,
        harvestDate: c.harvestDate,
        startDate: c.startDate,
        actualDays: c.actualDays,
        dryWeight: c._sd.dryWeight,
        wetWeight: c._sd.wetWeight,
        gramsPerPlant: Math.round(c._sd.gpp * 10) / 10,
        gramsPerWatt: Math.round(c._sd.gpw * 100) / 100,
        quality: c.harvestData?.quality || 'medium'
      })),
      byRoom
    });
  } catch (error) {
    console.error('Get strain detail stats error:', error);
    res.status(500).json({ message: t('common.serverError', req.lang) });
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

    // By strain breakdown — используем strainData для реальных весов по сортам
    const byStrain = await CycleArchive.aggregate([
      { $match: baseMatch },
      {
        $addFields: {
          _strainEntries: {
            $cond: {
              if: { $and: [{ $isArray: '$strainData' }, { $gt: [{ $size: '$strainData' }, 0] }] },
              then: '$strainData',
              else: [{
                strain: { $ifNull: ['$strain', '—'] },
                dryWeight: { $ifNull: ['$harvestData.dryWeight', 0] },
                wetWeight: { $ifNull: ['$harvestData.wetWeight', 0] }
              }]
            }
          },
          _plantsByStrain: {
            $cond: {
              if: { $and: [{ $isArray: '$harvestMapData.plants' }, { $gt: [{ $size: '$harvestMapData.plants' }, 0] }] },
              then: '$harvestMapData.plants',
              else: []
            }
          }
        }
      },
      { $unwind: '$_strainEntries' },
      {
        $addFields: {
          _strainPlantsCount: {
            $size: {
              $filter: {
                input: '$_plantsByStrain',
                as: 'p',
                cond: { $eq: ['$$p.strain', '$_strainEntries.strain'] }
              }
            }
          },
          _entryDryWeight: {
            $cond: {
              if: { $gt: [{ $ifNull: ['$_strainEntries.dryWeight', 0] }, 0] },
              then: '$_strainEntries.dryWeight',
              else: { $ifNull: ['$harvestData.dryWeight', 0] }
            }
          }
        }
      },
      {
        $addFields: {
          _strainGpp: {
            $cond: {
              if: { $gt: ['$_strainPlantsCount', 0] },
              then: { $divide: ['$_entryDryWeight', '$_strainPlantsCount'] },
              else: { $ifNull: ['$metrics.gramsPerPlant', 0] }
            }
          }
        }
      },
      {
        $group: {
          _id: '$_strainEntries.strain',
          cycles: { $sum: 1 },
          totalWeight: { $sum: '$_entryDryWeight' },
          avgGramsPerPlant: { $avg: '$_strainGpp' },
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
    res.status(500).json({ message: t('common.serverError', req.lang) });
  }
};

export const getDeletedArchives = async (req, res) => {
  try {
    const list = await CycleArchive.find(deletedOnly).sort({ deletedAt: -1 }).limit(100);
    res.json(list);
  } catch (error) {
    console.error('Get deleted archives error:', error);
    res.status(500).json({ message: t('common.serverError', req.lang) });
  }
};

export const restoreArchive = async (req, res) => {
  try {
    const doc = await CycleArchive.findOne({ _id: req.params.id, ...deletedOnly });
    if (!doc) return res.status(404).json({ message: t('archive.notFoundOrRestored', req.lang) });
    doc.deletedAt = null;
    await doc.save();
    await createAuditLog(req, { action: 'archive.restore', entityType: 'CycleArchive', entityId: doc._id, details: { cycleName: doc.cycleName } });
    res.json(doc);
  } catch (error) {
    console.error('Restore archive error:', error);
    res.status(500).json({ message: t('common.serverError', req.lang) });
  }
};

