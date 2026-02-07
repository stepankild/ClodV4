import CycleArchive from '../models/CycleArchive.js';
import TrimLog from '../models/TrimLog.js';
import { notDeleted } from '../utils/softDelete.js';
import { createAuditLog } from '../utils/auditLog.js';

// Пересчитать trimWeight для архива на основе TrimLog записей
const recalcTrimWeight = async (archiveId) => {
  const result = await TrimLog.aggregate([
    { $match: { archive: archiveId, ...notDeleted } },
    { $group: { _id: null, total: { $sum: '$weight' } } }
  ]);
  return result.length > 0 ? result[0].total : 0;
};

// @desc    Получить архивы, ожидающие трима
// @route   GET /api/trim/active
export const getActiveTrimArchives = async (req, res) => {
  try {
    const archives = await CycleArchive.find({
      trimStatus: { $ne: 'completed' },
      ...notDeleted
    }).sort({ harvestDate: -1 });

    // Подсчитать суммы трима для каждого архива
    const archiveIds = archives.map(a => a._id);
    const trimSums = await TrimLog.aggregate([
      { $match: { archive: { $in: archiveIds }, ...notDeleted } },
      { $group: { _id: '$archive', totalTrimmed: { $sum: '$weight' } } }
    ]);
    const sumMap = {};
    trimSums.forEach(s => { sumMap[s._id.toString()] = s.totalTrimmed; });

    const result = archives.map(a => {
      const obj = a.toJSON();
      obj.totalTrimmed = sumMap[a._id.toString()] || 0;
      return obj;
    });

    res.json(result);
  } catch (error) {
    console.error('getActiveTrimArchives error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

// @desc    Добавить запись трима (дневной лог)
// @route   POST /api/trim/log
export const addTrimLog = async (req, res) => {
  try {
    const { archiveId, weight, date } = req.body;

    if (!archiveId || !weight || weight <= 0) {
      return res.status(400).json({ message: 'Укажите архив и вес > 0' });
    }

    const archive = await CycleArchive.findById(archiveId);
    if (!archive) {
      return res.status(404).json({ message: 'Архив не найден' });
    }
    if (archive.trimStatus === 'completed') {
      return res.status(400).json({ message: 'Трим уже завершён' });
    }

    const log = await TrimLog.create({
      archive: archive._id,
      room: archive.room,
      roomName: archive.roomName,
      strain: archive.strain,
      weight,
      date: date || new Date(),
      createdBy: req.user._id
    });

    // Пересчитать trimWeight
    const totalTrimmed = await recalcTrimWeight(archive._id);
    archive.harvestData.trimWeight = totalTrimmed;
    if (archive.trimStatus === 'pending') {
      archive.trimStatus = 'in_progress';
    }
    await archive.save();

    await createAuditLog(req, {
      action: 'trim.log_add',
      entityType: 'TrimLog',
      entityId: log._id,
      details: { archiveId: archive._id.toString(), weight, roomName: archive.roomName }
    });

    res.status(201).json(log);
  } catch (error) {
    console.error('addTrimLog error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

// @desc    Получить записи трима для архива
// @route   GET /api/trim/logs/:archiveId
export const getTrimLogs = async (req, res) => {
  try {
    const logs = await TrimLog.find({
      archive: req.params.archiveId,
      ...notDeleted
    })
      .populate('createdBy', 'name')
      .sort({ date: -1 });

    res.json(logs);
  } catch (error) {
    console.error('getTrimLogs error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

// @desc    Удалить запись трима (soft delete)
// @route   DELETE /api/trim/log/:id
export const deleteTrimLog = async (req, res) => {
  try {
    const log = await TrimLog.findById(req.params.id);
    if (!log || log.deletedAt) {
      return res.status(404).json({ message: 'Запись не найдена' });
    }

    log.deletedAt = new Date();
    await log.save();

    // Пересчитать trimWeight
    const archive = await CycleArchive.findById(log.archive);
    if (archive) {
      const totalTrimmed = await recalcTrimWeight(archive._id);
      archive.harvestData.trimWeight = totalTrimmed;
      if (totalTrimmed === 0 && archive.trimStatus === 'in_progress') {
        archive.trimStatus = 'pending';
      }
      await archive.save();
    }

    await createAuditLog(req, {
      action: 'trim.log_delete',
      entityType: 'TrimLog',
      entityId: log._id,
      details: { archiveId: log.archive.toString(), weight: log.weight }
    });

    res.json({ message: 'Запись удалена' });
  } catch (error) {
    console.error('deleteTrimLog error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

// @desc    Обновить поля трима в архиве (dryWeight, popcornWeight)
// @route   PUT /api/trim/archive/:archiveId
export const updateTrimArchive = async (req, res) => {
  try {
    const archive = await CycleArchive.findById(req.params.archiveId);
    if (!archive) {
      return res.status(404).json({ message: 'Архив не найден' });
    }

    const { dryWeight, popcornWeight } = req.body;
    if (dryWeight !== undefined) archive.harvestData.dryWeight = Number(dryWeight) || 0;
    if (popcornWeight !== undefined) archive.harvestData.popcornWeight = Number(popcornWeight) || 0;
    await archive.save();

    await createAuditLog(req, {
      action: 'trim.archive_update',
      entityType: 'CycleArchive',
      entityId: archive._id,
      details: { dryWeight, popcornWeight, roomName: archive.roomName }
    });

    res.json(archive);
  } catch (error) {
    console.error('updateTrimArchive error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

// @desc    Завершить трим
// @route   POST /api/trim/complete/:archiveId
export const completeTrim = async (req, res) => {
  try {
    const archive = await CycleArchive.findById(req.params.archiveId);
    if (!archive) {
      return res.status(404).json({ message: 'Архив не найден' });
    }

    archive.trimStatus = 'completed';
    archive.trimCompletedAt = new Date();
    await archive.save();

    await createAuditLog(req, {
      action: 'trim.complete',
      entityType: 'CycleArchive',
      entityId: archive._id,
      details: { roomName: archive.roomName, trimWeight: archive.harvestData.trimWeight }
    });

    res.json(archive);
  } catch (error) {
    console.error('completeTrim error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};
