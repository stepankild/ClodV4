import { io } from 'socket.io-client';

let socket = null;
let listeners = new Set();

/**
 * Подключиться к Socket.io серверу для получения данных с весов и сканера штрихкодов.
 * Использует JWT из localStorage для аутентификации.
 */
export function connectScale() {
  if (socket?.connected) return;

  const token = localStorage.getItem('accessToken');
  if (!token) return;

  // В dev-режиме Vite проксирует /socket.io на сервер (vite.config.js)
  // В production — same origin
  const url = import.meta.env.VITE_API_URL || window.location.origin;

  socket = io(url, {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: Infinity
  });

  socket.on('scale:weight', (data) => {
    listeners.forEach(cb => cb('weight', data));
  });

  socket.on('scale:status', (data) => {
    listeners.forEach(cb => cb('status', data));
  });

  socket.on('barcode:scan', (data) => {
    listeners.forEach(cb => cb('barcode', data));
  });

  socket.on('scale:debug', (data) => {
    listeners.forEach(cb => cb('debug', data));
  });

  socket.on('harvest:crew_update', (data) => {
    listeners.forEach(cb => cb('crew_update', data));
  });

  socket.on('connect', () => {
    listeners.forEach(cb => cb('socketConnected', {}));
  });

  socket.on('disconnect', () => {
    listeners.forEach(cb => cb('socketDisconnected', {}));
  });

  socket.on('connect_error', (err) => {
    console.warn('Scale socket connection error:', err.message);
  });
}

/**
 * Отключиться от Socket.io сервера.
 */
export function disconnectScale() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

/**
 * Подписаться на события весов.
 * @param {Function} callback - (event, data) => void
 *   event: 'weight' | 'status' | 'barcode' | 'debug' | 'socketConnected' | 'socketDisconnected'
 * @returns {Function} unsubscribe
 */
export function onScaleEvent(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

/**
 * Обновить JWT токен для Socket.io (вызывать после refresh token).
 */
export function updateScaleAuth(newToken) {
  if (socket) {
    socket.auth = { token: newToken };
    if (socket.connected) {
      socket.disconnect().connect();
    }
  }
}
