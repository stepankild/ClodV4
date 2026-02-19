import { Server as SocketIOServer } from 'socket.io';
import { verifyAccessToken } from '../utils/jwt.js';
import User from '../models/User.js';

// ── In-memory состояние весов ──
let scaleState = {
  connected: false,
  lastWeight: null,
  unit: 'g',
  stable: false,
  lastUpdate: null,
  socketId: null,
  debug: null, // диагностика от Pi
  // Pi buffer/sync state
  syncing: false,
  syncCount: 0,
  bufferedBarcodes: 0,
};

// Heartbeat: если Pi не шлёт weight > 20 сек — считаем весы отключёнными
const HEARTBEAT_TIMEOUT_MS = 20000;
let heartbeatTimer = null;

// Grace period: при disconnect ждём 5 сек перед объявлением оффлайн
// (Pi переподключается за 1-2 сек при кратковременном разрыве)
const PI_DISCONNECT_GRACE_MS = 5000;
let piDisconnectTimer = null;

export function getScaleState() {
  return { ...scaleState };
}

// ── Инициализация Socket.io ──
export function initializeSocket(httpServer, allowedOrigins) {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: (origin, callback) => {
        // Разрешаем запросы без origin (Pi-клиент, curl, same-origin)
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        if (origin.endsWith('.railway.app')) return callback(null, true);
        callback(null, true); // fallback — разрешаем все (как в Express CORS)
      },
      credentials: true
    },
    transports: ['websocket', 'polling'],
    // Частый ping чтобы Railway/облачные прокси не убивали idle WebSocket
    pingInterval: 10000,   // пинг каждые 10 сек (дефолт 25с — слишком редко для Railway)
    pingTimeout: 15000,    // ждать ответ 15 сек (дефолт 20с)
  });

  // ── Auth middleware ──
  io.use(async (socket, next) => {
    const { apiKey, deviceType, token } = socket.handshake.auth;

    // Raspberry Pi — проверка SCALE_API_KEY
    // Принимаем deviceType 'pi' (новый) и 'scale' (обратная совместимость)
    if (deviceType === 'pi' || deviceType === 'scale') {
      const serverKey = process.env.SCALE_API_KEY;
      if (!serverKey) {
        console.warn('SCALE_API_KEY not set — Pi connections rejected');
        return next(new Error('Scale API key not configured on server'));
      }
      if (apiKey === serverKey) {
        socket.data.deviceType = 'pi';
        socket.data.label = 'RaspberryPi';
        return next();
      }
      return next(new Error('Invalid scale API key'));
    }

    // Браузер — проверка JWT
    if (token) {
      try {
        const decoded = verifyAccessToken(token);
        const user = await User.findById(decoded.userId).select('name isActive deletedAt');
        if (user && user.isActive && !user.deletedAt) {
          socket.data.deviceType = 'browser';
          socket.data.userId = user._id.toString();
          socket.data.userName = user.name;
          return next();
        }
      } catch (err) {
        // Token expired или невалидный
      }
      return next(new Error('Invalid or expired token'));
    }

    return next(new Error('Authentication required'));
  });

  // ── Connection handler ──
  io.on('connection', (socket) => {
    const { deviceType } = socket.data;

    if (deviceType === 'pi') {
      handlePiConnection(io, socket);
    } else if (deviceType === 'browser') {
      handleBrowserConnection(io, socket);
    }
  });

  console.log('Socket.io initialized');
  return io;
}

// ── Heartbeat helpers ──
function resetHeartbeat(io) {
  if (heartbeatTimer) clearTimeout(heartbeatTimer);
  heartbeatTimer = setTimeout(() => {
    // Pi не слал weight больше 15 сек — весы считаются отключёнными
    if (scaleState.connected) {
      console.warn(`Heartbeat timeout: no scale:weight for ${HEARTBEAT_TIMEOUT_MS / 1000}s`);
      scaleState.connected = false;
      scaleState.lastWeight = null;
      scaleState.stable = false;
      scaleState.lastUpdate = new Date();
      io.emit('scale:status', { connected: false });
    }
  }, HEARTBEAT_TIMEOUT_MS);
}

function clearHeartbeat() {
  if (heartbeatTimer) {
    clearTimeout(heartbeatTimer);
    heartbeatTimer = null;
  }
}

