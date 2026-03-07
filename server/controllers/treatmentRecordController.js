import TreatmentRecord from '../models/TreatmentRecord.js';
import TreatmentProduct from '../models/TreatmentProduct.js';
import FlowerRoom from '../models/FlowerRoom.js';
import RoomLog from '../models/RoomLog.js';
import { notDeleted, deletedOnly } from '../utils/softDelete.js';
import { createAuditLog } from '../utils/auditLog.js';
import { t } from '../utils/i18n.js';

// @desc    Get treatment records (with filters)
// @route   GET /api/treatments
export const getRecords = async (req, res) => {
  try {
    const { roomId, from, to, status, limit = 200 } = req.query;
    const query = { ...notDeleted };

    if (roomId) query.room = roomId;
    if (status) query.status = status;
    if (from || to) {
      query.scheduledDate = {};
      if (from) query.scheduledDate.$gte = new Date(from);
      if (to) query.scheduledDate.$lte = new Date(to);
    }

    const records = await TreatmentRecord.find(query)
      .populate('room', 'name roomNumber status')
      .populate('product', 'name type concentration')
      .populate('completedBy', 'name')
      .populate('worker', 'name')
      .sort({ scheduledDate: 1 })
      .limit(parseInt(limit))
      .lean();

    res.json(records);
  } catch (error) {
    console.error('Get treatment records error:', error);
    res.status(500).json({ message: t('common.serverError', req.lang) });
  }
};

// @desc    Get calendar view (records grouped by date)
// @route   GET /api/treatments/calendar
export const getCalendar = async (req, res) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) {
      return res.status(400).json({ message: t('treatments.fromToRequired', req.lang) });
    }

    const records = await TreatmentRecord.find({
      ...notDeleted,
      scheduledDate: {
        $gte: new Date(from),
        $lte: new Date(to)
      }
    })
      .populate('room', 'name roomNumber status')
      .populate('product', 'name type concentration')
      .populate('completedBy', 'name')
      .populate('worker', 'name')
      .sort({ scheduledDate: 1 })
      .lean();

    res.json(records);
  } catch (error) {
    console.error('Get treatment calendar error:', error);
    res.status(500).json({ message: t('common.serverError', req.lang) });
  }
};

// @desc    Get treatment history for a room
// @route   GET /api/treatments/room/:roomId
export const getRoomHistory = async (req, res) => {
  try {
    const { roomId } = req.params;
    const records = await TreatmentRecord.find({
      room: roomId,
      ...notDeleted
    })
      .populate('product', 'name type concentration')
      .populate('completedBy', 'name')
      .populate('worker', 'name')
      .sort({ scheduledDate: -1 })
      .limit(100)
      .lean();

    res.json(records);
  } catch (error) {
    console.error('Get room treatment history error:', error);
    res.status(500).json({ message: t('common.serverError', req.lang) });
  }
};

