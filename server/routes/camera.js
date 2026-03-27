import express from 'express';
import CameraCapture from '../models/CameraCapture.js';
import { protect } from '../middleware/auth.js';
import { checkPermission } from '../middleware/rbac.js';

const router = express.Router();

// ---------------------------------------------------------------------------
// API key middleware — same as sensorIngest, for ESP32-CAM upload via Pi proxy
// ---------------------------------------------------------------------------
function requireApiKey(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key || key !== process.env.SENSOR_API_KEY) {
    return res.status(401).json({ message: 'Invalid API key' });
  }
  next();
}

// ---------------------------------------------------------------------------
// POST /api/camera/upload — receive raw JPEG binary from ESP32-CAM (via Pi)
// Content-Type: image/jpeg
// zoneId from query param ?zoneId= or header X-Zone-ID
// ---------------------------------------------------------------------------
router.post('/upload', requireApiKey, express.raw({ type: 'image/jpeg', limit: '5mb' }), async (req, res) => {
  try {
    const zoneId = req.query.zoneId || req.headers['x-zone-id'];
    if (!zoneId) {
      return res.status(400).json({ message: 'zoneId required (query param or X-Zone-ID header)' });
    }

    const buf = req.body;
    if (!buf || !buf.length) {
      return res.status(400).json({ message: 'No image data received' });
    }

    const base64 = buf.toString('base64');

    const capture = await CameraCapture.create({
      zoneId,
      image: base64,
      fileSize: buf.length,
      // width/height could be extracted from JPEG headers, but kept simple —
      // ESP32-CAM can send them as query params if needed
      width: req.query.width ? Number(req.query.width) : undefined,
      height: req.query.height ? Number(req.query.height) : undefined,
    });

    res.status(201).json({ ok: true, id: capture._id });
  } catch (error) {
    console.error('Camera upload error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// ---------------------------------------------------------------------------
// JWT-protected routes — for portal frontend
// ---------------------------------------------------------------------------
router.use(protect);

// GET /api/camera/:zoneId/photos?from=&to=&limit=20
// Returns photo list (metadata only, no image data)
router.get('/:zoneId/photos', checkPermission('iot:view'), async (req, res) => {
  try {
    const { zoneId } = req.params;
    const limit = Math.min(Number(req.query.limit) || 20, 200);
    const filter = { zoneId };

    if (req.query.from || req.query.to) {
      filter.timestamp = {};
      if (req.query.from) filter.timestamp.$gte = new Date(req.query.from);
      if (req.query.to) filter.timestamp.$lte = new Date(req.query.to);
    }

    const photos = await CameraCapture.find(filter)
      .select('-image')              // exclude base64 blob
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();

    res.json(photos);
  } catch (error) {
    console.error('Camera list error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/camera/:zoneId/photos/:id — single photo with base64 image
router.get('/:zoneId/photos/:id', checkPermission('iot:view'), async (req, res) => {
  try {
    const photo = await CameraCapture.findOne({
      _id: req.params.id,
      zoneId: req.params.zoneId,
    }).lean();

    if (!photo) return res.status(404).json({ message: 'Photo not found' });

    res.json(photo);
  } catch (error) {
    console.error('Camera photo error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE /api/camera/:zoneId/photos/:id — delete a photo
router.delete('/:zoneId/photos/:id', checkPermission('iot:view'), async (req, res) => {
  try {
    const result = await CameraCapture.deleteOne({
      _id: req.params.id,
      zoneId: req.params.zoneId,
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({ message: 'Photo not found' });
    }

    res.json({ ok: true });
  } catch (error) {
    console.error('Camera delete error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
