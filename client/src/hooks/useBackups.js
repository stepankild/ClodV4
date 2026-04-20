import { useState, useEffect, useCallback, useRef } from 'react';
import { backupService } from '../services/backupService';
import { onScaleEvent } from '../services/scaleSocket';

/**
 * Хук для страницы /backups.
 *
 * Возвращает:
 *   list          — последние N записей BackupLog
 *   agentOnline   — boolean, подключён ли backup-агент
 *   loading       — bool для initial-load
 *   reload()      — форсировать перезагрузку списка
 *   run(type)     — POST /api/backups/run, type: 'weekly' | 'monthly'
 *
 * Real-time обновление через Socket.io-событие 'backup:updated'.
 * Agent-status: initial poll + событие 'backup:agent-status'.
 */
export function useBackups() {
  const [list, setList] = useState([]);
  const [agentOnline, setAgentOnline] = useState(false);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  const reload = useCallback(async () => {
    try {
      const { logs } = await backupService.list({ limit: 50 });
      if (mountedRef.current) setList(logs);
    } catch (err) {
      console.warn('backup list failed:', err?.message);
    }
  }, []);

  const refreshAgent = useCallback(async () => {
    try {
      const { online } = await backupService.agentStatus();
      if (mountedRef.current) setAgentOnline(!!online);
    } catch {
      if (mountedRef.current) setAgentOnline(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;

    (async () => {
      await Promise.all([reload(), refreshAgent()]);
      if (!cancelled && mountedRef.current) setLoading(false);
    })();

    const unsubscribe = onScaleEvent((event) => {
      if (event === 'backup_updated') {
        reload();
      } else if (event === 'backup_agent_status') {
        refreshAgent();
      }
    });

    // safety net: каждые 15с переспрашиваем agent-status
    const interval = setInterval(refreshAgent, 15000);

    return () => {
      mountedRef.current = false;
      cancelled = true;
      unsubscribe();
      clearInterval(interval);
    };
  }, [reload, refreshAgent]);

  const run = useCallback(async (type) => {
    return await backupService.run(type);
  }, []);

  return { list, agentOnline, loading, reload, run };
}