// @desc    Create treatment record
// @route   POST /api/treatments
export const createRecord = async (req, res) => {
  try {
    const {
      roomId,
      productId,
      dosage,
      applicationMethod,
      scheduledDate,
      worker,
      notes,
      status
    } = req.body;

    if (!roomId || !scheduledDate) {
      return res.status(400).json({ message: t('treatments.roomAndDateRequired', req.lang) });
    }

    const room = await FlowerRoom.findById(roomId);
    if (!room) {
      return res.status(404).json({ message: t('rooms.notFound', req.lang) });
    }

    // Денормализуем данные продукта
    let productName = '';
    let productType = '';
    let defaultDosage = '';
    if (productId) {
      const product = await TreatmentProduct.findById(productId);
      if (product) {
        productName = product.name;
        productType = product.type;
        defaultDosage = product.concentration;
      }
    }

    const recordData = {
      room: roomId,
      cycleId: room.currentCycleId || null,
      product: productId || null,
      productName,
      productType,
      dosage: dosage || defaultDosage,
      applicationMethod: applicationMethod || 'spray',
      status: status || 'planned',
      scheduledDate: new Date(scheduledDate),
      worker: worker || null,
      notes: notes || '',
      dayOfCycle: room.currentDay || null
    };

    // Если записываем как выполненную сразу
    if (recordData.status === 'completed') {
      recordData.completedAt = new Date();
      recordData.completedBy = req.user._id;
    }

    const record = await TreatmentRecord.create(recordData);

    // Если completed — создаём RoomLog
    if (record.status === 'completed') {
      await RoomLog.create({
        room: roomId,
        cycleId: room.currentCycleId,
        type: 'treatment',
        title: `Обработка: ${productName || 'без препарата'}`,
        description: dosage ? `Дозировка: ${dosage}` : '',
        data: {
          treatmentId: record._id,
          productName,
          productType,
          dosage: record.dosage,
          applicationMethod: record.applicationMethod
        },
        user: req.user._id,
        dayOfCycle: room.currentDay
      });
    }

    await record.populate('room', 'name roomNumber status');
    await record.populate('product', 'name type concentration');
    await record.populate('completedBy', 'name');
    await record.populate('worker', 'name');

    await createAuditLog(req, {
      action: 'treatment.create',
      entityType: 'TreatmentRecord',
      entityId: record._id,
      details: { roomName: room.name, productName, status: record.status }
    });
    res.status(201).json(record);
  } catch (error) {
    console.error('Create treatment record error:', error);
    res.status(500).json({ message: t('common.serverError', req.lang) });
  }
};

// @desc    Update treatment record
// @route   PUT /api/treatments/:id
export const updateRecord = async (req, res) => {
  try {
    const {
      productId,
      dosage,
      applicationMethod,
      scheduledDate,
      worker,
      notes
    } = req.body;

    const record = await TreatmentRecord.findOne({ _id: req.params.id, ...notDeleted });
    if (!record) {
      return res.status(404).json({ message: t('treatments.notFound', req.lang) });
    }

    if (productId !== undefined) {
      record.product = productId || null;
      if (productId) {
        const product = await TreatmentProduct.findById(productId);
        if (product) {
          record.productName = product.name;
          record.productType = product.type;
        }
      } else {
        record.productName = '';
        record.productType = '';
      }
    }
    if (dosage !== undefined) record.dosage = dosage;
    if (applicationMethod !== undefined) record.applicationMethod = applicationMethod;
    if (scheduledDate !== undefined) record.scheduledDate = new Date(scheduledDate);
    if (worker !== undefined) record.worker = worker || null;
    if (notes !== undefined) record.notes = notes;

    await record.save();
    await record.populate('room', 'name roomNumber status');
    await record.populate('product', 'name type concentration');
    await record.populate('completedBy', 'name');
    await record.populate('worker', 'name');

    await createAuditLog(req, {
      action: 'treatment.update',
      entityType: 'TreatmentRecord',
      entityId: record._id,
      details: { productName: record.productName }
    });
    res.json(record);
  } catch (error) {
    console.error('Update treatment record error:', error);
    res.status(500).json({ message: t('common.serverError', req.lang) });
  }
};

// @desc    Complete treatment record
// @route   PUT /api/treatments/:id/complete
export const completeRecord = async (req, res) => {
  try {
    const record = await TreatmentRecord.findOne({ _id: req.params.id, ...notDeleted });
    if (!record) {
      return res.status(404).json({ message: t('treatments.notFound', req.lang) });
    }

    const room = await FlowerRoom.findById(record.room);

    record.status = 'completed';
    record.completedAt = new Date();
    record.completedBy = req.user._id;
    record.dayOfCycle = room?.currentDay || record.dayOfCycle;

    await record.save();

    // Создаём RoomLog
    await RoomLog.create({
      room: record.room,
      cycleId: room?.currentCycleId || record.cycleId,
      type: 'treatment',
      title: `Обработка: ${record.productName || 'без препарата'}`,
      description: record.dosage ? `Дозировка: ${record.dosage}` : '',
      data: {
        treatmentId: record._id,
        productName: record.productName,
        productType: record.productType,
        dosage: record.dosage,
        applicationMethod: record.applicationMethod
      },
      user: req.user._id,
      dayOfCycle: room?.currentDay
    });

    await record.populate('room', 'name roomNumber status');
    await record.populate('product', 'name type concentration');
    await record.populate('completedBy', 'name');
    await record.populate('worker', 'name');

    await createAuditLog(req, {
      action: 'treatment.complete',
      entityType: 'TreatmentRecord',
      entityId: record._id,
      details: { roomName: room?.name, productName: record.productName }
    });
    res.json(record);
  } catch (error) {
    console.error('Complete treatment record error:', error);
    res.status(500).json({ message: t('common.serverError', req.lang) });
  }
};

