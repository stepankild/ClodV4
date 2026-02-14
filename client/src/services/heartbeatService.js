import api from './api';

// Маршрут → читаемое название страницы
const PAGE_NAMES = {
  '/':           'Обзор фермы',
  '/active':     'Активные комнаты',
  '/harvest':    'Сбор урожая',
  '/trim':       'Трим',
  '/clones':     'Клоны',
  '/vegetation': 'Вегетация',
  '/archive':    'Архив циклов',
  '/stats':      'Статистика',
  '/strains':    'Сорта',
  '/workers':    'Работники',
  '/audit':      'Лог действий',
  '/trash':      'Корзина',
};

function getCurrentPageName() {
  const path = window.location.pathname;
  // Точное совпадение
  if (PAGE_NAMES[path]) return PAGE_NAMES[path];
  // Совпадение по префиксу (напр. /archive/abc123 → «Архив циклов»)
  const prefix = Object.keys(PAGE_NAMES).find(
    (p) => p !== '/' && path.startsWith(p)
  );
  if (prefix) return PAGE_NAMES[prefix];
  return path; // fallback: сырой путь
}

let heartbeatTimer = null;

async function sendHeartbeat() {
  try {
    await api.post('/auth/heartbeat', { page: getCurrentPageName() });
  } catch {
    // Тихо игнорируем — если токен истёк, axios interceptor обновит.
    // Если сервер недоступен — пропускаем этот бит.
  }
}

export function startHeartbeat() {
  if (heartbeatTimer) return; // уже запущен
  sendHeartbeat(); // немедленный первый бит
  heartbeatTimer = setInterval(sendHeartbeat, 30_000);
}

export function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}
