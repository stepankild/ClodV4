import BackupLog from '../models/BackupLog.js';

// Находим текущий socket агента (если есть). Socket сохраняется через
// io.backupAgent в handleBackupConnection (server/socket/index.js).
function getAgentSocket(req) {
  const io = req.app.get('io');
  const id = io?.backupAgent?.socketId;
  if (!id) return null;
  return io.sockets.sockets.get(id) || null;
}

// @route GET /api/backups
// @desc  Список прошлых запусков, сортировка по startedAt desc
export const listBackups = async (req, res) => {
  try {
    const { limit = 50, type, status } = req.query;
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
    const query = {};
    if (type) query.type = type;
    if (status) query.status = status;

    const logs = await BackupLog.find(query)
      .sort({ startedAt: -1 })
      .limit(limitNum)
      .lean();

    res.json({ logs });
  } catch (err) {
    console.error('listBackups:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// @route GET /api/backups/agent-status
// @desc  Онлайн ли сейчас backup-агент. UI юзает чтобы отключать кнопки.
export const getAgentStatus = async (req, res) => {
  const io = req.app.get('io');
  const agent = io?.backupAgent;
  if (agent && agent.socketId && io.sockets.sockets.get(agent.socketId)) {
    return res.json({
      online: true,
      connectedAt: agent.connectedAt,
      host: agent.host || null,
    });
  }
  res.json({ online: false });
};

// @route POST /api/backups/run
// @body  { type: 'weekly' | 'monthly' }
// @desc  Ручной запуск бэкапа. Создаёт запись в BackupLog со статусом
//        'pending' и эмитит событие 'backup:request' агенту.
export const requestBackup = async (req, res) => {
  try {
    const { type } = req.body || {};
    if (!['weekly', 'monthly'].includes(type)) {
      return res.status(400).json({ message: 'type must be weekly or monthly' });
    }

    const agentSocket = getAgentSocket(req);
    if (!agentSocket) {
      return res.status(503).json({ message: 'Backup agent is offline' });
    }

    // Проверка: нет ли уже идущего бэкапа. Защита от двойного клика.
    const running = await BackupLog.findOne({
      status: { $in: ['pending', 'running'] },
    }).lean();
    if (running) {
      return res.status(409).json({
        message: 'A backup is already in progress',
        runningId: running._id,
      });
    }

    const log = await BackupLog.create({
      type: `manual-${type}`,
      status: 'pending',
      startedAt: new Date(),
      triggeredBy: req.user?._id || 'unknown',
      triggeredByName: req.user?.name || null,
    });

    // Отправляем агенту команду. Агент в ответ апдейтит запись через /report.
    agentSocket.emit('backup:request', {
      backupLogId: log._id.toString(),
      type,
    });

    // Broadcast всем браузерам, чтобы UI сразу показал новую строку.
    const io = req.app.get('io');
    io.emit('backup:updated', { logId: log._id.toString() });

    res.status(202).json({ logId: log._id, status: 'pending' });
  } catch (err) {
    console.error('requestBackup:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// @route POST /api/backups/report
// @desc  Скрипт или агент присылает отчёт. Если в body есть logId — апдейтим,
//        иначе создаём новую запись (scheduled runs). API-key auth.
export const reportBackup = async (req, res) => {
  try {
    const {
      logId,
      type,
      status,
      startedAt,
      finishedAt,
      durationSec,
      sizeMB,
      gitSha,
      gitBranch,
      host,
      warnings,
      sections,
      errorMessage,
      manifestText,
    } = req.body || {};

    if (!type || !status) {
      return res.status(400).json({ message: 'type and status required' });
    }

    const patch = {};
    if (type) patch.type = type;
    if (status) patch.status = status;
    if (startedAt) patch.startedAt = new Date(startedAt);
    if (finishedAt) patch.finishedAt = new Date(finishedAt);
    if (typeof durationSec === 'number') patch.durationSec = durationSec;
    if (typeof sizeMB === 'number') patch.sizeMB = sizeMB;
    if (gitSha) patch.gitSha = gitSha;
    if (gitBranch) patch.gitBranch = gitBranch;
    if (host) patch.host = host;
    if (Array.isArray(warnings)) patch.warnings = warnings;
    if (sections && typeof sections === 'object') patch.sections = sections;
    if (errorMessage) patch.errorMessage = errorMessage;
    if (manifestText) patch.manifestText = manifestText;

    let log;
    if (logId) {
      log = await BackupLog.findByIdAndUpdate(logId, patch, { new: true }).lean();
      if (!log) {
        // Id прислан, но записи нет — создаём как новую (гонка? перезапуск?).
        log = await BackupLog.create({
          triggeredBy: 'schedule',
          ...patch,
        });
      }
    } else {
      log = await BackupLog.create({
        triggeredBy: 'schedule',
        ...patch,
      });
    }

    // Сообщаем браузерам, чтобы таблица обновилась real-time.
    const io = req.app.get('io');
    io?.emit('backup:updated', { logId: log._id?.toString?.() });

    res.json({ ok: true, logId: log._id });
  } catch (err) {
    console.error('reportBackup:', err);
    res.status(500).json({ message: 'Server error' });
  }
};