// @desc    Skip treatment record
// @route   PUT /api/treatments/:id/skip
export const skipRecord = async (req, res) => {
  try {
    const { notes } = req.body;
    const record = await TreatmentRecord.findOne({ _id: req.params.id, ...notDeleted });
    if (!record) {
      return res.status(404).json({ message: t('treatments.notFound', req.lang) });
    }

    record.status = 'skipped';
    if (notes !== undefined) record.notes = notes;

    await record.save();
    await record.populate('room', 'name roomNumber status');
    await record.populate('product', 'name type concentration');
    await record.populate('worker', 'name');

    await createAuditLog(req, {
      action: 'treatment.skip',
      entityType: 'TreatmentRecord',
      entityId: record._id,
      details: { productName: record.productName }
    });
    res.json(record);
  } catch (error) {
    console.error('Skip treatment record error:', error);
    res.status(500).json({ message: t('common.serverError', req.lang) });
  }
};

// @desc    Soft-delete treatment record
// @route   DELETE /api/treatments/:id
export const deleteRecord = async (req, res) => {
  try {
    const record = await TreatmentRecord.findOne({ _id: req.params.id, ...notDeleted });
    if (!record) {
      return res.status(404).json({ message: t('treatments.notFound', req.lang) });
    }
    record.deletedAt = new Date();
    await record.save();
    await createAuditLog(req, {
      action: 'treatment.delete',
      entityType: 'TreatmentRecord',
      entityId: record._id,
      details: { productName: record.productName }
    });
    res.json({ message: t('treatments.recordDeleted', req.lang) });
  } catch (error) {
    console.error('Delete treatment record error:', error);
    res.status(500).json({ message: t('common.serverError', req.lang) });
  }
};

// @desc    Get deleted records
// @route   GET /api/treatments/deleted
export const getDeletedRecords = async (req, res) => {
  try {
    const records = await TreatmentRecord.find({ ...deletedOnly })
      .populate('room', 'name roomNumber')
      .populate('product', 'name type')
      .populate('completedBy', 'name')
      .sort({ deletedAt: -1 })
      .limit(100)
      .lean();
    res.json(records);
  } catch (error) {
    console.error('Get deleted treatment records error:', error);
    res.status(500).json({ message: t('common.serverError', req.lang) });
  }
};

// @desc    Restore deleted record
// @route   POST /api/treatments/deleted/:id/restore
export const restoreRecord = async (req, res) => {
  try {
    const record = await TreatmentRecord.findOne({ _id: req.params.id, ...deletedOnly });
    if (!record) {
      return res.status(404).json({ message: t('treatments.notFoundInArchive', req.lang) });
    }
    record.deletedAt = null;
    await record.save();
    await record.populate('room', 'name roomNumber status');
    await record.populate('product', 'name type concentration');
    await createAuditLog(req, {
      action: 'treatment.restore',
      entityType: 'TreatmentRecord',
      entityId: record._id,
      details: { productName: record.productName }
    });
    res.json(record);
  } catch (error) {
    console.error('Restore treatment record error:', error);
    res.status(500).json({ message: t('common.serverError', req.lang) });
  }
};
