import Strain from '../models/Strain.js';
import { notDeleted, deletedOnly } from '../utils/softDelete.js';
import { createAuditLog } from '../utils/auditLog.js';

// @desc    Get all strains (active)
// @route   GET /api/strains
export const getStrains = async (req, res) => {
  try {
    const strains = await Strain.find({ ...notDeleted }).sort({ name: 1 }).lean();
    res.json(strains);
  } catch (error) {
    console.error('Get strains error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

// @desc    Create strain
// @route   POST /api/strains
export const createStrain = async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Название сорта обязательно' });
    }
    const trimmed = name.trim();

    // Проверка дубликата (case-insensitive)
    const existing = await Strain.findOne({
      name: { $regex: new RegExp(`^${trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
      ...notDeleted
    });
    if (existing) {
      return res.status(400).json({ message: `Сорт «${existing.name}» уже существует` });
    }

    const strain = await Strain.create({ name: trimmed });
    await createAuditLog(req, {
      action: 'strain.create',
      entityType: 'Strain',
      entityId: strain._id,
      details: { name: trimmed }
    });
    res.status(201).json(strain);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: 'Такой сорт уже существует' });
    }
    console.error('Create strain error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

// @desc    Update strain
// @route   PUT /api/strains/:id
export const updateStrain = async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Название сорта обязательно' });
    }
    const trimmed = name.trim();
    const strain = await Strain.findOne({ _id: req.params.id, ...notDeleted });
    if (!strain) {
      return res.status(404).json({ message: 'Сорт не найден' });
    }

    // Проверка дубликата (кроме себя)
    const existing = await Strain.findOne({
      _id: { $ne: strain._id },
      name: { $regex: new RegExp(`^${trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
      ...notDeleted
    });
    if (existing) {
      return res.status(400).json({ message: `Сорт «${existing.name}» уже существует` });
    }

    const oldName = strain.name;
    strain.name = trimmed;
    await strain.save();
    await createAuditLog(req, {
      action: 'strain.update',
      entityType: 'Strain',
      entityId: strain._id,
      details: { oldName, newName: trimmed }
    });
    res.json(strain);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: 'Такой сорт уже существует' });
    }
    console.error('Update strain error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

// @desc    Soft-delete strain
// @route   DELETE /api/strains/:id
export const deleteStrain = async (req, res) => {
  try {
    const strain = await Strain.findOne({ _id: req.params.id, ...notDeleted });
    if (!strain) {
      return res.status(404).json({ message: 'Сорт не найден' });
    }
    strain.deletedAt = new Date();
    await strain.save();
    await createAuditLog(req, {
      action: 'strain.delete',
      entityType: 'Strain',
      entityId: strain._id,
      details: { name: strain.name }
    });
    res.json({ message: 'Сорт удалён' });
  } catch (error) {
    console.error('Delete strain error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

// @desc    Get deleted strains
// @route   GET /api/strains/deleted
export const getDeletedStrains = async (req, res) => {
  try {
    const strains = await Strain.find({ ...deletedOnly }).sort({ deletedAt: -1 }).lean();
    res.json(strains);
  } catch (error) {
    console.error('Get deleted strains error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

// @desc    Restore deleted strain
// @route   POST /api/strains/deleted/:id/restore
export const restoreStrain = async (req, res) => {
  try {
    const strain = await Strain.findOne({ _id: req.params.id, ...deletedOnly });
    if (!strain) {
      return res.status(404).json({ message: 'Сорт не найден в архиве' });
    }
    strain.deletedAt = null;
    await strain.save();
    await createAuditLog(req, {
      action: 'strain.restore',
      entityType: 'Strain',
      entityId: strain._id,
      details: { name: strain.name }
    });
    res.json(strain);
  } catch (error) {
    console.error('Restore strain error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};
