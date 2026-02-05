import CloneCut from '../models/CloneCut.js';
import mongoose from 'mongoose';
import { createAuditLog } from '../utils/auditLog.js';
import { notDeleted, deletedOnly } from '../utils/softDelete.js';

const normalizeStrains = (strains, legacyStrain, legacyQuantity) => {
  if (Array.isArray(strains) && strains.length > 0) {
    const list = strains
      .map((s) => ({ strain: String(s.strain || '').trim(), quantity: parseInt(s.quantity, 10) || 0 }))
      .filter((s) => s.strain !== '' || s.quantity > 0);
    if (list.length === 0) return { strains: [], strain: legacyStrain || '', quantity: legacyQuantity || 0 };
    const strain = list.map((s) => s.strain).filter(Boolean).join(', ') || legacyStrain || '';
    const quantity = list.reduce((sum, s) => sum + s.quantity, 0);
    return { strains: list, strain, quantity };
  }
  return { strains: [{ strain: String(legacyStrain || '').trim(), quantity: parseInt(legacyQuantity, 10) || 0 }], strain: legacyStrain || '', quantity: parseInt(legacyQuantity, 10) || 0 };
};

// @desc    Get all clone cuts
// @route   GET /api/clone-cuts
export const getCloneCuts = async (req, res) => {
  try {
    const list = await CloneCut.find(notDeleted).populate('room', 'name roomNumber').sort({ cutDate: 1 });
    res.json(list);
  } catch (error) {
    console.error('Get clone cuts error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

// @desc    Create clone cut "на заказ" (вне комнаты) or upsert by room
// @route   POST /api/clone-cuts
export const upsertCloneCut = async (req, res) => {
  try {
    const { roomId, forOrder, cutDate, strain, quantity, strains, isDone, notes } = req.body;
    const isOrderBatch = Boolean(forOrder) || !roomId;

    if (isOrderBatch) {
      if (!cutDate) {
        return res.status(400).json({ message: 'Укажите дату нарезки (cutDate)' });
      }
      const { strains: normalizedStrains, strain: derivedStrain, quantity: derivedQuantity } = normalizeStrains(strains, strain, quantity);
      const doc = new CloneCut({
        room: null,
        cutDate: new Date(cutDate),
        strains: normalizedStrains,
        strain: derivedStrain,
        quantity: derivedQuantity,
        isDone: Boolean(isDone),
        notes: notes != null ? String(notes).trim() : ''
      });
      await doc.save();
      await createAuditLog(req, { action: 'clone_cut.create_order', entityType: 'CloneCut', entityId: doc._id, details: { cutDate: doc.cutDate, isDone: doc.isDone } });
      return res.status(201).json(doc);
    }

    if (!roomId || !mongoose.Types.ObjectId.isValid(roomId)) {
      return res.status(400).json({ message: 'Укажите комнату (roomId)' });
    }
    if (!cutDate) {
      return res.status(400).json({ message: 'Укажите дату нарезки (cutDate)' });
    }
    const { strains: normalizedStrains, strain: derivedStrain, quantity: derivedQuantity } = normalizeStrains(strains, strain, quantity);

    const data = {
      cutDate: new Date(cutDate),
      strains: normalizedStrains,
      strain: derivedStrain,
      quantity: derivedQuantity,
      isDone: Boolean(isDone),
      notes: notes != null ? String(notes).trim() : ''
    };

    let doc = await CloneCut.findOneAndUpdate(
      { room: roomId, ...notDeleted },
      { $set: { ...data, room: roomId } },
      { new: true, upsert: true }
    );
    await doc.populate('room', 'name roomNumber');
    await createAuditLog(req, { action: 'clone_cut.upsert', entityType: 'CloneCut', entityId: doc._id, details: { roomId, cutDate: data.cutDate, isDone: data.isDone } });
    res.json(doc);
  } catch (error) {
    console.error('Upsert clone cut error:', error);
    res.status(500).json({ message: error.message || 'Ошибка сервера' });
  }
};

// @desc    Update clone cut
// @route   PUT /api/clone-cuts/:id
export const updateCloneCut = async (req, res) => {
  try {
    const { cutDate, strain, quantity, strains, isDone, notes } = req.body;
    const doc = await CloneCut.findOne({ _id: req.params.id, ...notDeleted });
    if (!doc) return res.status(404).json({ message: 'Запись не найдена' });

    if (cutDate !== undefined) doc.cutDate = new Date(cutDate);
    if (strains !== undefined) {
      const norm = normalizeStrains(strains, doc.strain, doc.quantity);
      doc.strains = norm.strains;
      doc.strain = norm.strain;
      doc.quantity = norm.quantity;
    } else if (strain !== undefined || quantity !== undefined) {
      const norm = normalizeStrains(doc.strains, strain !== undefined ? String(strain).trim() : doc.strain, quantity !== undefined ? parseInt(quantity, 10) || 0 : doc.quantity);
      doc.strains = norm.strains;
      doc.strain = norm.strain;
      doc.quantity = norm.quantity;
    }
    if (isDone !== undefined) doc.isDone = Boolean(isDone);
    if (notes !== undefined) doc.notes = String(notes).trim();

    await doc.save();
    if (doc.room) await doc.populate('room', 'name roomNumber');
    await createAuditLog(req, { action: 'clone_cut.update', entityType: 'CloneCut', entityId: doc._id, details: { roomId: doc.room?.toString(), isDone: doc.isDone } });
    res.json(doc);
  } catch (error) {
    console.error('Update clone cut error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};


// @desc    Delete clone cut (soft delete — можно восстановить)
// @route   DELETE /api/clone-cuts/:id
export const deleteCloneCut = async (req, res) => {
  try {
    const doc = await CloneCut.findOne({ _id: req.params.id, ...notDeleted });
    if (!doc) return res.status(404).json({ message: 'Запись не найдена' });
    const id = doc._id;
    const details = { cutDate: doc.cutDate, strain: doc.strain, quantity: doc.quantity, isOrder: !doc.room };
    await createAuditLog(req, { action: 'clone_cut.delete', entityType: 'CloneCut', entityId: id, details });
    doc.deletedAt = new Date();
    await doc.save();
    res.json({ message: 'Удалено (можно восстановить)' });
  } catch (error) {
    console.error('Delete clone cut error:', error);
    res.status(500).json({ message: error.message || 'Ошибка сервера' });
  }
};

// @desc    List deleted clone cuts (for restore)
// @route   GET /api/clone-cuts/deleted
export const getDeletedCloneCuts = async (req, res) => {
  try {
    const list = await CloneCut.find(deletedOnly).populate('room', 'name roomNumber').sort({ deletedAt: -1 });
    res.json(list);
  } catch (error) {
    console.error('Get deleted clone cuts error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

// @desc    Restore clone cut
// @route   POST /api/clone-cuts/deleted/:id/restore
export const restoreCloneCut = async (req, res) => {
  try {
    const doc = await CloneCut.findOne({ _id: req.params.id, ...deletedOnly });
    if (!doc) return res.status(404).json({ message: 'Запись не найдена или уже восстановлена' });
    doc.deletedAt = null;
    await doc.save();
    await doc.populate('room', 'name roomNumber');
    await createAuditLog(req, { action: 'clone_cut.restore', entityType: 'CloneCut', entityId: doc._id, details: { strain: doc.strain } });
    res.json(doc);
  } catch (error) {
    console.error('Restore clone cut error:', error);
    res.status(500).json({ message: error.message || 'Ошибка сервера' });
  }
};

