import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL.replace(/\/$/, '')}/api` : '/api',
  headers: {
    'Content-Type': 'application/json'
  },
  withCredentials: true
});

// ── Helpers ──

const getRefreshBase = () =>
  import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL.replace(/\/$/, '')}/api` : '';

/** Decode JWT payload without verification (browser-safe). Returns null on error. */
function decodeJwtPayload(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload;
  } catch { return null; }
}

/** Returns true when token will expire within `marginSec` seconds. */
function isTokenExpiringSoon(token, marginSec = 300) {
  if (!token) return true;
  const payload = decodeJwtPayload(token);
  if (!payload?.exp) return false;          // can't tell — assume valid
  return payload.exp - Date.now() / 1000 < marginSec;
}

// ── Refresh mutex ──
// When access token expires, multiple requests may get 401 simultaneously.
// Without mutex, each request tries to refresh independently — the first one
// succeeds but replaces refreshToken in DB, so the rest fail and cause logout.
// With mutex, only the first request refreshes; the rest wait and reuse the new token.
let isRefreshing = false;
let refreshSubscribers = [];

function onRefreshDone(newAccessToken) {
  refreshSubscribers.forEach((cb) => cb(newAccessToken));
  refreshSubscribers = [];
}

function onRefreshFail(err) {
  refreshSubscribers.forEach((cb) => cb(null, err));
  refreshSubscribers = [];
}

function waitForRefresh() {
  return new Promise((resolve, reject) => {
    refreshSubscribers.push((token, err) => {
      if (err) reject(err);
      else resolve(token);
    });
  });
}

/** Perform the actual token refresh; returns new access token or throws. */
async function doRefresh() {
  const refreshToken = localStorage.getItem('refreshToken');
  if (!refreshToken) throw new Error('No refresh token');
  const response = await axios.post(`${getRefreshBase()}/auth/refresh`, { refreshToken });
  const { accessToken, refreshToken: newRefreshToken } = response.data;
  localStorage.setItem('accessToken', accessToken);
  localStorage.setItem('refreshToken', newRefreshToken);
  return accessToken;
}

/** Serialised refresh — guarantees at most one in-flight refresh at a time. */
async function serialRefresh() {
  if (isRefreshing) return waitForRefresh();
  isRefreshing = true;
  try {
    const token = await doRefresh();
    isRefreshing = false;
    onRefreshDone(token);
    return token;
  } catch (err) {
    isRefreshing = false;
    onRefreshFail(err);
    throw err;
  }
}

// ── Proactive refresh timer ──
// Check every 60s whether the access token is about to expire;
// if it will expire within 5 minutes, silently refresh in the background.
let proactiveTimer = null;

function startProactiveRefresh() {
  if (proactiveTimer) return;               // already running
  proactiveTimer = setInterval(async () => {
    const token = localStorage.getItem('accessToken');
    if (!token) return;                     // not logged in
    if (!isTokenExpiringSoon(token, 300)) return; // still fresh (>5 min)
    try {
      await serialRefresh();
    } catch {
      // refresh failed — will handle on next API call via 401 interceptor
    }
  }, 60_000);
}

function stopProactiveRefresh() {
  if (proactiveTimer) { clearInterval(proactiveTimer); proactiveTimer = null; }
}

// Start on load if we have a token
if (localStorage.getItem('accessToken')) startProactiveRefresh();

// Sync logout across browser tabs
window.addEventListener('storage', (e) => {
  if (e.key === 'accessToken' && !e.newValue) {
    // Another tab logged out
    stopProactiveRefresh();
    window.location.href = '/login';
  }
  if (e.key === 'accessToken' && e.newValue) {
    startProactiveRefresh();
  }
});

// ── Request interceptor — add token + proactive refresh ──
api.interceptors.request.use(
  async (config) => {
    let token = localStorage.getItem('accessToken');

    // If token expires within 30s — refresh BEFORE sending the request
    if (token && isTokenExpiringSoon(token, 30)) {
      try {
        token = await serialRefresh();
      } catch {
        // couldn't refresh — send with old token, interceptor will handle 401
      }
    }

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// ── Response interceptor — handle 401 with retry ──
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // Skip if this is already a retry, or if it's the refresh endpoint itself
    if (
      error.response?.status === 401 &&
      !originalRequest._retry &&
      !originalRequest.url?.includes('/auth/refresh') &&
      !originalRequest.url?.includes('/auth/login')
    ) {
      originalRequest._retry = true;

      try {
        const newToken = await serialRefresh();
        startProactiveRefresh();
        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        return api(originalRequest);
      } catch (refreshError) {
        stopProactiveRefresh();
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        localStorage.removeItem('user');
        window.location.href = '/login';
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

// Export helpers for AuthContext
export { startProactiveRefresh, stopProactiveRefresh };
export default api;
