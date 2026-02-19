import mongoose from 'mongoose';
import HarvestSession from '../models/HarvestSession.js';
import FlowerRoom from '../models/FlowerRoom.js';
import CycleArchive from '../models/CycleArchive.js';
import RoomTask from '../models/RoomTask.js';
import RoomLog from '../models/RoomLog.js';
import VegBatch from '../models/VegBatch.js';
import CloneCut from '../models/CloneCut.js';
import { createAuditLog } from '../utils/auditLog.js';
import { getScaleState } from '../socket/index.js';

// @desc    Получить текущее состояние весов (in-memory из Socket.io)
// @route   GET /api/harvest/scale
export const getScaleReading = async (req, res) => {
  try {
    const state = getScaleState();
    res.json({
      weight: state.lastWeight,
      unit: state.unit || 'g',
      stable: state.stable,
      connected: state.connected,
      lastUpdate: state.lastUpdate
    });
  } catch (error) {
    console.error('Scale reading error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

// @desc    Получить активную сессию сбора по комнате
// @route   GET /api/harvest/session?roomId=xxx
export const getSessionByRoom = async (req, res) => {
  try {
    const { roomId } = req.query;
    if (!roomId) {
      return res.status(400).json({ message: 'Укажите roomId' });
    }
    if (!mongoose.Types.ObjectId.isValid(roomId)) {
      return res.status(400).json({ message: 'Некорректный ID комнаты' });
    }
    const session = await HarvestSession.findOne({
      room: roomId,
      status: 'in_progress'
    }).sort({ startedAt: -1 });

    // Нет активной сессии — возвращаем null (фронт создаст новую)
    if (!session) {
      return res.status(200).json(null);
    }
    await session.populate('plants.recordedBy', 'name email');
    res.json(session);
  } catch (error) {
    console.error('Get harvest session error:', error);
    res.status(500).json({ message: error.message || 'Ошибка сервера' });
  }
};

// @desc    Создать сессию сбора для комнаты
// @route   POST /api/harvest/session
export const createSession = async (req, res) => {
  try {
    const { roomId } = req.body;
    if (!roomId) {
      return res.status(400).json({ message: 'Укажите roomId' });
    }
    if (!mongoose.Types.ObjectId.isValid(roomId)) {
      return res.status(400).json({ message: 'Некорректный ID комнаты' });
    }

    const room = await FlowerRoom.findById(roomId);
    if (!room) {
      return res.status(404).json({ message: 'Комната не найдена' });
    }
    if (!room.isActive) {
      return res.status(400).json({ message: 'Комната не активна. Запустите цикл или выберите другую комнату.' });
    }

    const existing = await HarvestSession.findOne({
      room: roomId,
      status: 'in_progress'
    });
    if (existing) {
      await existing.populate('plants.recordedBy', 'name email');
      return res.json(existing);
    }

    const session = await HarvestSession.create({
      room: room._id,
      roomNumber: room.roomNumber,
      roomName: room.name,
      cycleName: room.cycleName || '',
      strain: room.strain || '',
      plantsCount: room.plantsCount || 0,
      status: 'in_progress',
      plants: []
    });
    await createAuditLog(req, { action: 'harvest.session_start', entityType: 'HarvestSession', entityId: session._id, details: { roomName: room.name, strain: room.strain, plantsCount: room.plantsCount } });
    res.status(201).json(session);
  } catch (error) {
    console.error('Create harvest session error:', error);
    res.status(500).json({
      message: error.message || 'Ошибка сервера',
      ...(error.name === 'ValidationError' && { details: error.errors })
    });
  }
};

// @desc    Добавить куст в сессию (номер + мокрый вес)
// @route   POST /api/harvest/session/:sessionId/plant
export const addPlant = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { plantNumber, wetWeight } = req.body;

    if (plantNumber == null || wetWeight == null) {
      return res.status(400).json({ message: 'Укажите номер куста и вес (plantNumber, wetWeight)' });
    }

    const session = await HarvestSession.findById(sessionId);
    if (!session) {
      return res.status(404).json({ message: 'Сессия сбора не найдена' });
    }
    if (session.status !== 'in_progress') {
      return res.status(400).json({ message: 'Сессия уже завершена' });
    }

    const num = Number(plantNumber);
    const weight = Number(wetWeight);
    if (isNaN(num) || num < 1) {
      return res.status(400).json({ message: 'Номер куста должен быть числом от 1' });
    }
    if (isNaN(weight) || weight < 0) {
      return res.status(400).json({ message: 'Вес должен быть неотрицательным числом' });
    }

    const duplicate = session.plants.some(p => p.plantNumber === num);
    if (duplicate) {
      return res.status(400).json({ message: `Куст №${num} уже записан` });
    }

    // Авто-определение сорта по номеру куста из диапазонов flowerStrains
    let strainForPlant = '';
    const room = await FlowerRoom.findById(session.room);
    if (room && room.flowerStrains && room.flowerStrains.length > 0) {
      const match = room.flowerStrains.find(
        fs => fs.startNumber != null && fs.endNumber != null &&
              num >= fs.startNumber && num <= fs.endNumber
      );
      if (match) {
        strainForPlant = match.strain || '';
      } else if (room.flowerStrains.length === 1) {
        strainForPlant = room.flowerStrains[0].strain || '';
      }
    } else if (room && room.strain) {
      strainForPlant = room.strain;
    }

    session.plants.push({
      plantNumber: num,
      strain: strainForPlant,
      wetWeight: weight,
      recordedAt: new Date(),
      recordedBy: req.user._id
    });
    await session.save();
    await session.populate('plants.recordedBy', 'name email');

    await createAuditLog(req, { action: 'harvest.plant_add', entityType: 'HarvestSession', entityId: session._id, details: { roomId: session.room?.toString(), plantNumber: num, wetWeight: weight } });
    const added = session.plants[session.plants.length - 1];
    res.status(201).json({ session, added });
  } catch (error) {
    console.error('Add plant error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

// @desc    Добавить пометку об ошибке к записи куста (удалять данные нельзя)
// @route   PATCH /api/harvest/session/:sessionId/plant/:plantNumber
export const setPlantErrorNote = async (req, res) => {
  try {
    const { sessionId, plantNumber } = req.params;
    const { errorNote } = req.body;

    const session = await HarvestSession.findById(sessionId);
    if (!session) {
      return res.status(404).json({ message: 'Сессия сбора не найдена' });
    }
    const num = Number(plantNumber);
    const plant = session.plants.find(p => p.plantNumber === num);
    if (!plant) {
      return res.status(404).json({ message: 'Запись куста не найдена' });
    }
    plant.errorNote = typeof errorNote === 'string' ? errorNote.trim() : '';
    await session.save();
    await session.populate('plants.recordedBy', 'name email');
    res.json(session);
  } catch (error) {
    console.error('Set plant error note:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

// @desc    Завершить сессию сбора и автоматически архивировать цикл (комната освобождается)
// @route   POST /api/harvest/session/:sessionId/complete
export const completeSession = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = await HarvestSession.findById(sessionId);
    if (!session) {
      return res.status(404).json({ message: 'Сессия сбора не найдена' });
    }
    if (session.status !== 'in_progress') {
      return res.status(400).json({ message: 'Сессия уже завершена' });
    }

    session.status = 'completed';
    session.completedAt = new Date();
    await session.save();

    const room = await FlowerRoom.findById(session.room);

    // Тестовая комната — сбросить без архивации
    if (room && room.isActive && room.isTestRoom) {
      // Soft-delete задач текущего цикла
      const deleteTaskQuery = { room: room._id, deletedAt: null };
      if (room.currentCycleId) deleteTaskQuery.cycleId = room.currentCycleId;
      await RoomTask.updateMany(deleteTaskQuery, { $set: { deletedAt: new Date() } });

      // Сброс комнаты БЕЗ архива, БЕЗ RoomLog, БЕЗ totalCycles++
      room.cycleName = '';
      room.strain = '';
      room.plantsCount = 0;
      room.startDate = null;
      room.expectedHarvestDate = null;
      room.notes = '';
      room.isActive = false;
      room.currentCycleId = null;
      if (room.roomLayout) room.roomLayout.plantPositions = [];
      if (room.flowerStrains) room.flowerStrains = [];
      await room.save();

      return res.json(session);
    }

    if (room && room.isActive) {
      // Защита от дублей: если архив с этой комнатой и startDate уже создан — пропускаем
      const existingArchive = await CycleArchive.findOne({
        room: room._id,
        startDate: room.startDate,
        $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }]
      });
      if (existingArchive) {
        // Архив уже существует (создан параллельным запросом) — просто сбрасываем комнату
        room.cycleName = '';
        room.strain = '';
        room.plantsCount = 0;
        room.startDate = null;
        room.expectedHarvestDate = null;
        room.notes = '';
        room.isActive = false;
        room.currentCycleId = null;
        if (room.roomLayout) room.roomLayout.plantPositions = [];
        await room.save();
        return res.json(session);
      }

      const totalWet = (session.plants || []).reduce((sum, p) => sum + (p.wetWeight || 0), 0);
      // Берём только задачи текущего цикла (по cycleId), не прошлых
      const taskQuery = { room: room._id, completed: true };
      if (room.currentCycleId) {
        taskQuery.cycleId = room.currentCycleId;
      }
      const completedTasks = await RoomTask.find(taskQuery).populate('completedBy', 'name');

      const harvestDate = new Date();
      const actualDays = room.currentDay || 0;
      const plantsCount = room.plantsCount || session.plantsCount || 0;

      const totalWatts = (room.lighting?.lampCount && room.lighting?.lampWattage)
        ? room.lighting.lampCount * room.lighting.lampWattage : null;

      // Получаем данные веги и клонов (как в harvestAndArchive)
      const vegBatch = await VegBatch.findOne({ flowerRoom: room._id })
        .sort({ transplantedToFlowerAt: -1 });

      let cloneData = null;
      let vegData = null;

      if (vegBatch) {
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
          cloneData = {
            cutDate: vegBatch.cutDate,
            quantity: vegBatch.initialQuantity || vegBatch.quantity || 0,
            strains: vegBatch.strains || [],
            notes: ''
          };
        }
      }

      // Собираем список сортов из flowerStrains или из основного strain
      const strainsList = (room.flowerStrains && room.flowerStrains.length > 0)
        ? room.flowerStrains.map(s => s.strain || '').filter(Boolean)
        : [room.strain || '—'];
      const uniqueStrains = [...new Set(strainsList)];

      // strainData — по каждому сорту с реальными весами из session.plants
      let strainData;
      if (room.flowerStrains && room.flowerStrains.length > 0) {
        const wetByStrain = {};
        for (const plant of (session.plants || [])) {
          const s = plant.strain || '—';
          wetByStrain[s] = (wetByStrain[s] || 0) + (plant.wetWeight || 0);
        }
        strainData = room.flowerStrains.map(s => ({
          strain: s.strain || '—',
          wetWeight: wetByStrain[s.strain] || wetByStrain[s.strain || '—'] || 0,
          dryWeight: 0,
          popcornWeight: 0
        }));
      } else {
        strainData = [{ strain: room.strain || '—', wetWeight: totalWet, dryWeight: 0, popcornWeight: 0 }];
      }

      // Снимок карты комнаты для архива (позиции + веса кустов)
      const harvestMapData = {
        customRows: (room.roomLayout?.customRows || []).map(r => ({
          name: r.name || '',
          cols: r.cols || 4,
          rows: r.rows || 1,
          fillDirection: r.fillDirection || 'topDown'
        })),
        plants: (room.roomLayout?.plantPositions || []).map(pp => {
          const harvested = (session.plants || []).find(p => p.plantNumber === pp.plantNumber);
          return {
            plantNumber: pp.plantNumber,
            row: pp.row,
            position: pp.position,
            strain: harvested?.strain || '',
            wetWeight: harvested?.wetWeight || 0
          };
        })
      };

      const archive = await CycleArchive.create({
        room: room._id,
        roomNumber: room.roomNumber,
        roomName: room.name,
        squareMeters: room.squareMeters || null,
        lighting: {
          lampCount: room.lighting?.lampCount || null,
          lampWattage: room.lighting?.lampWattage || null,
          lampType: room.lighting?.lampType || null,
          totalWatts
        },
        cycleName: session.cycleName || room.cycleName || '',
        strain: room.strain || '—',
        plantsCount,
        startDate: room.startDate,
        harvestDate,
        floweringDays: room.floweringDays || 56,
        actualDays,
        strains: uniqueStrains,
        strainData,
        harvestData: {
          wetWeight: totalWet,
          dryWeight: 0,
          trimWeight: 0,
          quality: 'medium',
          notes: `Автоархив после сбора. Записей кустов: ${(session.plants || []).length}. Сухой вес можно добавить в архиве.`
        },
        metrics: {
          gramsPerPlant: 0,
          gramsPerDay: 0,
          gramsPerWatt: 0
        },
        environment: room.environment,
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

      await RoomLog.create({
        room: room._id,
        cycleId: archive._id,
        type: 'cycle_end',
        title: `Урожай собран: ${room.strain}`,
        description: `Сырой вес (сбор): ${totalWet}г. Архив создан автоматически.`,
        data: { archiveId: archive._id, wetWeight: totalWet, actualDays },
        user: req.user._id,
        dayOfCycle: actualDays
      });

      // Мягкое удаление задач текущего цикла
      const deleteTaskQuery = { room: room._id, deletedAt: null };
      if (room.currentCycleId) {
        deleteTaskQuery.cycleId = room.currentCycleId;
      }
      await RoomTask.updateMany(deleteTaskQuery, { $set: { deletedAt: new Date() } });

      room.cycleName = '';
      room.strain = '';
      room.plantsCount = 0;
      room.startDate = null;
      room.expectedHarvestDate = null;
      room.notes = '';
      room.isActive = false;
      room.currentCycleId = null;
      room.totalCycles = (room.totalCycles || 0) + 1;
      // Очистить позиции кустов (сетка остаётся)
      if (room.roomLayout) {
        room.roomLayout.plantPositions = [];
      }
      await room.save();

      await createAuditLog(req, {
        action: 'harvest.complete',
        entityType: 'CycleArchive',
        entityId: archive._id,
        details: { roomId: room._id.toString(), roomName: room.name, plantsRecorded: (session.plants || []).length }
      });
    }

    res.json(session);
  } catch (error) {
    console.error('Complete session error:', error);
    res.status(500).json({ message: error.message || 'Ошибка сервера' });
  }
};

// @desc    Список сессий сбора (для инфографики/истории)
// @route   GET /api/harvest/sessions
export const getSessions = async (req, res) => {
  try {
    const { roomId, status, limit = 20 } = req.query;
    const query = {};
    if (roomId) query.room = roomId;
    if (status) query.status = status;

    const sessions = await HarvestSession.find(query)
      .sort({ startedAt: -1 })
      .limit(parseInt(limit))
      .populate('plants.recordedBy', 'name');
    res.json(sessions);
  } catch (error) {
    console.error('Get sessions error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};
