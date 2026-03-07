import TreatmentProduct from '../models/TreatmentProduct.js';
import TreatmentProtocol from '../models/TreatmentProtocol.js';
import RoomTreatmentSchedule from '../models/RoomTreatmentSchedule.js';
import RoomTask from '../models/RoomTask.js';
import RoomLog from '../models/RoomLog.js';
import FlowerRoom from '../models/FlowerRoom.js';
import { notDeleted, deletedOnly } from '../utils/softDelete.js';
import { createAuditLog } from '../utils/auditLog.js';

// ────────────────────────────────────────
// Products CRUD
// ────────────────────────────────────────

export const getProducts = async (req, res) => {
  try {
    const filter = { ...notDeleted };
    if (req.query.type) filter.type = req.query.type;
    const products = await TreatmentProduct.find(filter).sort({ type: 1, name: 1 }).lean();
    res.json(products);
  } catch (error) {
    console.error('Get treatment products error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

export const createProduct = async (req, res) => {
  try {
    const { name, type, description, defaultDosage, applicationMethod, notes } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ message: 'Укажите название препарата' });
    if (!type) return res.status(400).json({ message: 'Укажите тип (chemical / biological)' });

    const product = await TreatmentProduct.create({
      name: name.trim(),
      type,
      description: description || '',
      defaultDosage: defaultDosage || '',
      applicationMethod: applicationMethod || 'spray',
      notes: notes || ''
    });

    await createAuditLog(req, {
      action: 'treatment_product.create',
      entityType: 'TreatmentProduct',
      entityId: product._id,
      details: { name: product.name, type: product.type }
    });

    res.status(201).json(product);
  } catch (error) {
    console.error('Create treatment product error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

export const updateProduct = async (req, res) => {
  try {
    const product = await TreatmentProduct.findOne({ _id: req.params.id, ...notDeleted });
    if (!product) return res.status(404).json({ message: 'Препарат не найден' });

    const { name, type, description, defaultDosage, applicationMethod, notes, isActive } = req.body;
    if (name !== undefined) product.name = name.trim();
    if (type !== undefined) product.type = type;
    if (description !== undefined) product.description = description;
    if (defaultDosage !== undefined) product.defaultDosage = defaultDosage;
    if (applicationMethod !== undefined) product.applicationMethod = applicationMethod;
    if (notes !== undefined) product.notes = notes;
    if (isActive !== undefined) product.isActive = isActive;

    await product.save();
    await createAuditLog(req, {
      action: 'treatment_product.update',
      entityType: 'TreatmentProduct',
      entityId: product._id,
      details: { name: product.name }
    });

    res.json(product);
  } catch (error) {
    console.error('Update treatment product error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

export const deleteProduct = async (req, res) => {
  try {
    const product = await TreatmentProduct.findOne({ _id: req.params.id, ...notDeleted });
    if (!product) return res.status(404).json({ message: 'Препарат не найден' });

    product.deletedAt = new Date();
    await product.save();
    await createAuditLog(req, {
      action: 'treatment_product.delete',
      entityType: 'TreatmentProduct',
      entityId: product._id,
      details: { name: product.name }
    });

    res.json({ message: 'Препарат удалён' });
  } catch (error) {
    console.error('Delete treatment product error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

// ────────────────────────────────────────
// Protocols CRUD
// ────────────────────────────────────────

export const getProtocols = async (req, res) => {
  try {
    const filter = { ...notDeleted };
    if (req.query.phase) filter.phase = req.query.phase;
    const protocols = await TreatmentProtocol.find(filter)
      .populate('entries.product', 'name type defaultDosage applicationMethod')
      .sort({ phase: 1, isDefault: -1, name: 1 });
    res.json(protocols);
  } catch (error) {
    console.error('Get treatment protocols error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

export const getProtocol = async (req, res) => {
  try {
    const protocol = await TreatmentProtocol.findOne({ _id: req.params.id, ...notDeleted })
      .populate('entries.product', 'name type defaultDosage applicationMethod');
    if (!protocol) return res.status(404).json({ message: 'Протокол не найден' });
    res.json(protocol);
  } catch (error) {
    console.error('Get treatment protocol error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

export const createProtocol = async (req, res) => {
  try {
    const { name, phase, isDefault, entries, notes } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ message: 'Укажите название протокола' });
    if (!phase) return res.status(400).json({ message: 'Укажите фазу (veg / flower)' });

    // If setting as default, unset any existing default for this phase
    if (isDefault) {
      await TreatmentProtocol.updateMany(
        { phase, isDefault: true, ...notDeleted },
        { $set: { isDefault: false } }
      );
    }

    const protocol = await TreatmentProtocol.create({
      name: name.trim(),
      phase,
      isDefault: !!isDefault,
      entries: entries || [],
      notes: notes || ''
    });

    await createAuditLog(req, {
      action: 'treatment_protocol.create',
      entityType: 'TreatmentProtocol',
      entityId: protocol._id,
      details: { name: protocol.name, phase, isDefault: !!isDefault }
    });

    const populated = await protocol.populate('entries.product', 'name type defaultDosage applicationMethod');
    res.status(201).json(populated);
  } catch (error) {
    console.error('Create treatment protocol error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

export const updateProtocol = async (req, res) => {
  try {
    const protocol = await TreatmentProtocol.findOne({ _id: req.params.id, ...notDeleted });
    if (!protocol) return res.status(404).json({ message: 'Протокол не найден' });

    const { name, phase, isDefault, entries, notes } = req.body;
    if (name !== undefined) protocol.name = name.trim();
    if (phase !== undefined) protocol.phase = phase;
    if (notes !== undefined) protocol.notes = notes;
    if (entries !== undefined) protocol.entries = entries;

    if (isDefault !== undefined) {
      if (isDefault && !protocol.isDefault) {
        await TreatmentProtocol.updateMany(
          { phase: protocol.phase, isDefault: true, _id: { $ne: protocol._id }, ...notDeleted },
          { $set: { isDefault: false } }
        );
      }
      protocol.isDefault = isDefault;
    }

    await protocol.save();
    await createAuditLog(req, {
      action: 'treatment_protocol.update',
      entityType: 'TreatmentProtocol',
      entityId: protocol._id,
      details: { name: protocol.name }
    });

    await protocol.populate('entries.product', 'name type defaultDosage applicationMethod');
    res.json(protocol);
  } catch (error) {
    console.error('Update treatment protocol error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

export const deleteProtocol = async (req, res) => {
  try {
    const protocol = await TreatmentProtocol.findOne({ _id: req.params.id, ...notDeleted });
    if (!protocol) return res.status(404).json({ message: 'Протокол не найден' });

    protocol.deletedAt = new Date();
    await protocol.save();
    await createAuditLog(req, {
      action: 'treatment_protocol.delete',
      entityType: 'TreatmentProtocol',
      entityId: protocol._id,
      details: { name: protocol.name }
    });

    res.json({ message: 'Протокол удалён' });
  } catch (error) {
    console.error('Delete treatment protocol error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

export const setDefaultProtocol = async (req, res) => {
  try {
    const protocol = await TreatmentProtocol.findOne({ _id: req.params.id, ...notDeleted });
    if (!protocol) return res.status(404).json({ message: 'Протокол не найден' });

    await TreatmentProtocol.updateMany(
      { phase: protocol.phase, isDefault: true, _id: { $ne: protocol._id }, ...notDeleted },
      { $set: { isDefault: false } }
    );

    protocol.isDefault = true;
    await protocol.save();

    await createAuditLog(req, {
      action: 'treatment_protocol.set_default',
      entityType: 'TreatmentProtocol',
      entityId: protocol._id,
      details: { name: protocol.name, phase: protocol.phase }
    });

    res.json(protocol);
  } catch (error) {
    console.error('Set default protocol error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

// ────────────────────────────────────────
// Schedules
// ────────────────────────────────────────

export const getSchedule = async (req, res) => {
  try {
    const { targetType, targetId } = req.params;
    const schedule = await RoomTreatmentSchedule.findOne({
      targetType, targetId, isActive: true, ...notDeleted
    })
      .populate('entries.product', 'name type defaultDosage applicationMethod')
      .populate('sourceProtocol', 'name phase')
      .populate('completions.completedBy', 'name');

    if (!schedule) return res.json(null);
    res.json(schedule);
  } catch (error) {
    console.error('Get schedule error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

export const applyProtocol = async (req, res) => {
  try {
    const { targetType, targetId, cycleId, protocolId, entries: customEntries } = req.body;

    if (!targetType || !targetId) {
      return res.status(400).json({ message: 'Укажите targetType и targetId' });
    }

    // Deactivate existing active schedule
    await RoomTreatmentSchedule.updateMany(
      { targetType, targetId, isActive: true },
      { $set: { isActive: false } }
    );

    let entries = [];
    let sourceProtocol = null;

    if (protocolId) {
      const protocol = await TreatmentProtocol.findOne({ _id: protocolId, ...notDeleted });
      if (!protocol) return res.status(404).json({ message: 'Протокол не найден' });
      sourceProtocol = protocol._id;
      entries = protocol.entries.map(e => ({
        product: e.product,
        intervalDays: e.intervalDays,
        dosage: e.dosage,
        startDay: e.startDay,
        endDay: e.endDay,
        notes: e.notes,
        isActive: true
      }));
    }

    // Apply custom entries (override or ad-hoc)
    if (customEntries && Array.isArray(customEntries)) {
      entries = customEntries.map(e => ({
        product: e.product,
        intervalDays: e.intervalDays,
        dosage: e.dosage || '',
        startDay: e.startDay || 1,
        endDay: e.endDay || null,
        notes: e.notes || '',
        isActive: true
      }));
    }

    const schedule = await RoomTreatmentSchedule.create({
      targetType,
      targetId,
      cycleId: cycleId || null,
      sourceProtocol,
      entries,
      completions: [],
      isActive: true
    });

    await createAuditLog(req, {
      action: 'treatment_schedule.apply',
      entityType: 'RoomTreatmentSchedule',
      entityId: schedule._id,
      details: { targetType, targetId: targetId.toString(), entriesCount: entries.length }
    });

    await schedule.populate('entries.product', 'name type defaultDosage applicationMethod');
    res.status(201).json(schedule);
  } catch (error) {
    console.error('Apply protocol error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

export const updateSchedule = async (req, res) => {
  try {
    const schedule = await RoomTreatmentSchedule.findOne({ _id: req.params.id, isActive: true, ...notDeleted });
    if (!schedule) return res.status(404).json({ message: 'Расписание не найдено' });

    const { entries } = req.body;
    if (entries !== undefined) {
      schedule.entries = entries.map(e => ({
        product: e.product,
        intervalDays: e.intervalDays,
        dosage: e.dosage || '',
        startDay: e.startDay || 1,
        endDay: e.endDay || null,
        notes: e.notes || '',
        isActive: e.isActive !== false
      }));
    }

    await schedule.save();
    await schedule.populate('entries.product', 'name type defaultDosage applicationMethod');
    res.json(schedule);
  } catch (error) {
    console.error('Update schedule error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

export const completeTreatment = async (req, res) => {
  try {
    const schedule = await RoomTreatmentSchedule.findOne({ _id: req.params.id, isActive: true, ...notDeleted });
    if (!schedule) return res.status(404).json({ message: 'Расписание не найдено' });

    const { entryId, dayOfCycle, notes, completedAt } = req.body;
    if (!entryId) return res.status(400).json({ message: 'Укажите entryId' });

    const entry = schedule.entries.id(entryId);
    if (!entry) return res.status(404).json({ message: 'Запись расписания не найдена' });

    // Get product info
    const product = await TreatmentProduct.findById(entry.product);
    const productName = product?.name || 'Обработка';
    const productType = product?.type || 'chemical';
    const dosage = entry.dosage || product?.defaultDosage || '';

    // Determine actual dayOfCycle
    let actualDay = dayOfCycle;
    if (!actualDay && schedule.targetType === 'FlowerRoom') {
      const room = await FlowerRoom.findById(schedule.targetId);
      actualDay = room?.currentDay || 1;
    }

    // Create RoomTask
    let taskId = null;
    if (schedule.targetType === 'FlowerRoom') {
      const task = await RoomTask.create({
        room: schedule.targetId,
        cycleId: schedule.cycleId,
        type: 'treatment',
        title: `Обработка: ${productName}`,
        description: `${productType === 'chemical' ? 'Химия' : 'Биология'}: ${dosage}`.trim(),
        sprayProduct: productName,
        feedDosage: dosage,
        dayOfCycle: actualDay,
        completed: true,
        completedAt: completedAt ? new Date(completedAt) : new Date(),
        completedBy: req.user._id
      });
      taskId = task._id;

      // Create RoomLog
      await RoomLog.create({
        room: schedule.targetId,
        cycleId: schedule.cycleId,
        type: 'task_completed',
        title: `Обработка: ${productName}`,
        data: { taskId: task._id, taskType: 'treatment', product: productName, dosage },
        user: req.user._id,
        dayOfCycle: actualDay
      });
    }

    // Add completion
    schedule.completions.push({
      entryId,
      product: entry.product,
      dayOfCycle: actualDay || 0,
      completedAt: completedAt ? new Date(completedAt) : new Date(),
      completedBy: req.user._id,
      taskId,
      notes: notes || ''
    });

    await schedule.save();

    await createAuditLog(req, {
      action: 'treatment_schedule.complete',
      entityType: 'RoomTreatmentSchedule',
      entityId: schedule._id,
      details: { productName, dayOfCycle: actualDay, targetType: schedule.targetType }
    });

    await schedule.populate('entries.product', 'name type defaultDosage applicationMethod');
    await schedule.populate('completions.completedBy', 'name');
    res.json(schedule);
  } catch (error) {
    console.error('Complete treatment error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

export const getUpcoming = async (req, res) => {
  try {
    const schedule = await RoomTreatmentSchedule.findOne({ _id: req.params.id, isActive: true, ...notDeleted })
      .populate('entries.product', 'name type defaultDosage applicationMethod');
    if (!schedule) return res.status(404).json({ message: 'Расписание не найдено' });

    // Determine currentDay
    let currentDay = 1;
    if (schedule.targetType === 'FlowerRoom') {
      const room = await FlowerRoom.findById(schedule.targetId);
      currentDay = room?.currentDay || 1;
    } else {
      // VegBatch: calculate days from transplantedToVegAt or createdAt
      const { default: VegBatch } = await import('../models/VegBatch.js');
      const batch = await VegBatch.findById(schedule.targetId);
      if (batch) {
        const start = batch.transplantedToVegAt || batch.createdAt;
        currentDay = Math.max(1, Math.floor((Date.now() - new Date(start).getTime()) / 86400000) + 1);
      }
    }

    const treatments = [];
    for (const entry of schedule.entries) {
      if (!entry.isActive) continue;

      // Find last completion for this entry
      const entryCompletions = schedule.completions
        .filter(c => c.entryId.toString() === entry._id.toString())
        .sort((a, b) => b.dayOfCycle - a.dayOfCycle);

      const lastCompletion = entryCompletions[0] || null;
      const lastCompletedDay = lastCompletion?.dayOfCycle || null;

      // Calculate next due day
      let nextDueDay;
      if (lastCompletedDay === null) {
        nextDueDay = entry.startDay || 1;
      } else {
        nextDueDay = lastCompletedDay + entry.intervalDays;
      }

      // Check if entry is finished (past endDay)
      if (entry.endDay && nextDueDay > entry.endDay) {
        treatments.push({
          entryId: entry._id,
          product: entry.product,
          intervalDays: entry.intervalDays,
          dosage: entry.dosage || entry.product?.defaultDosage || '',
          nextDueDay: null,
          lastCompletedDay,
          completionCount: entryCompletions.length,
          status: 'finished'
        });
        continue;
      }

      let status = 'upcoming';
      if (nextDueDay < currentDay) status = 'overdue';
      else if (nextDueDay === currentDay) status = 'due_today';

      treatments.push({
        entryId: entry._id,
        product: entry.product,
        intervalDays: entry.intervalDays,
        dosage: entry.dosage || entry.product?.defaultDosage || '',
        nextDueDay,
        lastCompletedDay,
        completionCount: entryCompletions.length,
        status
      });
    }

    // Sort: overdue first, then due_today, then upcoming, then finished
    const order = { overdue: 0, due_today: 1, upcoming: 2, finished: 3 };
    treatments.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || (a.nextDueDay || 999) - (b.nextDueDay || 999));

    res.json({ scheduleId: schedule._id, currentDay, treatments });
  } catch (error) {
    console.error('Get upcoming error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

// ────────────────────────────────────────
// Helper: auto-apply default protocol
// ────────────────────────────────────────

export const applyDefaultProtocol = async (phase, targetType, targetId, cycleId) => {
  try {
    const protocol = await TreatmentProtocol.findOne({ phase, isDefault: true, ...notDeleted });
    if (!protocol || protocol.entries.length === 0) return null;

    // Deactivate existing
    await RoomTreatmentSchedule.updateMany(
      { targetType, targetId, isActive: true },
      { $set: { isActive: false } }
    );

    const schedule = await RoomTreatmentSchedule.create({
      targetType,
      targetId,
      cycleId,
      sourceProtocol: protocol._id,
      entries: protocol.entries.map(e => ({
        product: e.product,
        intervalDays: e.intervalDays,
        dosage: e.dosage,
        startDay: e.startDay,
        endDay: e.endDay,
        notes: e.notes,
        isActive: true
      })),
      completions: [],
      isActive: true
    });

    return schedule;
  } catch (error) {
    console.error('Auto-apply protocol error:', error);
    return null;
  }
};
