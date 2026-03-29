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

  useEffect(() => { loadData(); }, [loadData]);

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

  const plugOn = status?.plugState === 'on';
  const todayStats = log.length > 0 ? {
    onCount: log.filter(l => l.action === 'on' && new Date(l.timestamp).toDateString() === new Date().toDateString()).length,
    totalMin: log.filter(l => l.action === 'on' && new Date(l.timestamp).toDateString() === new Date().toDateString())
      .reduce((sum, l) => sum + (l.duration || 0), 0)
  } : { onCount: 0, totalMin: 0 };

  return (
    <div className="bg-dark-800 border border-dark-700 rounded-lg p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className="text-lg">💧</span>
          <h3 className="text-lg font-semibold text-dark-100">Полив</h3>
          <span className={`text-xs px-2 py-0.5 rounded-full ${plugOn ? 'bg-green-900 text-green-300' : 'bg-dark-700 text-dark-400'}`}>
            {plugOn ? 'Насос ВКЛ' : 'Насос ВЫКЛ'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleManual(plugOn ? 'off' : 'on')}
            className={`text-xs px-3 py-1.5 rounded font-medium ${plugOn
              ? 'bg-red-900 text-red-300 hover:bg-red-800'
              : 'bg-green-900 text-green-300 hover:bg-green-800'}`}
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

      {/* Log */}
      {showLog && log.length > 0 && (
        <div className="mt-4 border-t border-dark-700 pt-3">
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {log.map((entry, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className={entry.action === 'on' ? 'text-green-400' : 'text-red-400'}>
                  {entry.action === 'on' ? '▲' : '▼'}
                </span>
                <span className="text-dark-500">
                  {new Date(entry.timestamp).toLocaleString('ru-RU', {
                    day: '2-digit', month: '2-digit',
                    hour: '2-digit', minute: '2-digit'
                  })}
                </span>
                <span className="text-dark-300">
                  {entry.action === 'on' ? 'Вкл' : 'Выкл'}
                  {entry.scheduleTime && ` (${entry.scheduleTime})`}
                  {entry.duration && entry.action === 'on' && ` ${entry.duration}мин`}
                </span>
                <span className="text-dark-600 ml-auto">
                  {entry.trigger === 'schedule' ? 'авто' : 'ручн.'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default IrrigationPanel;
