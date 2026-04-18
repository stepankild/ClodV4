import express from 'express';
import { S3Client, ListObjectsV2Command, HeadObjectCommand } from '@aws-sdk/client-s3';
import { protect } from '../middleware/auth.js';

const router = express.Router();

// --- Cloudflare R2 config ---
const {
  R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_BUCKET = 'truegrow-timelapse',
  R2_PUBLIC_URL = '',
} = process.env;

// Pi HTTP server (via Tailscale Funnel) — used only to trigger custom video builds.
const FARM_URL = 'https://farm.taild7c160.ts.net/timelapse';
const FARM_API_KEY = process.env.SENSOR_API_KEY;

const PRESET_DAYS = [3, 7, 14, 30];

let s3 = null;
function getS3() {
  if (s3) return s3;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    throw new Error('R2 credentials missing (R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY)');
  }
  s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
  });
  return s3;
}

const publicUrl = (key) => `${R2_PUBLIC_URL.replace(/\/$/, '')}/${key}`;

// Light in-memory cache for listings (60s TTL) — R2 list is fast but
// saves a round-trip on back-and-forth navigation.
const listCache = new Map(); // zone -> { at: ms, data }
const LIST_TTL_MS = 60 * 1000;

async function listZone(zone) {
  const cached = listCache.get(zone);
  if (cached && Date.now() - cached.at < LIST_TTL_MS) return cached.data;

  const client = getS3();
  const prefix = `${zone}/`;
  const days = new Map(); // date -> Set of names

  let ContinuationToken;
  do {
    const r = await client.send(new ListObjectsV2Command({
      Bucket: R2_BUCKET,
      Prefix: prefix,
      ContinuationToken,
    }));
    for (const obj of r.Contents || []) {
      const key = obj.Key;
      if (!key.endsWith('.jpg')) continue;
      const rel = key.slice(prefix.length); // YYYY-MM-DD/HH-MM[-thumb|-medium].jpg
      const parts = rel.split('/');
      if (parts.length !== 2) continue;
      const [date, fname] = parts;
      const stem = fname.slice(0, -4);
      if (stem.endsWith('-thumb') || stem.endsWith('-medium')) continue;
      if (!days.has(date)) days.set(date, new Set());
      days.get(date).add(stem);
      // medium suffix kept for backward-compat filter only — new captures are full+thumb only
    }
    ContinuationToken = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (ContinuationToken);

  const sortedDates = [...days.keys()].sort().reverse();
  const data = {
    publicUrl: R2_PUBLIC_URL,
    days: sortedDates.map(date => {
      const photos = [...days.get(date)].sort();
      return {
        date,
        count: photos.length,
        photos,
        // URLs are built client-side from publicUrl + zone/date/name, but for
        // convenience include them directly so frontend doesn't need to know the scheme.
        urls: photos.map(name => ({
          name,
          full: publicUrl(`${zone}/${date}/${name}.jpg`),
          thumb: publicUrl(`${zone}/${date}/${name}-thumb.jpg`),
        })),
      };
    }),
  };
  listCache.set(zone, { at: Date.now(), data });
  return data;
}

// GET /api/timelapse/:zone/photos — list days with photo URLs on R2
router.get('/:zone/photos', protect, async (req, res) => {
  try {
    const data = await listZone(req.params.zone);
    res.json(data);
  } catch (e) {
    console.error('timelapse list error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/timelapse/:zone/videos — list available pre-built videos on R2
router.get('/:zone/videos', protect, async (req, res) => {
  try {
    const zone = req.params.zone;
    const client = getS3();
    const prefix = `${zone}/videos/`;
    const r = await client.send(new ListObjectsV2Command({
      Bucket: R2_BUCKET,
      Prefix: prefix,
    }));
    const presets = {};
    const customs = [];
    for (const obj of r.Contents || []) {
      const stem = obj.Key.slice(prefix.length, -4); // strip prefix + ".mp4"
      if (!obj.Key.endsWith('.mp4')) continue;
      const entry = {
        key: stem,
        url: publicUrl(obj.Key),
        sizeKB: Math.round((obj.Size || 0) / 1024),
        generatedAt: obj.LastModified?.toISOString() || null,
      };
      const m = stem.match(/^(\d+)d$/);
      if (m) {
        presets[parseInt(m[1], 10)] = entry;
      } else if (stem.startsWith('custom-')) {
        customs.push(entry);
      }
    }
    res.json({
      publicUrl: R2_PUBLIC_URL,
      presets,       // { 3: {...}, 7: {...}, 14: {...}, 30: {...} }
      customs,       // [{ key: 'custom-10d', url, ... }]
      presetDays: PRESET_DAYS,
    });
  } catch (e) {
    console.error('videos list error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/timelapse/:zone/video/build — trigger on-demand build for N days.
// Blocks until Pi builds + uploads (can take up to 90s for 30 days).
router.post('/:zone/video/build', protect, express.json(), async (req, res) => {
  try {
    const zone = req.params.zone;
    const days = parseInt(req.body?.days || req.query.days, 10);
    if (!Number.isInteger(days) || days < 1 || days > 90) {
      return res.status(400).json({ error: 'days must be integer in 1..90' });
    }
    if (!FARM_API_KEY) {
      return res.status(500).json({ error: 'SENSOR_API_KEY not configured on server' });
    }
    // Call Pi. Pi runs ffmpeg + upload + returns JSON with url.
    const piUrl = `${FARM_URL}/build-video?zone=${encodeURIComponent(zone)}&days=${days}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180000); // 3 min max
    try {
      const r = await fetch(piUrl, {
        headers: { 'X-API-Key': FARM_API_KEY },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        return res.status(r.status).json(data);
      }
      res.json(data); // { url, days, generated_at }
    } catch (e) {
      clearTimeout(timeout);
      if (e.name === 'AbortError') {
        return res.status(504).json({ error: 'build timed out' });
      }
      throw e;
    }
  } catch (e) {
    console.error('video build error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/timelapse/:zone/video/send-telegram — on-demand Telegram digest
// Body: { days: N }. Pi reuses its local video file if fresh (<24h), else rebuilds.
router.post('/:zone/video/send-telegram', protect, express.json(), async (req, res) => {
  try {
    const zone = req.params.zone;
    const days = parseInt(req.body?.days || req.query.days, 10);
    if (!Number.isInteger(days) || days < 1 || days > 90) {
      return res.status(400).json({ error: 'days must be integer in 1..90' });
    }
    if (!FARM_API_KEY) {
      return res.status(500).json({ error: 'SENSOR_API_KEY not configured on server' });
    }
    const piUrl = `${FARM_URL}/send-telegram?zone=${encodeURIComponent(zone)}&days=${days}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180000); // 3 min max
    try {
      const r = await fetch(piUrl, {
        headers: { 'X-API-Key': FARM_API_KEY },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const data = await r.json().catch(() => ({}));
      if (!r.ok) return res.status(r.status).json(data);
      res.json(data);
    } catch (e) {
      clearTimeout(timeout);
      if (e.name === 'AbortError') {
        return res.status(504).json({ error: 'send timed out' });
      }
      throw e;
    }
  } catch (e) {
    console.error('telegram send error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

export default router;
