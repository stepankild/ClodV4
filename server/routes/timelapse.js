import express from 'express';
import { protect } from '../middleware/auth.js';
import { verifyAccessToken } from '../utils/jwt.js';
import User from '../models/User.js';

const router = express.Router();

// Tailscale Funnel exposes Pi's timelapse server at:
//   https://farm.taild7c160.ts.net/timelapse/*
const FARM_URL = 'https://farm.taild7c160.ts.net/timelapse';
const API_KEY = process.env.SENSOR_API_KEY;

// Auth that also accepts ?token=... in query (needed for <img>/<video> tags
// which can't send Authorization header).
async function protectFlexible(req, res, next) {
  // If standard Authorization header is present, fall through to normal protect
  if (req.headers.authorization?.startsWith('Bearer ')) {
    return protect(req, res, next);
  }
  // Otherwise check ?token= query
  const token = req.query.token;
  if (!token) return res.status(401).json({ message: 'Unauthorized' });
  try {
    const decoded = verifyAccessToken(token);
    const user = await User.findById(decoded.userId).select('-password -refreshToken');
    if (!user || !user.isActive || user.deletedAt) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    const tokenV = decoded.v ?? 0;
    const userV = user.tokenVersion || 0;
    if (tokenV !== userV) {
      return res.status(401).json({ message: 'Token expired' });
    }
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ message: 'Invalid token' });
  }
}

// GET /api/timelapse/:zone/photos[?date=YYYY-MM-DD]
router.get('/:zone/photos', protect, async (req, res) => {
  try {
    const { zone } = req.params;
    const { date } = req.query;
    const qs = new URLSearchParams({ zone });
    if (date) qs.set('date', date);
    const r = await fetch(`${FARM_URL}/photos?${qs}`, {
      headers: { 'X-API-Key': API_KEY },
    });
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/timelapse/:zone/photo/:date/:name — proxy JPEG bytes
// GET /api/timelapse/:zone/thumb/:date/:name — proxy small JPEG thumbnail
async function proxyImage(kind, req, res) {
  try {
    const { zone, date, name } = req.params;
    const r = await fetch(
      `${FARM_URL}/${kind}/${encodeURIComponent(zone)}/${encodeURIComponent(date)}/${encodeURIComponent(name)}`,
      { headers: { 'X-API-Key': API_KEY } }
    );
    if (!r.ok) return res.status(r.status).json({ error: 'not found' });
    res.setHeader('Content-Type', r.headers.get('content-type') || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    const buf = Buffer.from(await r.arrayBuffer());
    res.send(buf);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

router.get('/:zone/photo/:date/:name', protectFlexible, (req, res) => proxyImage('photo', req, res));
router.get('/:zone/thumb/:date/:name', protectFlexible, (req, res) => proxyImage('thumb', req, res));

// GET /api/timelapse/:zone/video/month — stream monthly timelapse video
router.get('/:zone/video/month', protectFlexible, async (req, res) => {
  try {
    const { zone } = req.params;
    const r = await fetch(`${FARM_URL}/video/${encodeURIComponent(zone)}/month`, {
      headers: { 'X-API-Key': API_KEY },
    });
    if (!r.ok) return res.status(r.status).json({ error: 'video not ready' });
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Cache-Control', 'public, max-age=1800');
    // Stream body directly
    const reader = r.body.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      res.write(value);
    }
    res.end();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
