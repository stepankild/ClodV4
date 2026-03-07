import { useState, useEffect } from 'react';
import { treatmentService } from '../../services/treatmentService';

const STATUS_CONFIG = {
  overdue: { label: 'Просрочено', color: 'text-red-400', bg: 'bg-red-900/30', border: 'border-red-800' },
  due_today: { label: 'Сегодня', color: 'text-yellow-400', bg: 'bg-yellow-900/30', border: 'border-yellow-800' },
  upcoming: { label: 'Предстоит', color: 'text-dark-400', bg: '', border: 'border-dark-700' },
  finished: { label: 'Завершено', color: 'text-dark-500', bg: '', border: 'border-dark-700' }
};

const APPLICATION_METHODS = {
  spray: 'опрыскивание',
  soil_drench: 'полив',
  release: 'выпуск',
  other: ''
};

export default function UpcomingTreatments({ targetType, targetId, onComplete }) {
  const [schedule, setSchedule] = useState(null);
  const [upcoming, setUpcoming] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      setLoading(true);
      const sched = await treatmentService.getSchedule(targetType, targetId);
      setSchedule(sched);
      if (sched?._id) {
        const data = await treatmentService.getUpcoming(sched._id);
        setUpcoming(data);
      } else {
        setUpcoming(null);
      }
    } catch (err) {
      console.error('Load treatments error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [targetType, targetId]);

  if (loading) return <div className="text-dark-500 text-sm">Загрузка обработок...</div>;
  if (!schedule || !upcoming) return null;

  const actionable = upcoming.treatments.filter(t => t.status !== 'finished');
  if (actionable.length === 0) return null;

  const handleComplete = async (treatment) => {
    try {
      await treatmentService.completeTreatment(schedule._id, {
        entryId: treatment.entryId,
        dayOfCycle: upcoming.currentDay
      });
      load();
      onComplete?.();
    } catch (err) {
      console.error('Complete treatment error:', err);
    }
  };

  return (
    <div className="space-y-2 border-t border-dark-700 pt-4">
      <h4 className="text-sm font-medium text-dark-300">Протокол обработки</h4>
      <div className="space-y-1.5">
        {actionable.map(t => {
          const cfg = STATUS_CONFIG[t.status] || STATUS_CONFIG.upcoming;
          const method = t.product?.applicationMethod ? APPLICATION_METHODS[t.product.applicationMethod] : '';
          return (
            <div key={t.entryId} className={`flex items-center justify-between p-2 rounded-lg border ${cfg.border} ${cfg.bg}`}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  {(t.status === 'overdue' || t.status === 'due_today') && (
                    <span className={`text-xs font-medium ${cfg.color}`}>{cfg.label}</span>
                  )}
                  <span className="text-sm text-white truncate">{t.product?.name || '?'}</span>
                  <span className="text-xs text-dark-500">(день {t.nextDueDay})</span>
                  {method && <span className="text-xs text-dark-500">— {method}</span>}
                </div>
                {t.dosage && <span className="text-xs text-dark-400">{t.dosage}</span>}
              </div>
              {(t.status === 'overdue' || t.status === 'due_today') && (
                <button
                  onClick={() => handleComplete(t)}
                  className="ml-2 p-1.5 text-green-400 hover:bg-green-900/30 rounded transition shrink-0"
                  title="Выполнено"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
