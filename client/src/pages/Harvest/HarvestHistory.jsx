import { useState, useEffect, useMemo } from 'react';
import { harvestService } from '../../services/harvestService';

const formatDate = (date) => {
  if (!date) return '';
  return new Date(date).toLocaleDateString('ru-RU', {
    day: '2-digit', month: '2-digit', year: '2-digit'
  });
};

const formatTime = (date) => {
  if (!date) return '';
  return new Date(date).toLocaleTimeString('ru-RU', {
    hour: '2-digit', minute: '2-digit'
  });
};

const formatDuration = (ms) => {
  if (!ms || ms <= 0) return '';
  const totalMin = Math.round(ms / 60000);
  if (totalMin < 60) return `${totalMin}мин`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `${h}ч ${m}мин` : `${h}ч`;
};

const formatWeight = (g) => {
  if (g == null || !Number.isFinite(g) || g <= 0) return '';
  if (g >= 1000) return `${(g / 1000).toFixed(1)}кг`;
  return `${Math.round(g)}г`;
};

function computeMetrics(session) {
  const plants = session.plants || [];
  if (plants.length === 0) {
    return { count: 0, totalWet: 0, avgWeight: 0, minWeight: 0, maxWeight: 0, duration: 0, plantsPerMin: 0, strains: [], collectors: [], errorCount: 0 };
  }

  const weights = plants.map(p => p.wetWeight).filter(w => w > 0);
  const totalWet = weights.reduce((s, w) => s + w, 0);
  const count = plants.length;
  const avgWeight = count > 0 ? Math.round(totalWet / count) : 0;
  const minWeight = weights.length > 0 ? Math.min(...weights) : 0;
  const maxWeight = weights.length > 0 ? Math.max(...weights) : 0;

  // Duration: from first recordedAt to last recordedAt
  const times = plants.map(p => new Date(p.recordedAt).getTime()).filter(t => t > 0);
  const duration = times.length >= 2 ? Math.max(...times) - Math.min(...times) : 0;
  const durationMin = duration / 60000;
  const plantsPerMin = durationMin > 0 ? (count / durationMin) : 0;

  // Strain breakdown
  const strainMap = {};
  for (const p of plants) {
    const s = p.strain || '';
    if (!strainMap[s]) strainMap[s] = { strain: s, count: 0, totalWet: 0, weights: [] };
    strainMap[s].count++;
    strainMap[s].totalWet += p.wetWeight || 0;
    strainMap[s].weights.push(p.wetWeight || 0);
  }
  const strains = Object.values(strainMap)
    .map(s => ({
      ...s,
      avgWeight: s.count > 0 ? Math.round(s.totalWet / s.count) : 0,
      pct: totalWet > 0 ? ((s.totalWet / totalWet) * 100).toFixed(1) : '0'
    }))
    .sort((a, b) => b.totalWet - a.totalWet);

  // Unique collectors
  const collectorMap = {};
  for (const p of plants) {
    const name = p.recordedBy?.name || p.recordedBy;
    if (name && typeof name === 'string') {
      collectorMap[name] = true;
    }
  }
  const collectors = Object.keys(collectorMap);

  // Error count
  const errorCount = plants.filter(p => p.errorNote && p.errorNote.trim()).length;

  return { count, totalWet, avgWeight, minWeight, maxWeight, duration, plantsPerMin, strains, collectors, errorCount };
}

