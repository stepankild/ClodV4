import MotherPlant from '../models/MotherPlant.js';
import MotherRoomMap from '../models/MotherRoomMap.js';
import { createAuditLog } from '../utils/auditLog.js';
import { notDeleted, deletedOnly } from '../utils/softDelete.js';
import { t } from '../utils/i18n.js';

// ─── Plants ───

// @desc    Get mother plants (active, optionally include retired)
// @route   GET /api/mother-room/plants
export const getPlants = async (req, res) => {
  try {
    const filter = { ...notDeleted };
    if (req.query.includeRetired !== 'true') {
      filter.$and = [{ $or: [{ retiredAt: null }, { retiredAt: { $exists: false } }] }];
    }
    const list = await MotherPlant.find(filter).sort({ plantedDate: 1 });
    res.json(list);
  } catch (error) {
    console.error('Get mother plants error:', error);
    res.status(500).json({ message: t('common.serverError', req.lang) });
  }
};

// @desc    Create mother plant
// @route   POST /api/mother-room/plants
export const createPlant = async (req, res) => {
  try {
    const { name, strain, plantedDate, health, notes } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ message: t('mothers.nameRequired', req.lang) });
    }
    if (!plantedDate) {
      return res.status(400).json({ message: t('mothers.dateRequired', req.lang) });
    }
    const doc = new MotherPlant({
      name: String(name).trim(),
      strain: strain ? String(strain).trim() : '',
      plantedDate: new Date(plantedDate),
      health: health || 'good',
      notes: notes ? String(notes).trim() : ''
    });
    await doc.save();
    await createAuditLog(req, { action: 'mother_plant.create', entityType: 'MotherPlant', entityId: doc._id, details: { name: doc.name, strain: doc.strain } });
    res.status(201).json(doc);
  } catch (error) {
    console.error('Create mother plant error:', error);
    res.status(500).json({ message: t('common.serverError', req.lang) });
  }
};

// @desc    Update mother plant
// @route   PUT /api/mother-room/plants/:id
export const updatePlant = async (req, res) => {
  try {
    const doc = await MotherPlant.findOne({ _id: req.params.id, ...notDeleted });
    if (!doc) return res.status(404).json({ message: t('mothers.notFound', req.lang) });
    const { name, strain, plantedDate, health, notes, lastPruneDate } = req.body;
    if (name !== undefined) doc.name = String(name).trim();
    if (strain !== undefined) doc.strain = String(strain).trim();
    if (plantedDate !== undefined) doc.plantedDate = new Date(plantedDate);
    if (health !== undefined) doc.health = health;
    if (notes !== undefined) doc.notes = String(notes).trim();
    if (lastPruneDate !== undefined) doc.lastPruneDate = lastPruneDate ? new Date(lastPruneDate) : null;
    await doc.save();
    await createAuditLog(req, { action: 'mother_plant.update', entityType: 'MotherPlant', entityId: doc._id, details: { name: doc.name } });
    res.json(doc);
  } catch (error) {
    console.error('Update mother plant error:', error);
    res.status(500).json({ message: t('common.serverError', req.lang) });
  }
};

// @desc    Record prune (подрезка)
// @route   POST /api/mother-room/plants/:id/prune
export const recordPrune = async (req, res) => {
  try {
    const doc = await MotherPlant.findOne({ _id: req.params.id, ...notDeleted });
    if (!doc) return res.status(404).json({ message: t('mothers.notFound', req.lang) });
    const date = req.body.date ? new Date(req.body.date) : new Date();
    const notes = req.body.notes ? String(req.body.notes).trim() : '';
    doc.pruneHistory.push({ date, notes });
    doc.lastPruneDate = date;
    await doc.save();
    await createAuditLog(req, { action: 'mother_plant.prune', entityType: 'MotherPlant', entityId: doc._id, details: { name: doc.name, date } });
    res.json(doc);
  } catch (error) {
    console.error('Record prune error:', error);
    res.status(500).json({ message: t('common.serverError', req.lang) });
  }
};

// @desc    Retire plant (списать)
// @route   POST /api/mother-room/plants/:id/retire
export const retirePlant = async (req, res) => {
  try {
    const doc = await MotherPlant.findOne({ _id: req.params.id, ...notDeleted });
    if (!doc) return res.status(404).json({ message: t('mothers.notFound', req.lang) });
    if (doc.retiredAt) return res.status(400).json({ message: t('mothers.alreadyRetired', req.lang) });
    doc.retiredAt = new Date();
    doc.retiredReason = req.body.reason ? String(req.body.reason).trim() : '';
    await doc.save();
    // Remove from map
    const map = await MotherRoomMap.findOne();
    if (map && map.plantPositions?.length > 0) {
      const plantIdStr = doc._id.toString();
      const before = map.plantPositions.length;
      map.plantPositions = map.plantPositions.filter(p => p.plantId?.toString() !== plantIdStr);
      if (map.plantPositions.length < before) await map.save();
    }
    await createAuditLog(req, { action: 'mother_plant.retire', entityType: 'MotherPlant', entityId: doc._id, details: { name: doc.name, reason: doc.retiredReason } });
    res.json(doc);
  } catch (error) {
    console.error('Retire mother plant error:', error);
    res.status(500).json({ message: t('common.serverError', req.lang) });
  }
};

