import PlannedCycle from '../models/PlannedCycle.js';
import FlowerRoom from '../models/FlowerRoom.js';
import mongoose from 'mongoose';
import { createAuditLog } from '../utils/auditLog.js';
import { notDeleted, deletedOnly } from '../utils/softDelete.js';
import { t } from '../utils/i18n.js';

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

// @desc    Create or replace planned cycle for a room at a specific `order` slot
// @route   POST /api/rooms/plans
export const createPlan = async (req, res) => {
  try {
    const { roomId, cycleName, strain, plannedStartDate, plantsCount, floweringDays, notes, order } = req.body;
    if (!roomId || !mongoose.Types.ObjectId.isValid(roomId)) {
      return res.status(400).json({ message: t('plans.specifyRoom', req.lang) });
    }
    const room = await FlowerRoom.findById(roomId);
    if (!room) return res.status(404).json({ message: t('rooms.notFound', req.lang) });

    const orderValue = Number.isFinite(parseInt(order, 10)) ? parseInt(order, 10) : 0;

    const data = {
      room: roomId,
      cycleName: cycleName != null ? String(cycleName).trim() : '',
      strain: strain != null ? String(strain).trim() : '',
      plannedStartDate: plannedStartDate ? new Date(plannedStartDate) : null,
      plantsCount: parseInt(plantsCount, 10) || 0,
      floweringDays: parseInt(floweringDays, 10) || 56,
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
    console.error('Create plan error:', error);
    res.status(500).json({ message: t('common.serverError', req.lang) });
  }
};

// @desc    Update planned cycle
// @route   PUT /api/rooms/plans/:id
export const updatePlan = async (req, res) => {
  try {
    const { cycleName, strain, plannedStartDate, plantsCount, floweringDays, notes, order } = req.body;
    const plan = await PlannedCycle.findOne({ _id: req.params.id, ...notDeleted });
    if (!plan) return res.status(404).json({ message: t('plans.notFound', req.lang) });

    if (cycleName !== undefined) plan.cycleName = String(cycleName).trim();
    if (strain !== undefined) plan.strain = String(strain).trim();
    if (plannedStartDate !== undefined) plan.plannedStartDate = plannedStartDate ? new Date(plannedStartDate) : null;
    if (plantsCount !== undefined) plan.plantsCount = parseInt(plantsCount, 10) || 0;
    if (floweringDays !== undefined) plan.floweringDays = parseInt(floweringDays, 10) || 56;
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
