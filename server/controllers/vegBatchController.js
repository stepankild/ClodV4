import VegBatch from '../models/VegBatch.js';
import FlowerRoom from '../models/FlowerRoom.js';
import mongoose from 'mongoose';
import { createAuditLog } from '../utils/auditLog.js';
import { notDeleted, deletedOnly } from '../utils/softDelete.js';

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

const getDocTotal = (doc) => {
  if (Array.isArray(doc.strains) && doc.strains.length > 0) {
    return doc.strains.reduce((sum, s) => sum + (parseInt(s.quantity, 10) || 0), 0);
  }
  return parseInt(doc.quantity, 10) || 0;
};

const reduceStrainsBySent = (doc, newSentToFlowerStrains, oldSentStrains) => {
  if (!Array.isArray(newSentToFlowerStrains) || newSentToFlowerStrains.length === 0) return;
  const oldSent = Array.isArray(oldSentStrains) ? oldSentStrains : [];
  const oldByStrain = new Map(oldSent.map((s) => [String(s.strain || '').trim(), parseInt(s.quantity, 10) || 0]));
  const newByStrain = new Map();
  for (const s of newSentToFlowerStrains) {
    const name = String(s.strain || '').trim();
    const qty = Math.max(0, parseInt(s.quantity, 10) || 0);
    if (name || qty) newByStrain.set(name, (newByStrain.get(name) || 0) + qty);
  }
  const deltaByStrain = new Map();
  for (const [name, newQty] of newByStrain) {
    const oldQty = oldByStrain.get(name) || 0;
    const delta = Math.max(0, newQty - oldQty);
    if (delta > 0) deltaByStrain.set(name, delta);
  }
  const totalNew = [...newByStrain.values()].reduce((a, b) => a + b, 0);
  const totalOld = [...oldByStrain.values()].reduce((a, b) => a + b, 0);
  const deltaTotal = Math.max(0, totalNew - totalOld);
  if (deltaTotal === 0) return;
  if (Array.isArray(doc.strains) && doc.strains.length > 0) {
    if (deltaByStrain.size > 0) {
      doc.strains = doc.strains.map((row) => {
        const name = String(row.strain || '').trim();
        const sub = deltaByStrain.get(name) || 0;
        const newQty = Math.max(0, (parseInt(row.quantity, 10) || 0) - sub);
        return { strain: row.strain, quantity: newQty };
      });
    } else {
      doc.strains = doc.strains.map((row, i) => ({
        strain: row.strain,
        quantity: i === 0 ? Math.max(0, (parseInt(row.quantity, 10) || 0) - deltaTotal) : (parseInt(row.quantity, 10) || 0)
      }));
    }
    doc.quantity = doc.strains.reduce((sum, s) => sum + (s.quantity || 0), 0);
    doc.strain = doc.strains.map((s) => s.strain).filter(Boolean).join(', ') || doc.strain || '';
  } else {
    doc.quantity = Math.max(0, (parseInt(doc.quantity, 10) || 0) - deltaTotal);
  }
};

// Остаток в бэтче (хороших): всего − погибло − не выросло − утилизировано
const getDocRemainder = (doc) => {
  const total = getDocTotal(doc);
  const died = parseInt(doc.diedCount, 10) || 0;
  const notGrown = parseInt(doc.notGrownCount, 10) || 0;
  const disposed = parseInt(doc.disposedCount, 10) || 0;
  return Math.max(0, total - died - notGrown - disposed);
};

