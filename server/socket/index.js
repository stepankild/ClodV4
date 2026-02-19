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
  socketId: null
};

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
    transports: ['websocket', 'polling']
  });

  // ── Auth middleware ──
  io.use(async (socket, next) => {
    const { apiKey, deviceType, token } = socket.handshake.auth;

    // Raspberry Pi — проверка SCALE_API_KEY
    if (deviceType === 'scale') {
      const serverKey = process.env.SCALE_API_KEY;
      if (!serverKey) {
        console.warn('SCALE_API_KEY not set — scale connections rejected');
        return next(new Error('Scale API key not configured on server'));
      }
      if (apiKey === serverKey) {
        socket.data.deviceType = 'scale';
        socket.data.label = 'RaspberryPi-Scale';
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

    if (deviceType === 'scale') {
      handleScaleConnection(io, socket);
    } else if (deviceType === 'browser') {
      handleBrowserConnection(io, socket);
    }
  });

  console.log('Socket.io initialized');
  return io;
}

// ── Raspberry Pi (scale) подключение ──
function handleScaleConnection(io, socket) {
  console.log(`Scale connected: ${socket.id}`);

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

  // Получение веса от Pi
  socket.on('scale:weight', (data) => {
    const { weight, unit, stable } = data;
    scaleState.lastWeight = typeof weight === 'number' ? weight : null;
    scaleState.unit = unit || 'g';
    scaleState.stable = !!stable;
    scaleState.lastUpdate = new Date();

    // Broadcast всем (включая браузеры)
    socket.broadcast.emit('scale:weight', {
      weight: scaleState.lastWeight,
      unit: scaleState.unit,
      stable: scaleState.stable
    });
  });

  // Ошибка от Pi
  socket.on('scale:error', (data) => {
    console.warn('Scale error:', data?.message || data);
  });

  // Отключение Pi
  socket.on('disconnect', (reason) => {
    console.log(`Scale disconnected: ${socket.id} (${reason})`);
    if (scaleState.socketId === socket.id) {
      scaleState.connected = false;
      scaleState.socketId = null;
      scaleState.lastWeight = null;
      scaleState.stable = false;
      scaleState.lastUpdate = new Date();

      io.emit('scale:status', { connected: false });
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

  socket.on('disconnect', () => {
    // Браузер отключился — ничего особенного
  });
}
