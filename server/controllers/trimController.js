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

// @desc    Получить архивы трима (фильтр по статусу)
// @route   GET /api/trim/active?status=active|completed|all
export const getActiveTrimArchives = async (req, res) => {
  try {
    const statusParam = req.query.status || 'active';
    let statusFilter = {};
    if (statusParam === 'active') {
      statusFilter = { trimStatus: { $in: ['pending', 'in_progress'] } };
    } else if (statusParam === 'completed') {
      statusFilter = { trimStatus: 'completed' };
    }

    const archives = await CycleArchive.find({
      ...notDeleted,
      ...statusFilter
    }).sort({ harvestDate: -1 });

    const archiveIds = archives.map(a => a._id);

    // Общий трим по архивам
    const trimSums = await TrimLog.aggregate([
      { $match: { archive: { $in: archiveIds }, ...notDeleted } },
      { $group: { _id: '$archive', totalTrimmed: { $sum: '$weight' } } }
    ]);
    const sumMap = {};
    trimSums.forEach(s => { sumMap[s._id.toString()] = s.totalTrimmed; });

    // Трим по сортам для каждого архива
    const trimByStrainAgg = await TrimLog.aggregate([
      { $match: { archive: { $in: archiveIds }, ...notDeleted } },
      { $group: { _id: { archive: '$archive', strain: '$strain' }, weight: { $sum: '$weight' } } }
    ]);
    const strainMap = {};
    trimByStrainAgg.forEach(s => {
      const key = s._id.archive.toString();
      if (!strainMap[key]) strainMap[key] = {};
      strainMap[key][s._id.strain || '—'] = s.weight;
    });

    // Последние 3 лога для каждого архива
    const recentLogsAgg = await TrimLog.aggregate([
      { $match: { archive: { $in: archiveIds }, ...notDeleted } },
      { $sort: { date: -1, createdAt: -1 } },
      { $group: {
        _id: '$archive',
        logs: { $push: { weight: '$weight', strain: '$strain', date: '$date' } }
      }},
      { $project: { logs: { $slice: ['$logs', 3] } } }
    ]);
    const recentLogsMap = {};
    recentLogsAgg.forEach(r => { recentLogsMap[r._id.toString()] = r.logs; });

    const result = archives.map(a => {
      const obj = a.toJSON();
      obj.totalTrimmed = sumMap[a._id.toString()] || 0;
      obj.trimByStrain = strainMap[a._id.toString()] || {};
      obj.recentLogs = recentLogsMap[a._id.toString()] || [];
      return obj;
    });

    res.json(result);
  } catch (error) {
    console.error('getActiveTrimArchives error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

// @desc    Статистика трима по дням (за последние N дней)
// @route   GET /api/trim/stats/daily?days=30
export const getTrimDailyStats = async (req, res) => {
  try {
    const days = Math.min(90, Math.max(7, parseInt(req.query.days, 10) || 30));
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    const start = new Date();
    start.setDate(start.getDate() - days);
    start.setHours(0, 0, 0, 0);

    const aggregated = await TrimLog.aggregate([
      { $match: { date: { $gte: start, $lte: end }, ...notDeleted } },
      {
        $group: {
          _id: { $dateToString: { date: '$date', format: '%Y-%m-%d' } },
          total: { $sum: '$weight' }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    const byDate = {};
    aggregated.forEach((row) => { byDate[row._id] = row.total; });

    const result = [];
    const cursor = new Date(start);
    while (cursor <= end) {
      const key = cursor.toISOString().slice(0, 10);
      result.push({ date: key, weight: byDate[key] || 0 });
      cursor.setDate(cursor.getDate() + 1);
    }

    res.json(result);
  } catch (error) {
    console.error('getTrimDailyStats error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

// @desc    Добавить запись трима (дневной лог)
// @route   POST /api/trim/log
export const addTrimLog = async (req, res) => {
  try {
    const { archiveId, strain, weight, date } = req.body;

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

    const strainsList = (archive.strains && archive.strains.length) ? archive.strains : [archive.strain || ''];
    let strainStr = typeof strain === 'string' ? strain.trim() : String(strain || '').trim();
    // Авто-выбор если один сорт и сорт не указан
    if (!strainStr && strainsList.length === 1) {
      strainStr = (strainsList[0] || '').trim();
    }
    if (!strainStr) {
      return res.status(400).json({ message: 'Укажите сорт' });
    }
    if (!strainsList.some(s => (s || '').trim() === strainStr)) {
      return res.status(400).json({ message: 'Выберите сорт из списка сортов этой комнаты' });
    }

    const log = await TrimLog.create({
      archive: archive._id,
      room: archive.room,
      roomName: archive.roomName,
      strain: strainStr || archive.strain,
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

// @desc    Обновить поля трима в архиве (dryWeight, popcornWeight, strainData)
// @route   PUT /api/trim/archive/:archiveId
export const updateTrimArchive = async (req, res) => {
  try {
    const archive = await CycleArchive.findById(req.params.archiveId);
    if (!archive) {
      return res.status(404).json({ message: 'Архив не найден' });
    }

    const { dryWeight, popcornWeight, strainData, strains } = req.body;
    if (dryWeight !== undefined) {
      archive.harvestData.dryWeight = Number(dryWeight) || 0;
      // Пересчитать метрики при изменении сухого веса
      const dry = Number(dryWeight) || 0;
      if (!archive.metrics) archive.metrics = {};
      archive.metrics.gramsPerPlant = (archive.plantsCount > 0 && dry > 0)
        ? Math.round(dry / archive.plantsCount * 100) / 100 : 0;
      archive.metrics.gramsPerDay = (archive.actualDays > 0 && dry > 0)
        ? Math.round(dry / archive.actualDays * 100) / 100 : 0;
      archive.metrics.gramsPerWatt = (archive.lighting?.totalWatts > 0 && dry > 0)
        ? Math.round(dry / archive.lighting.totalWatts * 100) / 100 : 0;
    }
    if (popcornWeight !== undefined) archive.harvestData.popcornWeight = Number(popcornWeight) || 0;
    if (Array.isArray(strains) && strains.length > 0) {
      archive.strains = strains.map(s => String(s || '').trim()).filter(Boolean);
    }
    if (Array.isArray(strainData) && strainData.length > 0) {
      archive.strainData = strainData.map(row => ({
        strain: String(row.strain || '').trim(),
        wetWeight: Number(row.wetWeight) || 0,
        dryWeight: Number(row.dryWeight) || 0,
        popcornWeight: Number(row.popcornWeight) || 0
      }));
    }
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
