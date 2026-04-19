import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { iotService } from '../../services/iotService';

const IrrigationPanel = ({ zoneId }) => {
  const { t } = useTranslation();
  const [status, setStatus] = useState(null);
  const [log, setLog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showLog, setShowLog] = useState(false);

  // Local editable state
  const [enabled, setEnabled] = useState(true);
  const [schedules, setSchedules] = useState([]);

  const loadData = useCallback(async () => {
    try {
      const [statusData, logData] = await Promise.all([
        iotService.getIrrigationStatus(zoneId),
        iotService.getIrrigationLog(zoneId, { limit: 30 })
      ]);
      setStatus(statusData);
      setLog(logData.logs || []);
      setEnabled(statusData.enabled ?? true);
      setSchedules(statusData.schedules || []);
    } catch (err) {
      console.error('Irrigation load error:', err);
    } finally {
      setLoading(false);
    }
  }, [zoneId]);

  useEffect(() => {
    loadData();
    // Poll the live HA state every 30 seconds so a stuck pump / drift is
    // noticed without needing a manual reload.
    const interval = setInterval(loadData, 30 * 1000);
    return () => clearInterval(interval);
  }, [loadData]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await iotService.controlIrrigation(zoneId, { schedules, enabled });
      await loadData();
    } catch (err) {
      console.error('Save error:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleManual = async (action) => {
    try {
      await iotService.controlIrrigation(zoneId, { action });
      await loadData();
    } catch (err) {
      console.error('Manual control error:', err);
    }
  };

  const addSchedule = () => {
    setSchedules([...schedules, { time: '08:00', duration: 5, enabled: true }]);
  };

  const removeSchedule = (idx) => {
    setSchedules(schedules.filter((_, i) => i !== idx));
  };

  const updateSchedule = (idx, field, value) => {
    const updated = [...schedules];
    updated[idx] = { ...updated[idx], [field]: value };
    setSchedules(updated);
  };

  if (loading) {
    return (
      <div className="bg-dark-800 border border-dark-700 rounded-lg p-5">
        <div className="animate-pulse h-20 bg-dark-700 rounded"></div>
      </div>
    );
  }

  // Real pump state: prefer the live HA value from status, fall back to the
  // last-known value the scheduler stored in the DB. If both are missing,
  // show "unknown" so we never imply the pump is off when we don't know.
  const liveState = (status?.plugState === 'on' || status?.plugState === 'off')
    ? status.plugState
    : (status?.liveState || 'unknown');
  const plugOn = liveState === 'on';
  const plugUnknown = liveState !== 'on' && liveState !== 'off';
  const stuck = !!status?.stuck;
  const stuckReason = status?.stuckReason || '';
  const liveStateAt = status?.liveStateAt ? new Date(status.liveStateAt) : null;

  const todayStats = log.length > 0 ? {
    onCount: log.filter(l => l.action === 'on' && new Date(l.timestamp).toDateString() === new Date().toDateString()).length,
    totalMin: log.filter(l => l.action === 'on' && new Date(l.timestamp).toDateString() === new Date().toDateString())
      .reduce((sum, l) => sum + (l.duration || 0), 0)
  } : { onCount: 0, totalMin: 0 };

  return (
    <div className={`bg-dark-800 border rounded-lg p-5 ${stuck ? 'border-red-700' : 'border-dark-700'}`}>
      {stuck && (
        <div className="mb-4 p-3 bg-red-900/40 border border-red-800 rounded-lg text-xs text-red-300 flex items-start gap-2">
          <span className="text-base leading-none">⚠</span>
          <div className="min-w-0">
            <div className="font-semibold text-red-200">Насос завис</div>
            <div className="text-red-300/80">
              {stuckReason || 'Насос работает дольше расписания и не отвечает на команду выключения'}
            </div>
            <div className="text-red-300/60 mt-0.5">
              Проверьте Home Assistant и выключите вручную. Система продолжит попытки.
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className="text-lg">💧</span>
          <h3 className="text-lg font-semibold text-dark-100">Полив</h3>
          <span
            className={`text-xs px-2 py-0.5 rounded-full ${
              plugUnknown
                ? 'bg-amber-900 text-amber-300'
                : plugOn
                  ? 'bg-green-900 text-green-300'
                  : 'bg-dark-700 text-dark-400'
            }`}
            title={liveStateAt ? `Обновлено ${liveStateAt.toLocaleTimeString()}` : ''}
          >
            {plugUnknown ? 'Насос ?' : plugOn ? 'Насос ВКЛ' : 'Насос ВЫКЛ'}
          </span>
          {stuck && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-red-900 text-red-300">
              завис
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleManual(plugOn ? 'off' : 'on')}
            className={`text-xs px-3 py-1.5 rounded font-medium ${plugOn
              ? 'bg-red-900 text-red-300 hover:bg-red-800'
              : 'bg-green-900 text-green-300 hover:bg-green-800'}`}
            disabled={plugUnknown}
          >
            {plugOn ? 'Выключить' : 'Включить'}
          </button>
        </div>
      </div>

      {/* Master toggle */}
      <div className="flex items-center gap-3 mb-4 p-3 bg-dark-900 rounded-lg">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="w-4 h-4 accent-primary-500"
          />
          <span className="text-sm text-dark-200">Автоматический полив по расписанию</span>
        </label>
        {todayStats.onCount > 0 && (
          <span className="text-xs text-dark-500 ml-auto">
            Сегодня: {todayStats.onCount}x / {todayStats.totalMin} мин
          </span>
        )}
      </div>

      {/* Schedules */}
      <div className="space-y-2 mb-4">
        {schedules.map((sched, idx) => (
          <div key={idx} className="flex items-center gap-3 p-2 bg-dark-700 rounded">
            <input
              type="checkbox"
              checked={sched.enabled}
              onChange={(e) => updateSchedule(idx, 'enabled', e.target.checked)}
              className="w-4 h-4 accent-primary-500"
            />
            <input
              type="time"
              value={sched.time}
              onChange={(e) => updateSchedule(idx, 'time', e.target.value)}
              className="bg-dark-800 border border-dark-600 rounded px-2 py-1 text-sm text-dark-100 w-28"
            />
            <div className="flex items-center gap-1">
              <input
                type="number"
                min="1"
                max="60"
                value={sched.duration}
                onChange={(e) => updateSchedule(idx, 'duration', parseInt(e.target.value) || 1)}
                className="bg-dark-800 border border-dark-600 rounded px-2 py-1 text-sm text-dark-100 w-16 text-center"
              />
              <span className="text-xs text-dark-500">мин</span>
            </div>
            <button
              onClick={() => removeSchedule(idx)}
              className="ml-auto text-dark-500 hover:text-red-400 text-lg leading-none"
            >
              ×
            </button>
          </div>
        ))}

        <button
          onClick={addSchedule}
          className="text-sm text-primary-400 hover:text-primary-300 flex items-center gap-1"
        >
          <span>+</span> Добавить время полива
        </button>
      </div>

      {/* Save button */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-primary-600 hover:bg-primary-500 text-white text-sm px-4 py-2 rounded font-medium disabled:opacity-50"
        >
          {saving ? 'Сохранение...' : 'Сохранить расписание'}
        </button>

        <button
          onClick={() => setShowLog(!showLog)}
          className="text-sm text-dark-400 hover:text-dark-200"
        >
          {showLog ? 'Скрыть лог' : 'Показать лог'}
        </button>
      </div>

      {/* Log — paired ON→OFF sessions + failure/miss rows, grouped by day */}
      {showLog && log.length > 0 && (() => {
        const asc = [...log].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        const items = []; // sessions AND standalone failure/miss events, chronological
        let open = null;
        for (const entry of asc) {
          if (entry.action === 'on') {
            if (open) items.push({ kind: 'session', ...open, offAt: null, abandoned: true });
            open = {
              onAt: entry.timestamp,
              scheduleTime: entry.scheduleTime,
              duration: entry.duration,
              trigger: entry.trigger,
              expectedOffAt: entry.expectedOffAt,
            };
          } else if (entry.action === 'off' && open) {
            items.push({ kind: 'session', ...open, offAt: entry.timestamp, offTrigger: entry.trigger });
            open = null;
          } else if (entry.action === 'off') {
            // OFF without matching ON — rare (external toggle off). Still show.
            items.push({ kind: 'orphan-off', offAt: entry.timestamp, trigger: entry.trigger });
          } else if (entry.action === 'failure' || entry.action === 'miss') {
            items.push({
              kind: entry.action,
              at: entry.timestamp,
              scheduleTime: entry.scheduleTime,
              duration: entry.duration,
              notes: entry.notes,
              trigger: entry.trigger,
            });
          }
        }
        if (open) items.push({ kind: 'session', ...open, offAt: null, ongoing: true });
        items.reverse();

        const now = Date.now();
        const fmtTime = (ts) => new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', hour12: false });
        const fmtDur = (ms) => {
          const m = Math.max(0, Math.round(ms / 60000));
          return m >= 60 ? `${Math.floor(m / 60)}ч ${m % 60}м` : `${m}м`;
        };
        const dayKey = (ts) => { const d = new Date(ts); d.setHours(0,0,0,0); return d.getTime(); };
        const today0 = (() => { const d = new Date(); d.setHours(0,0,0,0); return d.getTime(); })();
        const dayLabel = (k) => {
          if (k === today0) return 'Сегодня';
          if (k === today0 - 86400000) return 'Вчера';
          return new Date(k).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
        };
        const triggerBadge = (t) => {
          if (t === 'schedule') return { icon: '🕐', label: 'по расписанию', color: 'text-cyan-400', tip: 'Сработало автоматически по таймеру' };
          if (t === 'manual')   return { icon: '✋', label: 'вручную',        color: 'text-amber-400', tip: 'Включено/выключено через кнопку в портале' };
          if (t === 'external') return { icon: '🔌', label: 'извне',          color: 'text-purple-400', tip: 'Переключено снаружи (Xiaomi Home, HA, кнопка на плагине)' };
          if (t === 'system')   return { icon: '⚙️', label: 'служебное',     color: 'text-dark-400', tip: 'Системная запись (пропуск расписания, сверка с HA)' };
          return { icon: '•', label: t, color: 'text-dark-500', tip: t };
        };

        const byDay = new Map();
        for (const it of items.slice(0, 40)) {
          const ts = it.onAt || it.at || it.offAt;
          const k = dayKey(ts);
          if (!byDay.has(k)) byDay.set(k, []);
          byDay.get(k).push(it);
        }

        return (
          <div className="mt-4 border-t border-dark-700 pt-3 space-y-2 max-h-72 overflow-y-auto">
            {[...byDay.entries()].map(([k, day]) => {
              const totalMs = day.reduce((acc, it) => {
                if (it.kind !== 'session' || it.abandoned) return acc;
                const end = it.offAt ? new Date(it.offAt).getTime() : now;
                return acc + (end - new Date(it.onAt).getTime());
              }, 0);
              const sessionCount = day.filter(it => it.kind === 'session' && !it.abandoned).length;
              const issueCount = day.filter(it => it.kind === 'failure' || it.kind === 'miss').length;
              return (
                <div key={k} className="rounded border border-dark-700 overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-1.5 bg-dark-700/50 text-[10px] uppercase tracking-wider">
                    <span className="text-dark-400">{dayLabel(k)}</span>
                    <span className="text-dark-500 normal-case">
                      {sessionCount > 0 && `${sessionCount} полив${sessionCount === 1 ? '' : sessionCount < 5 ? 'а' : 'ов'} · всего ${fmtDur(totalMs)}`}
                      {issueCount > 0 && <span className="text-red-400 ml-2">⚠ {issueCount} проблем{issueCount === 1 ? 'а' : issueCount < 5 ? 'ы' : ''}</span>}
                    </span>
                  </div>
                  {day.map((it, i) => {
                    if (it.kind === 'session') {
                      const onMs = new Date(it.onAt).getTime();
                      const offMs = it.offAt ? new Date(it.offAt).getTime() : now;
                      const durMs = offMs - onMs;
                      const expDur = it.duration ? it.duration * 60 * 1000 : null;
                      const runLong = expDur && !it.ongoing && !it.abandoned && durMs > expDur * 1.5;
                      const badge = triggerBadge(it.trigger);
                      return (
                        <div
                          key={i}
                          className={`grid grid-cols-[auto_56px_1fr_auto] gap-x-3 px-3 py-1.5 text-xs items-center ${i % 2 === 0 ? 'bg-dark-800' : 'bg-dark-800/50'}`}
                        >
                          <span className="font-mono tabular-nums text-dark-300">
                            {fmtTime(it.onAt)}
                            <span className="text-dark-600 mx-1">→</span>
                            {it.ongoing ? (
                              <span className="text-green-400">сейчас</span>
                            ) : it.abandoned ? (
                              <span className="text-dark-600">?</span>
                            ) : (
                              fmtTime(it.offAt)
                            )}
                          </span>
                          <span className={`font-medium tabular-nums text-right ${it.ongoing ? 'text-green-400 animate-pulse' : runLong ? 'text-amber-400' : 'text-cyan-400'}`}>
                            {it.abandoned ? '—' : fmtDur(durMs)}
                          </span>
                          <span className="text-dark-500">
                            {it.scheduleTime && <span className="text-dark-400">{it.scheduleTime}</span>}
                            {it.duration && <span className="text-dark-600"> · план {it.duration}м</span>}
                            {runLong && <span className="text-amber-400 ml-1">(дольше плана)</span>}
                            {it.abandoned && <span className="text-amber-600 ml-1">сессия прервана</span>}
                          </span>
                          <span className="flex items-center gap-1 text-[11px] whitespace-nowrap cursor-help" title={badge.tip}>
                            <span className="text-sm">{badge.icon}</span>
                            <span className={badge.color}>{badge.label}</span>
                          </span>
                        </div>
                      );
                    }
                    if (it.kind === 'failure') {
                      const badge = triggerBadge(it.trigger);
                      return (
                        <div key={i} className="px-3 py-1.5 text-xs bg-red-900/20 border-l-2 border-red-500">
                          <div className="flex items-center gap-3">
                            <span className="font-mono tabular-nums text-red-300">{fmtTime(it.at)}</span>
                            <span className="text-red-400 font-medium">🚨 НЕ СРАБОТАЛ</span>
                            {it.scheduleTime && <span className="text-dark-400">{it.scheduleTime}</span>}
                            <span className="flex items-center gap-1 text-[11px] whitespace-nowrap ml-auto cursor-help" title={badge.tip}>
                              <span className="text-sm">{badge.icon}</span>
                              <span className={badge.color}>{badge.label}</span>
                            </span>
                          </div>
                          {it.notes && <div className="text-red-300/70 text-[11px] mt-0.5 ml-[52px]">{it.notes}</div>}
                        </div>
                      );
                    }
                    if (it.kind === 'miss') {
                      return (
                        <div key={i} className="px-3 py-1.5 text-xs bg-amber-900/20 border-l-2 border-amber-500">
                          <div className="flex items-center gap-3">
                            <span className="font-mono tabular-nums text-amber-300">{fmtTime(it.at)}</span>
                            <span className="text-amber-400 font-medium">⚠ ПРОПУЩЕН</span>
                            {it.scheduleTime && <span className="text-dark-400">{it.scheduleTime}</span>}
                            <span className="text-[11px] text-dark-500 ml-auto">scheduler не сработал</span>
                          </div>
                          {it.notes && <div className="text-amber-300/70 text-[11px] mt-0.5 ml-[52px]">{it.notes}</div>}
                        </div>
                      );
                    }
                    // orphan-off
                    return (
                      <div key={i} className="px-3 py-1.5 text-xs text-dark-500 italic">
                        {fmtTime(it.offAt)} — выключение без предшествующего включения
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        );
      })()}
    </div>
  );
};

export default IrrigationPanel;
