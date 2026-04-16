import express from 'express';
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
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

// Videos are still served from Pi (small enough, generated on-demand, ~20MB).
// Left in case we re-wire, but currently unused by the UI.
router.get('/:zone/video/month', protect, async (req, res) => {
  // Redirect to public R2 URL if/when video upload is wired; for now 501.
  res.status(501).json({ error: 'monthly video not yet migrated to R2' });
});

export default router;
