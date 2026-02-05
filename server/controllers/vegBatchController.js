import VegBatch from '../models/VegBatch.js';
import FlowerRoom from '../models/FlowerRoom.js';
import mongoose from 'mongoose';
import { createAuditLog } from '../utils/auditLog.js';

const ACTIVE_ROOM_MESSAGE = 'В эту комнату нельзя добавить клоны: в ней уже идёт цикл цветения. Сначала завершите текущий цикл (соберите урожай), затем можно будет добавить новые клоны.';

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

// @desc    Get veg batches (in veg only or by flower room)
// @route   GET /api/veg-batches?inVeg=true | ?flowerRoom=:id
export const getVegBatches = async (req, res) => {
  try {
    const { inVeg, flowerRoom } = req.query;
    const filter = {};
    if (inVeg === 'true') filter.flowerRoom = null;
    if (flowerRoom && mongoose.Types.ObjectId.isValid(flowerRoom)) filter.flowerRoom = flowerRoom;
    const list = await VegBatch.find(filter)
      .populate({ path: 'sourceCloneCut', select: 'cutDate strain quantity strains room', populate: { path: 'room', select: 'name roomNumber' } })
      .populate('flowerRoom', 'name roomNumber')
      .sort({ transplantedToVegAt: -1 });
    res.json(list);
  } catch (error) {
    console.error('Get veg batches error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

// @desc    Create veg batch
// @route   POST /api/veg-batches
export const createVegBatch = async (req, res) => {
  try {
    const { name, sourceCloneCut, strain, quantity, strains, cutDate, transplantedToVegAt, vegDaysTarget, notes } = req.body;
    if (!cutDate || !transplantedToVegAt) {
      return res.status(400).json({ message: 'Укажите дату нарезки и дату пересадки в вегетацию' });
    }
    const { strains: normalizedStrains, strain: derivedStrain, quantity: derivedQuantity } = normalizeStrains(strains, strain, quantity);
    const doc = new VegBatch({
      name: name != null ? String(name).trim() : '',
      sourceCloneCut: sourceCloneCut || null,
      strains: normalizedStrains,
      strain: derivedStrain,
      quantity: derivedQuantity,
      cutDate: new Date(cutDate),
      transplantedToVegAt: new Date(transplantedToVegAt),
      vegDaysTarget: parseInt(vegDaysTarget, 10) || 21,
      notes: notes != null ? String(notes).trim() : ''
    });
    await doc.save();
    await doc.populate({ path: 'sourceCloneCut', select: 'cutDate strain quantity strains room', populate: { path: 'room', select: 'name roomNumber' } });
    await createAuditLog(req, { action: 'veg_batch.create', entityType: 'VegBatch', entityId: doc._id, details: { name: doc.name, quantity: doc.quantity } });
    res.status(201).json(doc);
  } catch (error) {
    console.error('Create veg batch error:', error);
    res.status(500).json({ message: error.message || 'Ошибка сервера' });
  }
};

// @desc    Update veg batch (e.g. assign to flower room)
// @route   PUT /api/veg-batches/:id
export const updateVegBatch = async (req, res) => {
  try {
    const doc = await VegBatch.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'Бэтч не найден' });
    const { name, strain, quantity, strains, cutDate, transplantedToVegAt, vegDaysTarget, flowerRoom, transplantedToFlowerAt, notes } = req.body;
    if (name !== undefined) doc.name = String(name).trim();
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
    if (cutDate !== undefined) doc.cutDate = new Date(cutDate);
    if (transplantedToVegAt !== undefined) doc.transplantedToVegAt = new Date(transplantedToVegAt);
    if (vegDaysTarget !== undefined) doc.vegDaysTarget = parseInt(vegDaysTarget, 10) || 21;
    if (flowerRoom !== undefined) {
      const roomId = flowerRoom || null;
      if (roomId && mongoose.Types.ObjectId.isValid(roomId)) {
        const room = await FlowerRoom.findById(roomId).select('isActive').lean();
        if (room?.isActive) {
          return res.status(400).json({ message: ACTIVE_ROOM_MESSAGE });
        }
      }
      doc.flowerRoom = roomId;
    }
    if (transplantedToFlowerAt !== undefined) doc.transplantedToFlowerAt = transplantedToFlowerAt ? new Date(transplantedToFlowerAt) : null;
    if (notes !== undefined) doc.notes = String(notes).trim();
    await doc.save();
    await doc.populate({ path: 'sourceCloneCut', select: 'cutDate strain quantity strains room', populate: { path: 'room', select: 'name roomNumber' } });
    await doc.populate('flowerRoom', 'name roomNumber');
    await createAuditLog(req, { action: 'veg_batch.update', entityType: 'VegBatch', entityId: doc._id, details: { name: doc.name, flowerRoom: doc.flowerRoom?.toString() } });
    res.json(doc);
  } catch (error) {
    console.error('Update veg batch error:', error);
    res.status(500).json({ message: error.message || 'Ошибка сервера' });
  }
};

// @desc    Delete veg batch
// @route   DELETE /api/veg-batches/:id
export const deleteVegBatch = async (req, res) => {
  try {
    const doc = await VegBatch.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'Бэтч не найден' });
    const name = doc.name;
    const id = doc._id;
    await doc.deleteOne();
    await createAuditLog(req, { action: 'veg_batch.delete', entityType: 'VegBatch', entityId: id, details: { name } });
    res.json({ message: 'Удалено' });
  } catch (error) {
    console.error('Delete veg batch error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};