const HarvestHistory = () => {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await harvestService.getSessions({ status: 'completed', limit: 20 });
        if (!cancelled) setSessions(Array.isArray(data) ? data : []);
      } catch (e) {
        console.error('Load harvest history error:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const sessionsWithMetrics = useMemo(() =>
    sessions.map(s => ({ ...s, metrics: computeMetrics(s) })),
    [sessions]
  );

  if (loading) {
    return (
      <div className="mt-6">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-lg">📦</span>
          <h2 className="text-lg font-semibold text-white">Архив сборов</h2>
        </div>
        <div className="text-dark-500 text-sm py-4 text-center">Загрузка...</div>
      </div>
    );
  }

  if (sessionsWithMetrics.length === 0) {
    return (
      <div className="mt-6">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-lg">📦</span>
          <h2 className="text-lg font-semibold text-white">Архив сборов</h2>
        </div>
        <div className="text-dark-500 text-sm py-4 text-center">Нет завершённых сборов</div>
      </div>
    );
  }

  return (
    <div className="mt-6">
      {/* Header */}
      <button
        onClick={() => setCollapsed(c => !c)}
        className="flex items-center gap-2 mb-3 group"
      >
        <span className="text-lg">📦</span>
        <h2 className="text-lg font-semibold text-white group-hover:text-primary-400 transition-colors">
          Архив сборов
        </h2>
        <span className="text-dark-500 text-sm">({sessionsWithMetrics.length})</span>
        <svg
          className={`w-4 h-4 text-dark-500 transition-transform ${collapsed ? '' : 'rotate-180'}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {!collapsed && (
        <div className="space-y-2">
          {sessionsWithMetrics.map(s => {
            const m = s.metrics;
            const isExpanded = expandedId === s._id;
            return (
              <div key={s._id} className="bg-dark-800 border border-dark-700 rounded-lg overflow-hidden">
                {/* Compact row */}
                <button
                  onClick={() => setExpandedId(isExpanded ? null : s._id)}
                  className="w-full px-3 py-2.5 text-left hover:bg-dark-700/30 transition-colors"
                >
                  {/* Top line: room + cycle + date */}
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-white font-medium text-sm truncate">
                        {s.roomName || `Комната ${s.roomNumber}`}
                      </span>
                      {s.cycleName && (
                        <span className="text-dark-400 text-xs truncate">
                          {s.cycleName}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      <span className="text-dark-500 text-xs">
                        {formatDate(s.completedAt || s.startedAt)} {formatTime(s.completedAt || s.startedAt)}
                      </span>
                      <svg
                        className={`w-4 h-4 text-dark-600 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                        fill="none" stroke="currentColor" viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </div>

                  {/* Metrics line */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
                    {m.duration > 0 && (
                      <span className="text-dark-400">
                        <span className="text-dark-600 mr-0.5">⏱</span>
                        {formatDuration(m.duration)}
                      </span>
                    )}
                    <span className="text-dark-400">
                      {m.count} <span className="text-dark-600">кустов</span>
                    </span>
                    {m.plantsPerMin > 0 && (
                      <span className="text-blue-400">
                        {m.plantsPerMin.toFixed(1)}<span className="text-dark-600">/мин</span>
                      </span>
                    )}
                    <span className="text-primary-400 font-medium">
                      {formatWeight(m.totalWet)}
                    </span>
                    <span className="text-dark-400">
                      {m.avgWeight}<span className="text-dark-600">г/куст</span>
                    </span>
                  </div>
                </button>

                {/* Expanded details */}
                {isExpanded && (
                  <div className="px-3 pb-3 border-t border-dark-700/50 space-y-3">
                    {/* Strain breakdown */}
                    {m.strains.length > 0 && (
                      <div className="mt-2.5">
                        <div className="text-dark-500 text-xs mb-1.5 font-medium">Разбивка по сортам</div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-dark-500 border-b border-dark-700/50">
                                <th className="text-left py-1 pr-3 font-medium">Сорт</th>
                                <th className="text-right py-1 px-2 font-medium">Кустов</th>
                                <th className="text-right py-1 px-2 font-medium">Общий</th>
                                <th className="text-right py-1 px-2 font-medium">Ср. вес</th>
                                <th className="text-right py-1 pl-2 font-medium">%</th>
                              </tr>
                            </thead>
                            <tbody>
                              {m.strains.map(st => (
                                <tr key={st.strain} className="border-b border-dark-700/30">
                                  <td className="py-1 pr-3 text-white truncate max-w-[120px]">{st.strain || '—'}</td>
                                  <td className="py-1 px-2 text-right text-dark-400">{st.count}</td>
                                  <td className="py-1 px-2 text-right text-primary-400">{formatWeight(st.totalWet)}</td>
                                  <td className="py-1 px-2 text-right text-dark-300">{st.avgWeight}г</td>
                                  <td className="py-1 pl-2 text-right text-dark-500">{st.pct}%</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* Additional info */}
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                      <span className="text-dark-400">
                        <span className="text-dark-600">Мин: </span>
                        <span className="text-dark-300">{m.minWeight}г</span>
                      </span>
                      <span className="text-dark-400">
                        <span className="text-dark-600">Макс: </span>
                        <span className="text-dark-300">{m.maxWeight}г</span>
                      </span>
                      {m.collectors.length > 0 && (
                        <span className="text-dark-400">
                          <span className="text-dark-600">Сборщики: </span>
                          <span className="text-dark-300">{m.collectors.join(', ')}</span>
                        </span>
                      )}
                      {m.errorCount > 0 && (
                        <span className="text-amber-400">
                          <span className="text-dark-600">Ошибки: </span>
                          {m.errorCount}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default HarvestHistory;
