import SystemStatusSnapshot from '../models/SystemStatusSnapshot.js';

// @route GET /api/system-status/latest
// @desc  Последний снапшот + secondsAgo для UI
export const getLatest = async (req, res) => {
  try {
    const snap = await SystemStatusSnapshot.findOne({}).sort({ timestamp: -1 }).lean();
    if (!snap) {
      return res.json({ snapshot: null, secondsAgo: null, probeOnline: isProbeOnline(req) });
    }
    const secondsAgo = Math.round((Date.now() - new Date(snap.timestamp).getTime()) / 1000);
    res.json({ snapshot: snap, secondsAgo, probeOnline: isProbeOnline(req) });
  } catch (err) {
    console.error('getLatest system-status:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// @route GET /api/system-status/history?limit=50
// @desc  Последние N снапшотов для истории
export const getHistory = async (req, res) => {
  try {
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const snaps = await SystemStatusSnapshot.find({})
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();
    res.json({ snapshots: snaps });
  } catch (err) {
    console.error('getHistory system-status:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// @route POST /api/system-status/refresh
// @desc  Триггерим probe сделать выдох прямо сейчас (без ожидания 5-мин таймера).
//        Через Socket.io шлём `probe:run-now` в сторону probe-сокета.
export const triggerRefresh = async (req, res) => {
  const io = req.app.get('io');
  const probeSocket = io?.probeSocket && io.sockets.sockets.get(io.probeSocket);
  if (!probeSocket) {
    return res.status(503).json({ message: 'Pi health probe is offline' });
  }
  probeSocket.emit('probe:run-now');
  res.status(202).json({ ok: true });
};

// @route POST /api/system-status/report
// @desc  Fallback: probe может присылать snapshot через HTTP POST (если
//        Socket.io-коннект по какой-то причине упал). API-key auth.
//        Обычный путь — через Socket.io, этот endpoint — страховка.
export const report = async (req, res) => {
  try {
    const { timestamp, host, durationMs, checks, rawPayload } = req.body || {};
    if (!host || !checks) {
      return res.status(400).json({ message: 'host and checks required' });
    }
    const snap = await SystemStatusSnapshot.create({
      timestamp: timestamp ? new Date(timestamp) : new Date(),
      host,
      durationMs,
      checks,
      rawPayload,
    });
    const io = req.app.get('io');
    io?.emit('system:status:update', snap.toObject());
    res.json({ ok: true, id: snap._id });
  } catch (err) {
    console.error('report system-status:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

function isProbeOnline(req) {
  const io = req.app.get('io');
  if (!io?.probeSocket) return false;
  return !!io.sockets.sockets.get(io.probeSocket);
}