// @desc    Soft delete
// @route   DELETE /api/mother-room/plants/:id
export const deletePlant = async (req, res) => {
  try {
    const doc = await MotherPlant.findOne({ _id: req.params.id, ...notDeleted });
    if (!doc) return res.status(404).json({ message: t('mothers.notFound', req.lang) });
    doc.deletedAt = new Date();
    await doc.save();
    // Remove from map
    const map = await MotherRoomMap.findOne();
    if (map && map.plantPositions?.length > 0) {
      const plantIdStr = doc._id.toString();
      const before = map.plantPositions.length;
      map.plantPositions = map.plantPositions.filter(p => p.plantId?.toString() !== plantIdStr);
      if (map.plantPositions.length < before) await map.save();
    }
    await createAuditLog(req, { action: 'mother_plant.delete', entityType: 'MotherPlant', entityId: doc._id, details: { name: doc.name } });
    res.json({ message: t('mothers.deleted', req.lang) });
  } catch (error) {
    console.error('Delete mother plant error:', error);
    res.status(500).json({ message: t('common.serverError', req.lang) });
  }
};

// @desc    Get deleted plants (for trash)
// @route   GET /api/mother-room/plants/deleted
export const getDeletedPlants = async (req, res) => {
  try {
    const list = await MotherPlant.find(deletedOnly).sort({ deletedAt: -1 }).limit(200);
    res.json(list);
  } catch (error) {
    console.error('Get deleted mother plants error:', error);
    res.status(500).json({ message: t('common.serverError', req.lang) });
  }
};

// @desc    Restore from soft delete
// @route   POST /api/mother-room/plants/deleted/:id/restore
export const restorePlant = async (req, res) => {
  try {
    const doc = await MotherPlant.findOne({ _id: req.params.id, ...deletedOnly });
    if (!doc) return res.status(404).json({ message: t('mothers.notFoundOrRestored', req.lang) });
    doc.deletedAt = null;
    await doc.save();
    await createAuditLog(req, { action: 'mother_plant.restore', entityType: 'MotherPlant', entityId: doc._id, details: { name: doc.name } });
    res.json(doc);
  } catch (error) {
    console.error('Restore mother plant error:', error);
    res.status(500).json({ message: t('common.serverError', req.lang) });
  }
};

// ─── Map ───

// @desc    Get mother room map (singleton)
// @route   GET /api/mother-room/map
export const getMap = async (req, res) => {
  try {
    let doc = await MotherRoomMap.findOne();
    if (!doc) {
      return res.json({ motherRows: [], plantPositions: [] });
    }
    // Lazy cleanup: remove positions for deleted/retired plants
    if (doc.plantPositions && doc.plantPositions.length > 0) {
      const plantIds = [...new Set(doc.plantPositions.map(p => p.plantId.toString()))];
      const activePlants = await MotherPlant.find({
        _id: { $in: plantIds },
        ...notDeleted,
        $or: [{ retiredAt: null }, { retiredAt: { $exists: false } }]
      }).select('_id');
      const activeIds = new Set(activePlants.map(p => p._id.toString()));
      const before = doc.plantPositions.length;
      doc.plantPositions = doc.plantPositions.filter(p => activeIds.has(p.plantId.toString()));
      if (doc.plantPositions.length !== before) {
        await doc.save();
      }
    }
    await doc.populate('plantPositions.plantId', 'name strain health');
    res.json(doc);
  } catch (error) {
    console.error('Get mother room map error:', error);
    res.status(500).json({ message: t('common.serverError', req.lang) });
  }
};

// @desc    Save mother room map (upsert)
// @route   PUT /api/mother-room/map
export const updateMap = async (req, res) => {
  try {
    const { motherRows, plantPositions } = req.body;
    let doc = await MotherRoomMap.findOne();
    if (!doc) {
      doc = new MotherRoomMap();
    }
    if (motherRows !== undefined) doc.motherRows = motherRows;
    if (plantPositions !== undefined) doc.plantPositions = plantPositions;
    await doc.save();
    await doc.populate('plantPositions.plantId', 'name strain health');
    res.json(doc);
  } catch (error) {
    console.error('Update mother room map error:', error);
    res.status(500).json({ message: t('common.serverError', req.lang) });
  }
};

// @desc    Clear all positions (keep grid layout)
// @route   DELETE /api/mother-room/map/positions
export const clearMapPositions = async (req, res) => {
  try {
    const doc = await MotherRoomMap.findOne();
    if (!doc) return res.json({ message: 'OK' });
    doc.plantPositions = [];
    await doc.save();
    res.json(doc);
  } catch (error) {
    console.error('Clear mother room map positions error:', error);
    res.status(500).json({ message: t('common.serverError', req.lang) });
  }
};
