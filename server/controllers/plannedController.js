import PlannedCycle from '../models/PlannedCycle.js';
import FlowerRoom from '../models/FlowerRoom.js';
import mongoose from 'mongoose';
import { createAuditLog } from '../utils/auditLog.js';
import { notDeleted, deletedOnly } from '../utils/softDelete.js';
import { t } from '../utils/i18n.js';

// One-time cleanup: drop legacy unique index on `room` that was created when only
// one plan per room was allowed. The startup-time version in the model file may
// not fire early enough on some deploys, so we also guard the first write here.
let staleIndexCleaned = false;
const ensureStaleRoomIndexDropped = async () => {
  if (staleIndexCleaned) return;
  try {
    const indexes = await PlannedCycle.collection.listIndexes().toArray();
    for (const idx of indexes) {
      if (idx.name === '_id_') continue;
      const keyFields = Object.keys(idx.key || {});
      if (idx.unique && keyFields.length === 1 && keyFields[0] === 'room') {
        console.log(`[plannedController] Dropping stale unique index: ${idx.name}`);
        try {
          await PlannedCycle.collection.dropIndex(idx.name);
          console.log(`[plannedController] Dropped ${idx.name}`);
        } catch (err) {
          console.warn(`[plannedController] Failed to drop ${idx.name}:`, err?.message);
        }
      }
    }
    staleIndexCleaned = true;
  } catch (err) {
    console.warn('[plannedController] Index listing failed:', err?.message);
    // don't set the flag — retry on the next call
  }
};

// @desc    Get planned cycles (all or by roomId)
// @route   GET /api/rooms/plans
export const getPlans = async (req, res) => {
  try {
    const { roomId } = req.query;
    const query = { ...notDeleted };
    if (roomId) query.room = roomId;
    const plans = await PlannedCycle.find(query)
      .populate('room', 'name roomNumber')
      .sort({ room: 1, order: 1 });
    res.json(plans);
  } catch (error) {
    console.error('Get plans error:', error);
    res.status(500).json({ message: t('common.serverError', req.lang) });
  }
};

// Normalize a strains array, and compute the legacy single-string / count fields
// for backward compatibility with Overview/Clones.
const normalizeStrains = (strains, legacyStrain, legacyQty) => {
  if (Array.isArray(strains) && strains.length > 0) {
    const cleaned = strains
      .map(s => ({
        strain: String(s.strain || '').trim(),
        quantity: parseInt(s.quantity, 10) || 0
      }))
      .filter(s => s.strain !== '' || s.quantity > 0);
    if (cleaned.length === 0) {
      return { strains: [], strain: String(legacyStrain || '').trim(), plantsCount: parseInt(legacyQty, 10) || 0 };
    }
    const combinedStrain = cleaned.map(s => s.strain).filter(Boolean).join(', ');
    const combinedQty = cleaned.reduce((acc, s) => acc + s.quantity, 0);
    return { strains: cleaned, strain: combinedStrain, plantsCount: combinedQty };
  }
  // Fall back to legacy single-strain form
  const s = String(legacyStrain || '').trim();
  const q = parseInt(legacyQty, 10) || 0;
  return {
    strains: s || q > 0 ? [{ strain: s, quantity: q }] : [],
    strain: s,
    plantsCount: q
  };
};

// @desc    Create or replace planned cycle for a room at a specific `order` slot
// @route   POST /api/rooms/plans
export const createPlan = async (req, res) => {
  try {
    await ensureStaleRoomIndexDropped();
    const { roomId, cycleName, strain, strains, plannedStartDate, plantsCount, floweringDays, cutLeadDays, notes, order } = req.body;
    if (!roomId || !mongoose.Types.ObjectId.isValid(roomId)) {
      return res.status(400).json({ message: t('plans.specifyRoom', req.lang) });
    }
    const room = await FlowerRoom.findById(roomId);
    if (!room) return res.status(404).json({ message: t('rooms.notFound', req.lang) });

    const orderValue = Number.isFinite(parseInt(order, 10)) ? parseInt(order, 10) : 0;
    const normalized = normalizeStrains(strains, strain, plantsCount);

    const data = {
      room: roomId,
      cycleName: cycleName != null ? String(cycleName).trim() : '',
      strain: normalized.strain,
      plantsCount: normalized.plantsCount,
      strains: normalized.strains,
      plannedStartDate: plannedStartDate ? new Date(plannedStartDate) : null,
      floweringDays: parseInt(floweringDays, 10) || 56,
      cutLeadDays: Number.isFinite(parseInt(cutLeadDays, 10)) ? parseInt(cutLeadDays, 10) : 28,
      order: orderValue,
      notes: notes != null ? String(notes).trim() : ''
    };

    // Upsert by {room, order}: one plan per queue slot per room.
    const plan = await PlannedCycle.findOneAndUpdate(
      { room: roomId, order: orderValue, ...notDeleted },
      { $set: data },
      { new: true, upsert: true }
    );
    await createAuditLog(req, { action: 'plan.upsert', entityType: 'PlannedCycle', entityId: plan._id, details: { roomId, order: orderValue, cycleName: plan.cycleName, strain: plan.strain } });
    res.status(201).json(plan);
  } catch (error) {
    console.error('Create plan error:', error?.message, '\nbody:', JSON.stringify(req.body), '\nstack:', error?.stack);
    res.status(500).json({ message: `${t('common.serverError', req.lang)}: ${error?.message || 'unknown'}` });
  }
};