// @desc    Get veg batches (in veg only or by flower room)
// @route   GET /api/veg-batches?inVeg=true | ?flowerRoom=:id
export const getVegBatches = async (req, res) => {
  try {
    const { inVeg, flowerRoom } = req.query;
    const filter = { ...notDeleted };
    if (inVeg !== 'true' && flowerRoom && mongoose.Types.ObjectId.isValid(flowerRoom)) {
      filter.flowerRoom = flowerRoom;
    }
    // при inVeg=true показываем все неудалённые бэтчи (в т.ч. с нулевым остатком — восстановленные из корзины)
    const list = await VegBatch.find(filter)
      .populate({ path: 'sourceCloneCut', select: 'cutDate strain quantity strains room', populate: { path: 'room', select: 'name roomNumber' } })
      .populate('flowerRoom', 'name roomNumber')
      .sort({ transplantedToVegAt: -1 })
      .lean();
    const normalized = list.map((doc) => {
      const lightChanges = Array.isArray(doc.lightChanges) && doc.lightChanges.length > 0
        ? doc.lightChanges.map((c) => {
          const p = c.powerPercent;
          const powerPercent = p != null && p !== '' ? (typeof p === 'number' ? Math.round(Math.min(100, Math.max(0, p))) : Math.round(Math.min(100, Math.max(0, parseInt(p, 10) || 0)))) : null;
          return { date: c.date, powerPercent };
        })
        : (doc.lightChangeDate ? [{ date: doc.lightChangeDate, powerPercent: doc.lightPowerPercent != null ? Math.round(Math.min(100, Math.max(0, Number(doc.lightPowerPercent)))) : null }] : []);
      const initialQty = doc.initialQuantity != null ? doc.initialQuantity : getDocTotal(doc);
      return { ...doc, lightChanges, initialQuantity: initialQty };
    });
    res.json(normalized);
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
    const { diedCount, notGrownCount, lightChanges, sentToFlowerCount } = req.body;
    const normalizedLight = Array.isArray(lightChanges) && lightChanges.length > 0
      ? lightChanges
        .filter((c) => c && c.date)
        .map((c) => ({
          date: new Date(c.date),
          powerPercent: c.powerPercent != null && c.powerPercent !== '' ? Math.min(100, Math.max(0, parseInt(c.powerPercent, 10))) : null
        }))
      : [];
    const doc = new VegBatch({
      name: name != null ? String(name).trim() : '',
      sourceCloneCut: sourceCloneCut || null,
      strains: normalizedStrains,
      strain: derivedStrain,
      quantity: derivedQuantity,
      initialQuantity: derivedQuantity,
      cutDate: new Date(cutDate),
      transplantedToVegAt: new Date(transplantedToVegAt),
      vegDaysTarget: parseInt(vegDaysTarget, 10) || 21,
      notes: notes != null ? String(notes).trim() : '',
      diedCount: parseInt(diedCount, 10) >= 0 ? parseInt(diedCount, 10) : 0,
      notGrownCount: parseInt(notGrownCount, 10) >= 0 ? parseInt(notGrownCount, 10) : 0,
      lightChanges: normalizedLight,
      sentToFlowerCount: parseInt(sentToFlowerCount, 10) >= 0 ? parseInt(sentToFlowerCount, 10) : 0
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
    const doc = await VegBatch.findOne({ _id: req.params.id, ...notDeleted });
    if (!doc) return res.status(404).json({ message: 'Бэтч не найден' });
    const { name, strain, quantity, strains, cutDate, transplantedToVegAt, vegDaysTarget, flowerRoom, transplantedToFlowerAt, notes, diedCount, notGrownCount, lightChanges, sentToFlowerCount, sentToFlowerStrains, disposeRemaining, disposedCount } = req.body;
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
        if (room && room.isActive === true) {
          return res.status(400).json({ message: ACTIVE_ROOM_MESSAGE });
        }
      }
      doc.flowerRoom = roomId;
    }
    if (transplantedToFlowerAt !== undefined) doc.transplantedToFlowerAt = transplantedToFlowerAt ? new Date(transplantedToFlowerAt) : null;
    if (notes !== undefined) doc.notes = String(notes).trim();
    if (diedCount !== undefined) doc.diedCount = parseInt(diedCount, 10) >= 0 ? parseInt(diedCount, 10) : 0;
    if (notGrownCount !== undefined) doc.notGrownCount = parseInt(notGrownCount, 10) >= 0 ? parseInt(notGrownCount, 10) : 0;
    if (lightChanges !== undefined && Array.isArray(lightChanges)) {
      doc.lightChanges = lightChanges
        .filter((c) => c && c.date)
        .map((c) => ({
          date: new Date(c.date),
          powerPercent: c.powerPercent != null && c.powerPercent !== '' ? Math.min(100, Math.max(0, parseInt(c.powerPercent, 10))) : null
        }));
    }
    if (sentToFlowerCount !== undefined) doc.sentToFlowerCount = parseInt(sentToFlowerCount, 10) >= 0 ? parseInt(sentToFlowerCount, 10) : 0;
    if (sentToFlowerStrains !== undefined && Array.isArray(sentToFlowerStrains)) {
      const oldSentStrains = Array.isArray(doc.sentToFlowerStrains) ? [...doc.sentToFlowerStrains] : [];
      doc.sentToFlowerStrains = sentToFlowerStrains
        .filter((s) => s && (s.strain !== undefined || s.quantity > 0))
        .map((s) => ({ strain: String(s.strain || '').trim(), quantity: Math.max(0, parseInt(s.quantity, 10) || 0) }));
      if (flowerRoom !== undefined && doc.sentToFlowerStrains.length > 0) {
        reduceStrainsBySent(doc, doc.sentToFlowerStrains, oldSentStrains);
      }
    }
    if (disposeRemaining === true) {
      const total = getDocTotal(doc);
      const died = parseInt(doc.diedCount, 10) || 0;
      const notGrown = parseInt(doc.notGrownCount, 10) || 0;
      const disposed = parseInt(doc.disposedCount, 10) || 0;
      const remainder = Math.max(0, total - died - notGrown - disposed);
      doc.disposedCount = disposed + remainder;
      doc.deletedAt = new Date();
    }
    if (disposedCount !== undefined) doc.disposedCount = Math.max(0, parseInt(disposedCount, 10) || 0);
    await doc.save();
    await doc.populate({ path: 'sourceCloneCut', select: 'cutDate strain quantity strains room', populate: { path: 'room', select: 'name roomNumber' } });
    await doc.populate('flowerRoom', 'name roomNumber');
    const auditAction = disposeRemaining === true ? 'veg_batch.dispose_remaining' : 'veg_batch.update';
    await createAuditLog(req, { action: auditAction, entityType: 'VegBatch', entityId: doc._id, details: { name: doc.name, flowerRoom: doc.flowerRoom?.toString(), disposedCount: doc.disposedCount } });
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
    const doc = await VegBatch.findOne({ _id: req.params.id, ...notDeleted });
    if (!doc) return res.status(404).json({ message: 'Бэтч не найден' });
    const id = doc._id;
    const details = { name: doc.name, quantity: doc.quantity, flowerRoom: doc.flowerRoom?.toString?.() || doc.flowerRoom };
    await createAuditLog(req, { action: 'veg_batch.delete', entityType: 'VegBatch', entityId: id, details });
    doc.deletedAt = new Date();
    await doc.save();
    res.json({ message: 'Удалено (можно восстановить)' });
  } catch (error) {
    console.error('Delete veg batch error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

export const getDeletedVegBatches = async (req, res) => {
  try {
    const list = await VegBatch.find(deletedOnly)
      .populate({ path: 'sourceCloneCut', select: 'cutDate strain quantity strains room', populate: { path: 'room', select: 'name roomNumber' } })
      .populate('flowerRoom', 'name roomNumber')
      .sort({ deletedAt: -1 });
    res.json(list);
  } catch (error) {
    console.error('Get deleted veg batches error:', error);
    res.status(500).json({ message: 'РћС€РёР±РєР° СЃРµСЂРІРµСЂР°' });
  }
};

export const restoreVegBatch = async (req, res) => {
  try {
    const doc = await VegBatch.findOne({ _id: req.params.id, ...deletedOnly });
    if (!doc) return res.status(404).json({ message: 'Р‘СЌС‚С‡ РЅРµ РЅР°Р№РґРµРЅ РёР»Рё СѓР¶Рµ РІРѕСЃСЃС‚Р°РЅРѕРІР»РµРЅ' });
    doc.deletedAt = null;
    await doc.save();
    await doc.populate({ path: 'sourceCloneCut', select: 'cutDate strain quantity strains room', populate: { path: 'room', select: 'name roomNumber' } });
    await doc.populate('flowerRoom', 'name roomNumber');
    await createAuditLog(req, { action: 'veg_batch.restore', entityType: 'VegBatch', entityId: doc._id, details: { name: doc.name } });
    res.json(doc);
  } catch (error) {
    console.error('Restore veg batch error:', error);
    res.status(500).json({ message: error.message || 'РћС€РёР±РєР° СЃРµСЂРІРµСЂР°' });
  }
};
