import VegMap from '../models/VegMap.js';
import VegBatch from '../models/VegBatch.js';
import { t } from '../utils/i18n.js';

// @desc    Get veg map (singleton)
// @route   GET /api/veg-map
export const getVegMap = async (req, res) => {
  try {
    let doc = await VegMap.findOne();
    if (!doc) {
      return res.json({ vegRows: [], customRows: [], batchPositions: [], fillDirection: 'topDown' });
    }

    // Lazy cleanup: убрать позиции удалённых/несуществующих батчей
    if (doc.batchPositions && doc.batchPositions.length > 0) {
      const batchIds = [...new Set(doc.batchPositions.map(p => p.batchId.toString()))];
      const activeBatches = await VegBatch.find({
        _id: { $in: batchIds },
        $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }]
      }).select('_id');
      const activeIds = new Set(activeBatches.map(b => b._id.toString()));

      const before = doc.batchPositions.length;
      doc.batchPositions = doc.batchPositions.filter(p => activeIds.has(p.batchId.toString()));
      if (doc.batchPositions.length !== before) {
        await doc.save();
      }
    }

    // Populate batch info для фронтенда
    await doc.populate('batchPositions.batchId', 'name strains strain');

    res.json(doc);
  } catch (error) {
    console.error('Get veg map error:', error);
    res.status(500).json({ message: t('common.serverError', req.lang) });
  }
};

// @desc    Save veg map (upsert)
// @route   PUT /api/veg-map
export const updateVegMap = async (req, res) => {
  try {
    const { vegRows, customRows, batchPositions, fillDirection } = req.body;

    let doc = await VegMap.findOne();
    if (!doc) {
      doc = new VegMap();
    }

    if (vegRows !== undefined) doc.vegRows = vegRows;
    if (customRows !== undefined) doc.customRows = customRows;
    if (batchPositions !== undefined) doc.batchPositions = batchPositions;
    if (fillDirection !== undefined) doc.fillDirection = fillDirection;

    await doc.save();
    await doc.populate('batchPositions.batchId', 'name strains strain');

    res.json(doc);
  } catch (error) {
    console.error('Update veg map error:', error);
    res.status(500).json({ message: t('common.serverError', req.lang) });
  }
};

// @desc    Clear all positions (keep grid layout)
// @route   DELETE /api/veg-map/positions
export const clearVegMapPositions = async (req, res) => {
  try {
    const doc = await VegMap.findOne();
    if (!doc) {
      return res.json({ message: 'OK' });
    }
    doc.batchPositions = [];
    await doc.save();
    res.json(doc);
  } catch (error) {
    console.error('Clear veg map positions error:', error);
    res.status(500).json({ message: t('common.serverError', req.lang) });
  }
};
