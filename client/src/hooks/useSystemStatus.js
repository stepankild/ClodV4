import { useState, useEffect, useCallback, useRef } from 'react';
import { systemStatusService } from '../services/systemStatusService';
import { onScaleEvent } from '../services/scaleSocket';

/**
 * Хук для страницы /system-status.
 *
 * Возвращает:
 *   snapshot     — последний snapshot (или null если ещё не было)
 *   secondsAgo   — сколько секунд назад пришёл snapshot (пересчитывается локально каждую секунду)
 *   probeOnline  — подключён ли probe-демон по Socket.io сейчас
 *   loading      — флаг initial-load
 *   refresh()    — POST /refresh — просит probe сделать свежий snapshot прямо сейчас
 *   error        — сообщение об ошибке refresh (если было)
 *
 * Real-time обновления через `system_status_update` + `system_probe_status`.
 */
export function useSystemStatus() {
  const [snapshot, setSnapshot] = useState(null);
  const [serverSecondsAgo, setServerSecondsAgo] = useState(null);
  const [tick, setTick] = useState(0);
  const [probeOnline, setProbeOnline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const snapshotTimeRef = useRef(null);  // время клиента когда пришёл snapshot

  // Локальный secondsAgo — серверный на момент initial-load + прирост клиентского времени
  const secondsAgo = snapshot
    ? (serverSecondsAgo ?? 0) + Math.floor((Date.now() - (snapshotTimeRef.current || Date.now())) / 1000)
    : null;

  // initial-load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { snapshot: snap, secondsAgo: sa, probeOnline: po } = await systemStatusService.getLatest();
        if (cancelled) return;
        setSnapshot(snap);
        setServerSecondsAgo(sa);
        setProbeOnline(!!po);
        snapshotTimeRef.current = Date.now();
      } catch (err) {
        if (!cancelled) console.warn('system-status initial load failed:', err?.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Tick каждую секунду — чтобы "N секунд назад" обновлялось без fetch
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Real-time обновления через Socket.io
  useEffect(() => {
    const unsub = onScaleEvent((event, data) => {
      if (event === 'system_status_update') {
        setSnapshot(data);
        setServerSecondsAgo(0);
        snapshotTimeRef.current = Date.now();
      } else if (event === 'system_probe_status') {
        setProbeOnline(!!data?.online);
      }
    });
    return unsub;
  }, []);

  const refresh = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      await systemStatusService.refresh();
    } catch (err) {
      const status = err?.response?.status;
      if (status === 503) setError('probe-offline');
      else setError('refresh-failed');
    } finally {
      setBusy(false);
    }
  }, []);

  return { snapshot, secondsAgo, probeOnline, loading, refresh, error, busy };
}