// ── Raspberry Pi подключение (весы + сканер) ──
function handlePiConnection(io, socket) {
  console.log(`Pi connected: ${socket.id}`);

  // Отменить grace period timer (Pi вернулся!)
  if (piDisconnectTimer) {
    clearTimeout(piDisconnectTimer);
    piDisconnectTimer = null;
    console.log('Pi reconnected within grace period — no offline notification sent');
  }

  // Если уже была другая scale подключена — отключаем старую
  if (scaleState.socketId && scaleState.socketId !== socket.id) {
    const oldSocket = io.sockets.sockets.get(scaleState.socketId);
    if (oldSocket) {
      console.log(`Disconnecting previous scale: ${scaleState.socketId}`);
      oldSocket.disconnect(true);
    }
  }

  scaleState.connected = true;
  scaleState.socketId = socket.id;
  scaleState.lastUpdate = new Date();

  // Уведомить все браузеры
  io.emit('scale:status', { connected: true });

  // Запустить heartbeat
  resetHeartbeat(io);

  // Получение веса от Pi
  socket.on('scale:weight', (data) => {
    const { weight, unit, stable } = data;
    scaleState.lastWeight = typeof weight === 'number' ? weight : null;
    scaleState.unit = unit || 'g';
    scaleState.stable = !!stable;
    scaleState.lastUpdate = new Date();

    // Если до этого connected был false (heartbeat timeout или scale:status false) — восстановить
    if (!scaleState.connected) {
      scaleState.connected = true;
      io.emit('scale:status', { connected: true });
    }

    // Сбросить heartbeat таймер
    resetHeartbeat(io);

    // Broadcast всем (включая браузеры)
    socket.broadcast.emit('scale:weight', {
      weight: scaleState.lastWeight,
      unit: scaleState.unit,
      stable: scaleState.stable
    });
  });

  // Статус весов от Pi (весы подключены/отключены от Pi физически)
  socket.on('scale:status', (data) => {
    const wasConnected = scaleState.connected;
    scaleState.connected = !!data.connected;
    scaleState.lastUpdate = new Date();

    if (!data.connected) {
      scaleState.lastWeight = null;
      scaleState.stable = false;
      clearHeartbeat();
    } else {
      resetHeartbeat(io);
    }

    // Сообщить браузерам только если статус изменился
    if (wasConnected !== scaleState.connected) {
      console.log(`Scale status from Pi: connected=${data.connected}`);
      io.emit('scale:status', { connected: scaleState.connected });
    }
  });

  // Ошибка от Pi
  socket.on('scale:error', (data) => {
    console.warn('Scale error:', data?.message || data);
  });

  // Диагностика от Pi (каждые 5 сек) — также служит heartbeat
  socket.on('scale:debug', (data) => {
    scaleState.debug = { ...data, receivedAt: new Date().toISOString() };
    resetHeartbeat(io); // debug = heartbeat от Pi (weight может не приходить при стабильном весе)
    // Broadcast браузерам
    socket.broadcast.emit('scale:debug', scaleState.debug);
  });

  // Получение скана штрихкода от Pi
  socket.on('barcode:scan', (data) => {
    const { barcode, buffered, weight, unit, stable, scannedAt } = data;
    if (barcode) {
      const weightInfo = weight != null ? ` (weight: ${weight} ${unit || 'g'})` : '';
      if (buffered) {
        console.log(`Barcode scanned (buffered): ${barcode}${weightInfo}`);
      } else {
        console.log(`Barcode scanned: ${barcode}${weightInfo}`);
      }
      // Broadcast всем браузерам (включая вес и флаг buffered)
      const payload = { barcode, buffered: !!buffered };
      if (weight != null) {
        payload.weight = weight;
        payload.unit = unit || 'g';
        payload.stable = !!stable;
      }
      if (scannedAt) payload.scannedAt = scannedAt;
      socket.broadcast.emit('barcode:scan', payload);
    }
  });

  // Pi начинает воспроизведение буферизованных сканов
  socket.on('pi:sync_start', (data) => {
    const count = data?.barcodeCount || 0;
    console.log(`Pi sync started: ${count} buffered barcode(s)`);
    scaleState.syncing = true;
    scaleState.syncCount = count;
    io.emit('pi:sync_status', { syncing: true, count });
  });

  // Pi завершил воспроизведение буферизованных сканов
  socket.on('pi:sync_complete', (data) => {
    const count = data?.barcodeCount || 0;
    console.log(`Pi sync complete: ${count} barcode(s) replayed`);
    scaleState.syncing = false;
    scaleState.syncCount = 0;
    io.emit('pi:sync_status', { syncing: false, count: 0 });
  });

  // Отключение Pi — grace period перед объявлением оффлайн
  socket.on('disconnect', (reason) => {
    console.log(`Pi disconnected: ${socket.id} (${reason})`);
    if (scaleState.socketId === socket.id) {
      scaleState.socketId = null; // Разрешить новому Pi подключиться
      clearHeartbeat();

      // Grace period — Pi часто переподключается за 1-2 сек (Railway/proxy resets)
      // Не спамим браузерам offline если Pi вернётся быстро
      if (piDisconnectTimer) clearTimeout(piDisconnectTimer);
      piDisconnectTimer = setTimeout(() => {
        piDisconnectTimer = null;
        // Если за время grace period Pi не вернулся — объявить оффлайн
        if (!scaleState.socketId) {
          console.log('Pi did not reconnect within grace period — marking offline');
          scaleState.connected = false;
          scaleState.lastWeight = null;
          scaleState.stable = false;
          scaleState.lastUpdate = new Date();
          scaleState.debug = null;
          scaleState.syncing = false;
          scaleState.syncCount = 0;
          scaleState.bufferedBarcodes = 0;
          io.emit('scale:status', { connected: false });
        }
      }, PI_DISCONNECT_GRACE_MS);
    }
  });
}

// ── Браузер подключение ──
function handleBrowserConnection(io, socket) {
  // Сразу отправить текущее состояние весов
  socket.emit('scale:status', { connected: scaleState.connected });
  if (scaleState.connected && scaleState.lastWeight != null) {
    socket.emit('scale:weight', {
      weight: scaleState.lastWeight,
      unit: scaleState.unit,
      stable: scaleState.stable
    });
  }
  // Отправить текущую диагностику (если есть)
  if (scaleState.debug) {
    socket.emit('scale:debug', scaleState.debug);
  }
  // Отправить статус синхронизации (если Pi сейчас воспроизводит буфер)
  if (scaleState.syncing) {
    socket.emit('pi:sync_status', { syncing: true, count: scaleState.syncCount });
  }

  socket.on('disconnect', () => {
    // Браузер отключился — ничего особенного
  });
}
