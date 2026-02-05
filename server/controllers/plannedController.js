import PlannedCycle from '../models/PlannedCycle.js';
import FlowerRoom from '../models/FlowerRoom.js';
import mongoose from 'mongoose';
import { createAuditLog } from '../utils/auditLog.js';

// @desc    Get planned cycles (all or by roomId)
// @route   GET /api/rooms/plans
export const getPlans = async (req, res) => {
  try {
    const { roomId } = req.query;
    const query = roomId ? { room: roomId } : {};
    const plans = await PlannedCycle.find(query).populate('room', 'name roomNumber').sort({ room: 1 });
    res.json(plans);
  } catch (error) {
    console.error('Get plans error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

// @desc    Create or replace planned cycle for a room (one plan per room)
// @route   POST /api/rooms/plans
export const createPlan = async (req, res) => {
  try {
    const { roomId, cycleName, strain, plannedStartDate, plantsCount, floweringDays, notes } = req.body;
    if (!roomId || !mongoose.Types.ObjectId.isValid(roomId)) {
      return res.status(400).json({ message: 'Укажите комнату (roomId)' });
    }
    const room = await FlowerRoom.findById(roomId);
    if (!room) return res.status(404).json({ message: 'Комната не найдена' });

    const data = {
      room: roomId,
      cycleName: cycleName != null ? String(cycleName).trim() : '',
      strain: strain != null ? String(strain).trim() : '',
      plannedStartDate: plannedStartDate ? new Date(plannedStartDate) : null,
      plantsCount: parseInt(plantsCount, 10) || 0,
      floweringDays: parseInt(floweringDays, 10) || 56,
      notes: notes != null ? String(notes).trim() : ''
    };

    const plan = await PlannedCycle.findOneAndUpdate(
      { room: roomId },
      { $set: data },
      { new: true, upsert: true }
    );
    await createAuditLog(req, { action: 'plan.upsert', entityType: 'PlannedCycle', entityId: plan._id, details: { roomId, cycleName: plan.cycleName, strain: plan.strain } });
    res.status(201).json(plan);
  } catch (error) {
    console.error('Create plan error:', error);
    res.status(500).json({ message: error.message || 'Ошибка сервера' });
  }
};

// @desc    Update planned cycle
// @route   PUT /api/rooms/plans/:id
export const updatePlan = async (req, res) => {
  try {
    const { cycleName, strain, plannedStartDate, plantsCount, floweringDays, notes } = req.body;
    const plan = await PlannedCycle.findById(req.params.id);
    if (!plan) return res.status(404).json({ message: 'План не найден' });

    if (cycleName !== undefined) plan.cycleName = String(cycleName).trim();
    if (strain !== undefined) plan.strain = String(strain).trim();
    if (plannedStartDate !== undefined) plan.plannedStartDate = plannedStartDate ? new Date(plannedStartDate) : null;
    if (plantsCount !== undefined) plan.plantsCount = parseInt(plantsCount, 10) || 0;
    if (floweringDays !== undefined) plan.floweringDays = parseInt(floweringDays, 10) || 56;
    if (notes !== undefined) plan.notes = String(notes).trim();

    await plan.save();
    res.json(plan);
  } catch (error) {
    console.error('Update plan error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

// @desc    Delete planned cycle
// @route   DELETE /api/rooms/plans/:id
export const deletePlan = async (req, res) => {
  try {
    const plan = await PlannedCycle.findById(req.params.id);
    if (!plan) return res.status(404).json({ message: 'План не найден' });
    const roomId = plan.room?.toString();
    const cycleName = plan.cycleName;
    await plan.deleteOne();
    await createAuditLog(req, { action: 'plan.delete', entityType: 'PlannedCycle', entityId: req.params.id, details: { roomId, cycleName } });
    res.json({ message: 'План удалён' });
  } catch (error) {
    console.error('Delete plan error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};