// @desc    Update planned cycle
// @route   PUT /api/rooms/plans/:id
export const updatePlan = async (req, res) => {
  try {
    const { cycleName, strain, strains, plannedStartDate, plantsCount, floweringDays, cutLeadDays, notes, order } = req.body;
    const plan = await PlannedCycle.findOne({ _id: req.params.id, ...notDeleted });
    if (!plan) return res.status(404).json({ message: t('plans.notFound', req.lang) });

    if (cycleName !== undefined) plan.cycleName = String(cycleName).trim();
    if (strains !== undefined || strain !== undefined || plantsCount !== undefined) {
      const normalized = normalizeStrains(
        strains !== undefined ? strains : plan.strains,
        strain !== undefined ? strain : plan.strain,
        plantsCount !== undefined ? plantsCount : plan.plantsCount
      );
      plan.strains = normalized.strains;
      plan.strain = normalized.strain;
      plan.plantsCount = normalized.plantsCount;
    }
    if (plannedStartDate !== undefined) plan.plannedStartDate = plannedStartDate ? new Date(plannedStartDate) : null;
    if (floweringDays !== undefined) plan.floweringDays = parseInt(floweringDays, 10) || 56;
    if (cutLeadDays !== undefined) {
      const v = parseInt(cutLeadDays, 10);
      if (Number.isFinite(v)) plan.cutLeadDays = v;
    }
    if (notes !== undefined) plan.notes = String(notes).trim();
    if (order !== undefined) {
      const v = parseInt(order, 10);
      if (Number.isFinite(v)) plan.order = v;
    }

    await plan.save();
    res.json(plan);
  } catch (error) {
    console.error('Update plan error:', error);
    res.status(500).json({ message: t('common.serverError', req.lang) });
  }
};

// @desc    Delete planned cycle
// @route   DELETE /api/rooms/plans/:id
export const deletePlan = async (req, res) => {
  try {
    const plan = await PlannedCycle.findOne({ _id: req.params.id, ...notDeleted });
    if (!plan) return res.status(404).json({ message: t('plans.notFound', req.lang) });
    const roomId = plan.room?.toString();
    const cycleName = plan.cycleName;
    await createAuditLog(req, { action: 'plan.delete', entityType: 'PlannedCycle', entityId: req.params.id, details: { roomId, cycleName } });
    plan.deletedAt = new Date();
    await plan.save();
    res.json({ message: t('plans.deleted', req.lang) });
  } catch (error) {
    console.error('Delete plan error:', error);
    res.status(500).json({ message: t('common.serverError', req.lang) });
  }
};

// @desc    Get deleted planned cycles
// @route   GET /api/rooms/plans/deleted
export const getDeletedPlans = async (req, res) => {
  try {
    const plans = await PlannedCycle.find({ ...deletedOnly })
      .populate('room', 'name roomNumber')
      .sort({ deletedAt: -1 });
    res.json(plans);
  } catch (error) {
    console.error('Get deleted plans error:', error);
    res.status(500).json({ message: t('common.serverError', req.lang) });
  }
};

// @desc    Restore deleted planned cycle
// @route   POST /api/rooms/plans/deleted/:id/restore
export const restorePlan = async (req, res) => {
  try {
    const plan = await PlannedCycle.findOne({ _id: req.params.id, ...deletedOnly });
    if (!plan) return res.status(404).json({ message: t('plans.deletedNotFound', req.lang) });
    plan.deletedAt = null;
    await plan.save();
    await createAuditLog(req, { action: 'plan.restore', entityType: 'PlannedCycle', entityId: plan._id, details: { roomId: plan.room?.toString() } });
    res.json(plan);
  } catch (error) {
    console.error('Restore plan error:', error);
    res.status(500).json({ message: t('common.serverError', req.lang) });
  }
};
