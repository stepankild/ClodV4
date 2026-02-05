import SelectionBatch from '../models/SelectionBatch.js';
import { createAuditLog } from '../utils/auditLog.js';

// @desc    Get all selection batches
// @route   GET /api/selection
export const getSelectionBatches = async (req, res) => {
  try {
    const { status } = req.query;
    const filter = {};
    if (status && ['active', 'archived'].includes(status)) filter.status = status;
    const list = await SelectionBatch.find(filter).sort({ startedAt: -1, createdAt: -1 });
    res.json(list);
  } catch (error) {
    console.error('Get selection batches error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

// @desc    Get one selection batch
// @route   GET /api/selection/:id
export const getSelectionBatch = async (req, res) => {
  try {
    const doc = await SelectionBatch.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'Бэтч селекции не найден' });
    res.json(doc);
  } catch (error) {
    console.error('Get selection batch error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

const normalizePlant = (p) => ({
  name: String(p.name || '').trim(),
  firstCloneCutAt: p.firstCloneCutAt ? new Date(p.firstCloneCutAt) : null,
  traitsDescription: String(p.traitsDescription || '').trim(),
  developmentLog: Array.isArray(p.developmentLog) ? p.developmentLog.map((e) => ({ date: new Date(e.date), text: String(e.text || '') })) : [],
  ratings: Array.isArray(p.ratings) ? p.ratings.map((r) => ({ criterion: String(r.criterion || '').trim(), score: Math.min(10, Math.max(0, Number(r.score) || 0)) })) : []
});

// @desc    Create selection batch
// @route   POST /api/selection
export const createSelectionBatch = async (req, res) => {
  try {
    const { name, strain, startedAt, notes, plants } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ message: 'Укажите название бэтча селекции' });
    }
    const doc = new SelectionBatch({
      name: String(name).trim(),
      strain: strain != null ? String(strain).trim() : '',
      startedAt: startedAt ? new Date(startedAt) : null,
      notes: notes != null ? String(notes).trim() : '',
      plants: Array.isArray(plants) ? plants.map(normalizePlant) : [],
      status: 'active'
    });
    await doc.save();
    await createAuditLog(req, { action: 'selection.create', entityType: 'SelectionBatch', entityId: doc._id, details: { name: doc.name } });
    res.status(201).json(doc);
  } catch (error) {
    console.error('Create selection batch error:', error);
    res.status(500).json({ message: error.message || 'Ошибка сервера' });
  }
};

// @desc    Update selection batch
// @route   PUT /api/selection/:id
export const updateSelectionBatch = async (req, res) => {
  try {
    const doc = await SelectionBatch.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'Бэтч селекции не найден' });
    const { name, strain, startedAt, notes, plants, status } = req.body;

    if (name !== undefined) doc.name = String(name).trim();
    if (strain !== undefined) doc.strain = String(strain).trim();
    if (startedAt !== undefined) doc.startedAt = startedAt ? new Date(startedAt) : null;
    if (notes !== undefined) doc.notes = String(notes).trim();
    if (Array.isArray(plants)) {
      doc.plants = plants.map(normalizePlant);
    }
    if (status !== undefined && ['active', 'archived'].includes(status)) doc.status = status;

    await doc.save();
    await createAuditLog(req, { action: 'selection.update', entityType: 'SelectionBatch', entityId: doc._id, details: { name: doc.name } });
    res.json(doc);
  } catch (error) {
    console.error('Update selection batch error:', error);
    res.status(500).json({ message: error.message || 'Ошибка сервера' });
  }
};

// @desc    Delete selection batch
// @route   DELETE /api/selection/:id
export const deleteSelectionBatch = async (req, res) => {
  try {
    const doc = await SelectionBatch.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'Бэтч селекции не найден' });
    const id = doc._id;
    const name = doc.name;
    await doc.deleteOne();
    await createAuditLog(req, { action: 'selection.delete', entityType: 'SelectionBatch', entityId: id, details: { name } });
    res.json({ message: 'Удалено' });
  } catch (error) {
    console.error('Delete selection batch error:', error);
    res.status(500).json({ message: error.message || 'Ошибка сервера' });
  }
};
