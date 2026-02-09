import { useState, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { useAuth } from '../../context/AuthContext';
import { trimService } from '../../services/trimService';

const formatDate = (date) => {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const fmt = (v, decimals = 1) => {
  if (v == null || isNaN(v)) return '—';
  return Number(v).toFixed(decimals);
};

const formatLogDate = (dateStr) => {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const logDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.floor((today - logDay) / (24 * 60 * 60 * 1000));
  if (diff === 0) return 'Сегодня';
  if (diff === 1) return 'Вчера';
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
};

const progressColor = (pct) => {
  if (pct >= 80) return 'bg-green-500';
  if (pct >= 50) return 'bg-amber-500';
  return 'bg-primary-500';
};

// ─── Phase detection ───
const PHASES = [
  { key: 'drying', label: 'Сушка' },
  { key: 'dry_weight', label: 'Сухой вес' },
  { key: 'trimming', label: 'Трим' },
  { key: 'completed', label: 'Готово' }
];

const derivePhase = (a) => {
  if (a.trimStatus === 'completed') return 'completed';
  const dry = a.harvestData?.dryWeight || 0;
  const sd = a.strainData || [];
  const hasDry = dry > 0 || sd.some(s => (s.dryWeight || 0) > 0);
  if (!hasDry) return 'drying';
  return 'trimming';
};

const phaseIndex = (phase) => PHASES.findIndex(p => p.key === phase);

// ─── Metrics ───
const calcMetrics = (a) => {
  const wet = a.harvestData?.wetWeight || 0;
  const dry = a.harvestData?.dryWeight || 0;
  const trim = a.harvestData?.trimWeight || 0;
  const popcorn = a.harvestData?.popcornWeight || 0;
  const finalYield = trim + popcorn;
  const trimProgress = dry > 0 ? Math.min(100, Math.round(trim / dry * 100)) : 0;
  const shrinkage = wet > 0 && dry > 0 ? ((wet - dry) / wet * 100) : null;
  const trimLoss = dry > 0 && finalYield > 0 ? ((dry - finalYield) / dry * 100) : null;
  return { wet, dry, trim, popcorn, finalYield, trimProgress, shrinkage, trimLoss };
};

const Trim = () => {
  const { hasPermission } = useAuth();
  const canCreate = hasPermission && hasPermission('trim:create');
  const canEdit = hasPermission && hasPermission('trim:edit');

  const [archives, setArchives] = useState([]);
  const [dailyStats, setDailyStats] = useState([]);
  const [statsDays, setStatsDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filters & chart
  const [statusFilter, setStatusFilter] = useState('active');
  const [chartOpen, setChartOpen] = useState(false);

  // Inline log per card
  const [inlineWeights, setInlineWeights] = useState({});
  const [inlineStrains, setInlineStrains] = useState({});
  const [inlineSaving, setInlineSaving] = useState({});

  // Dry weight inline form per card
  const [dryWeightForms, setDryWeightForms] = useState({});  // { archiveId: [{ strain, wetWeight, dryWeight }] }
  const [dryWeightSaving, setDryWeightSaving] = useState({});

  // Popcorn inline form per card
  const [popcornForms, setPopcornForms] = useState({});  // { archiveId: [{ strain, popcornWeight }] }
  const [popcornSaving, setPopcornSaving] = useState({});
  const [popcornOpen, setPopcornOpen] = useState({});

  // Accordion logs per card
  const [expandedLogs, setExpandedLogs] = useState({});
  const [archiveLogs, setArchiveLogs] = useState({});
  const [archiveLogsLoading, setArchiveLogsLoading] = useState({});

  // Edit modal
  const [editModal, setEditModal] = useState(null);
  const [editStrainData, setEditStrainData] = useState([]);
  const [editSaving, setEditSaving] = useState(false);

  // ─── Data loading ───
  useEffect(() => { load(); }, [statusFilter]);

  useEffect(() => {
    if (chartOpen && dailyStats.length === 0) {
      trimService.getDailyStats(statsDays).then(d => setDailyStats(Array.isArray(d) ? d : [])).catch(() => {});
    }
  }, [chartOpen]);

  const load = async () => {
    try {
      setLoading(true);
      setError('');
      const archivesData = await trimService.getActiveArchives(statusFilter);
      setArchives(Array.isArray(archivesData) ? archivesData : []);
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  };

  // ─── Dry weight form ───
  const openDryWeightForm = (a) => {
    const sd = Array.isArray(a.strainData) && a.strainData.length
      ? a.strainData.map(s => ({ strain: s.strain || '', wetWeight: s.wetWeight ?? 0, dryWeight: s.dryWeight ?? 0 }))
      : [{ strain: a.strain || '', wetWeight: a.harvestData?.wetWeight ?? 0, dryWeight: 0 }];
    setDryWeightForms(prev => ({ ...prev, [a._id]: sd }));
  };

  const closeDryWeightForm = (archiveId) => {
    setDryWeightForms(prev => {
      const next = { ...prev };
      delete next[archiveId];
      return next;
    });
  };

  const handleSaveDryWeight = async (archiveId) => {
    const rows = dryWeightForms[archiveId];
    if (!rows) return;
    setDryWeightSaving(prev => ({ ...prev, [archiveId]: true }));
    try {
      const archive = archives.find(a => a._id === archiveId);
      const existingSD = Array.isArray(archive?.strainData) ? archive.strainData : [];
      const strainData = rows.map(r => {
        const existing = existingSD.find(s => s.strain === r.strain);
        return {
          strain: String(r.strain || '').trim(),
          wetWeight: Number(r.wetWeight) || 0,
          dryWeight: Number(r.dryWeight) || 0,
          popcornWeight: existing?.popcornWeight || 0
        };
      }).filter(s => s.strain !== '');
      const dryTotal = strainData.reduce((sum, s) => sum + s.dryWeight, 0);
      const popcornTotal = strainData.reduce((sum, s) => sum + s.popcornWeight, 0);
      await trimService.updateArchive(archiveId, {
        dryWeight: dryTotal,
        popcornWeight: popcornTotal,
        strainData: strainData.length ? strainData : undefined,
        strains: strainData.length ? strainData.map(s => s.strain) : undefined
      });
      closeDryWeightForm(archiveId);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка сохранения');
    } finally {
      setDryWeightSaving(prev => ({ ...prev, [archiveId]: false }));
    }
  };

  // ─── Popcorn form ───
  const openPopcornForm = (a) => {
    const sd = Array.isArray(a.strainData) && a.strainData.length
      ? a.strainData.map(s => ({ strain: s.strain || '', popcornWeight: s.popcornWeight ?? 0 }))
      : [{ strain: a.strain || '', popcornWeight: a.harvestData?.popcornWeight ?? 0 }];
    setPopcornForms(prev => ({ ...prev, [a._id]: sd }));
    setPopcornOpen(prev => ({ ...prev, [a._id]: true }));
  };

  const handleSavePopcorn = async (archiveId) => {
    const rows = popcornForms[archiveId];
    if (!rows) return;
    setPopcornSaving(prev => ({ ...prev, [archiveId]: true }));
    try {
      const archive = archives.find(a => a._id === archiveId);
      const existingSD = Array.isArray(archive?.strainData) ? archive.strainData : [];
      const strainData = rows.map(r => {
        const existing = existingSD.find(s => s.strain === r.strain);
        return {
          strain: String(r.strain || '').trim(),
          wetWeight: existing?.wetWeight || 0,
          dryWeight: existing?.dryWeight || 0,
          popcornWeight: Number(r.popcornWeight) || 0
        };
      }).filter(s => s.strain !== '');
      const dryTotal = strainData.reduce((sum, s) => sum + s.dryWeight, 0);
      const popcornTotal = strainData.reduce((sum, s) => sum + s.popcornWeight, 0);
      await trimService.updateArchive(archiveId, {
        dryWeight: dryTotal,
        popcornWeight: popcornTotal,
        strainData: strainData.length ? strainData : undefined
      });
      setPopcornOpen(prev => ({ ...prev, [archiveId]: false }));
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка сохранения');
    } finally {
      setPopcornSaving(prev => ({ ...prev, [archiveId]: false }));
    }
  };

  // ─── Inline log submit ───
  const handleInlineLog = async (archiveId) => {
    const weight = Number(inlineWeights[archiveId]);
    if (!weight || weight <= 0) return;

    const archive = archives.find(a => a._id === archiveId);
    const strainsList = (archive?.strains?.length) ? archive.strains : [archive?.strain || ''];
    const strain = strainsList.length === 1 ? null : (inlineStrains[archiveId] || '');

    if (strainsList.length > 1 && !strain) {
      setError('Выберите сорт');
      return;
    }

    setInlineSaving(prev => ({ ...prev, [archiveId]: true }));
    try {
      await trimService.addLog(archiveId, strain, weight, new Date().toISOString().slice(0, 10));
      setInlineWeights(prev => ({ ...prev, [archiveId]: '' }));
      await load();
      if (expandedLogs[archiveId]) {
        const data = await trimService.getLogs(archiveId);
        setArchiveLogs(prev => ({ ...prev, [archiveId]: Array.isArray(data) ? data : [] }));
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка сохранения');
    } finally {
      setInlineSaving(prev => ({ ...prev, [archiveId]: false }));
    }
  };

  // ─── Accordion logs toggle ───
  const toggleLogs = async (archiveId) => {
    const isOpen = !!expandedLogs[archiveId];
    setExpandedLogs(prev => ({ ...prev, [archiveId]: !isOpen }));

    if (!isOpen && !archiveLogs[archiveId]) {
      setArchiveLogsLoading(prev => ({ ...prev, [archiveId]: true }));
      try {
        const data = await trimService.getLogs(archiveId);
        setArchiveLogs(prev => ({ ...prev, [archiveId]: Array.isArray(data) ? data : [] }));
      } catch {
        setArchiveLogs(prev => ({ ...prev, [archiveId]: [] }));
      } finally {
        setArchiveLogsLoading(prev => ({ ...prev, [archiveId]: false }));
      }
    }
  };

  // ─── Delete log ───
  const handleDeleteLog = async (logId, archiveId) => {
    if (!confirm('Удалить запись трима?')) return;
    try {
      await trimService.deleteLog(logId);
      await load();
      if (expandedLogs[archiveId]) {
        const data = await trimService.getLogs(archiveId);
        setArchiveLogs(prev => ({ ...prev, [archiveId]: Array.isArray(data) ? data : [] }));
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка удаления');
    }
  };

  // ─── Complete trim ───
  const handleCompleteTrim = async (archiveId) => {
    if (!confirm('Завершить трим? Архив уйдёт из списка «В работе».')) return;
    try {
      await trimService.completeTrim(archiveId);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка');
    }
  };

  // ─── Edit modal ───
  const openEditModal = (archiveId) => {
    const arch = archives.find(a => a._id === archiveId);
    if (!arch) return;
    setEditModal(archiveId);
    setEditStrainData(
      Array.isArray(arch.strainData) && arch.strainData.length
        ? arch.strainData.map(s => ({ strain: s.strain || '', wetWeight: s.wetWeight ?? 0, dryWeight: s.dryWeight ?? 0, popcornWeight: s.popcornWeight ?? 0 }))
        : [{ strain: arch.strain || '', wetWeight: arch.harvestData?.wetWeight ?? 0, dryWeight: arch.harvestData?.dryWeight ?? 0, popcornWeight: arch.harvestData?.popcornWeight ?? 0 }]
    );
  };

  const handleSaveStrainData = async () => {
    if (!editModal) return;
    setEditSaving(true);
    try {
      const strainData = editStrainData
        .map(s => ({ strain: String(s.strain || '').trim(), wetWeight: Number(s.wetWeight) || 0, dryWeight: Number(s.dryWeight) || 0, popcornWeight: Number(s.popcornWeight) || 0 }))
        .filter(s => s.strain !== '');
      const dryTotal = strainData.reduce((sum, s) => sum + s.dryWeight, 0);
      const popcornTotal = strainData.reduce((sum, s) => sum + s.popcornWeight, 0);
      await trimService.updateArchive(editModal, {
        dryWeight: dryTotal,
        popcornWeight: popcornTotal,
        strainData: strainData.length ? strainData : undefined,
        strains: strainData.length ? strainData.map(s => s.strain) : undefined
      });
      setEditModal(null);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка сохранения');
    } finally {
      setEditSaving(false);
    }
  };

  // ─── Render ───
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500" />
      </div>
    );
  }

  const tabs = [
    { key: 'active', label: 'В работе' },
    { key: 'completed', label: 'Завершённые' },
    { key: 'all', label: 'Все' }
  ];

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Трим</h1>
        <p className="text-dark-400 mt-1 text-sm">Сушка &rarr; Сухой вес &rarr; Ручной трим &rarr; Сортировка</p>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-800 text-red-400 px-4 py-3 rounded-lg mb-4 flex items-center gap-3">
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError('')} className="text-red-300 hover:text-white text-lg leading-none">&times;</button>
        </div>
      )}

      {/* Chart toggle */}
      <button
        type="button"
        onClick={() => setChartOpen(o => !o)}
        className="mb-4 px-4 py-2 bg-dark-800 border border-dark-700 rounded-lg text-dark-300 hover:text-white hover:border-dark-500 transition text-sm font-medium flex items-center gap-2"
      >
        <span className={`transition-transform ${chartOpen ? 'rotate-180' : ''}`}>&#9662;</span>
        <span>Статистика по дням</span>
      </button>

      {chartOpen && (
        <div className="mb-6 bg-dark-800 rounded-xl border border-dark-700 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h2 className="text-sm font-semibold text-white">Трим по дням</h2>
            <select
              value={statsDays}
              onChange={(e) => {
                const d = Number(e.target.value);
                setStatsDays(d);
                trimService.getDailyStats(d).then(data => setDailyStats(Array.isArray(data) ? data : [])).catch(() => {});
              }}
              className="px-3 py-1.5 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
            >
              <option value={7}>7 дней</option>
              <option value={30}>30 дней</option>
              <option value={90}>90 дней</option>
            </select>
          </div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dailyStats.map(d => ({ ...d, day: new Date(d.date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) }))} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="day" tick={{ fill: '#9ca3af', fontSize: 11 }} stroke="#6b7280" />
                <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} stroke="#6b7280" unit=" г" />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #4b5563', borderRadius: '8px' }}
                  labelStyle={{ color: '#d1d5db' }}
                  formatter={(value) => [`${Number(value).toFixed(0)} г`, 'Потримлено']}
                  labelFormatter={(_, payload) => payload[0]?.payload?.date ? formatDate(payload[0].payload.date) : ''}
                />
                <Bar dataKey="weight" fill="#22c55e" radius={[4, 4, 0, 0]} name="Потримлено" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-2 mb-5">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setStatusFilter(t.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
              statusFilter === t.key
                ? 'bg-primary-600 text-white'
                : 'bg-dark-800 text-dark-400 hover:bg-dark-700 hover:text-dark-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Empty state */}
      {archives.length === 0 && (
        <div className="bg-dark-800 rounded-xl border border-dark-700 p-8 text-center text-dark-400">
          {statusFilter === 'active'
            ? 'Нет архивов в работе. Трим появится после сбора урожая.'
            : statusFilter === 'completed'
              ? 'Нет завершённых тримов.'
              : 'Нет архивов.'}
        </div>
      )}

      {/* Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {archives.map(a => {
          const phase = derivePhase(a);
          const m = calcMetrics(a);
          const strainsList = (a.strains?.length) ? a.strains : [a.strain || ''];
          const isMultiStrain = strainsList.length > 1;
          const isSaving = !!inlineSaving[a._id];
          const isCompleted = phase === 'completed';
          const logsOpen = !!expandedLogs[a._id];
          const cardLogs = archiveLogs[a._id] || [];
          const cardLogsLoading = !!archiveLogsLoading[a._id];

          const hasDryForm = !!dryWeightForms[a._id];
          const hasPopcornForm = !!popcornOpen[a._id];

          const currentPhaseIdx = phaseIndex(phase);

          // Per-strain data for tables
          const sd = Array.isArray(a.strainData) && a.strainData.length
            ? a.strainData
            : [{ strain: a.strain || '', wetWeight: m.wet, dryWeight: m.dry, popcornWeight: m.popcorn }];

          return (
            <div key={a._id} className="bg-dark-800 rounded-xl border border-dark-700 overflow-hidden">
              {/* ── Card Header ── */}
              <div className="px-5 pt-4 pb-2 flex items-start justify-between">
                <div className="min-w-0">
                  <h3 className="text-white font-semibold truncate">{a.roomName}</h3>
                  <p className="text-dark-400 text-xs truncate">
                    {strainsList.join(' / ')} &middot; {a.plantsCount || '?'} кустов
                    {a.harvestDate && <span className="text-dark-500"> &middot; Сбор {formatDate(a.harvestDate)}</span>}
                  </p>
                </div>
                <span className={`px-2 py-0.5 rounded text-xs font-medium shrink-0 ml-2 ${
                  phase === 'completed' ? 'bg-green-900/40 text-green-400'
                    : phase === 'trimming' ? 'bg-amber-900/40 text-amber-400'
                    : phase === 'drying' ? 'bg-dark-700 text-dark-400'
                    : 'bg-blue-900/40 text-blue-400'
                }`}>
                  {PHASES.find(p => p.key === phase)?.label || ''}
                </span>
              </div>

              {/* ── Phase Stepper ── */}
              <div className="px-5 pb-3">
                <div className="flex items-center gap-1">
                  {PHASES.map((p, i) => {
                    const done = i < currentPhaseIdx;
                    const active = i === currentPhaseIdx;
                    return (
                      <div key={p.key} className="flex items-center gap-1 flex-1 min-w-0">
                        <div className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium truncate ${
                          done ? 'bg-green-900/30 text-green-400'
                            : active ? 'bg-primary-900/40 text-primary-400 ring-1 ring-primary-500/50'
                            : 'bg-dark-700/50 text-dark-500'
                        }`}>
                          <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                            done ? 'bg-green-500 text-white' : active ? 'bg-primary-500 text-white' : 'bg-dark-600 text-dark-400'
                          }`}>
                            {done ? '✓' : i + 1}
                          </span>
                          <span className="hidden sm:inline truncate">{p.label}</span>
                        </div>
                        {i < PHASES.length - 1 && (
                          <div className={`h-px flex-1 min-w-2 ${done ? 'bg-green-500/50' : 'bg-dark-600'}`} />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="px-5 pb-4 space-y-3">

                {/* ════════════════════════════════════════════ */}
                {/* Phase 1: Сушка — show wet weights, button to enter dry */}
                {/* ════════════════════════════════════════════ */}
                {phase === 'drying' && !hasDryForm && (
                  <div className="space-y-2">
                    <p className="text-dark-400 text-sm">Кусты сушатся. Мокрый вес по сортам:</p>
                    <div className="flex flex-wrap gap-2">
                      {sd.map((s, i) => (
                        <div key={i} className="bg-dark-700/60 rounded-lg px-3 py-2 text-sm">
                          <span className="text-dark-400">{s.strain}: </span>
                          <span className="text-cyan-400 font-medium">{s.wetWeight > 0 ? `${fmt(s.wetWeight, 0)}г` : '—'}</span>
                        </div>
                      ))}
                    </div>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => openDryWeightForm(a)}
                        className="mt-1 px-4 py-2 bg-blue-600/80 text-white rounded-lg text-sm font-medium hover:bg-blue-500 transition"
                      >
                        Внести сухой вес
                      </button>
                    )}
                  </div>
                )}

                {/* ════════════════════════════════════════════ */}
                {/* Phase 1→2: Dry weight inline form */}
                {/* ════════════════════════════════════════════ */}
                {hasDryForm && (
                  <div className="space-y-2 bg-dark-900/50 rounded-lg p-3 border border-dark-600">
                    <p className="text-sm text-white font-medium">Сухой вес по сортам (после претрима в машине)</p>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-dark-500 text-xs">
                          <th className="text-left py-1 pr-2">Сорт</th>
                          <th className="text-right py-1 px-1 w-24">Мокрый</th>
                          <th className="text-right py-1 px-1 w-24">Сухой</th>
                          <th className="text-right py-1 pl-1 w-20">Усушка</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dryWeightForms[a._id].map((row, i) => {
                          const shrink = row.wetWeight > 0 && Number(row.dryWeight) > 0
                            ? ((row.wetWeight - Number(row.dryWeight)) / row.wetWeight * 100) : null;
                          return (
                            <tr key={i}>
                              <td className="py-1 pr-2 text-dark-300">{row.strain}</td>
                              <td className="py-1 px-1 text-right text-cyan-400">{row.wetWeight > 0 ? `${fmt(row.wetWeight, 0)}г` : '—'}</td>
                              <td className="py-1 px-1">
                                <input
                                  type="number" min="0"
                                  value={row.dryWeight || ''}
                                  placeholder="0"
                                  onChange={e => setDryWeightForms(prev => ({
                                    ...prev,
                                    [a._id]: prev[a._id].map((r, j) => j === i ? { ...r, dryWeight: e.target.value } : r)
                                  }))}
                                  className="w-full px-2 py-1.5 bg-dark-700 border border-dark-600 rounded text-white text-sm text-right"
                                />
                              </td>
                              <td className="py-1 pl-2 text-right text-xs">
                                {shrink != null
                                  ? <span className="text-red-400">{fmt(shrink, 0)}%</span>
                                  : <span className="text-dark-500">—</span>
                                }
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <div className="flex gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => closeDryWeightForm(a._id)}
                        className="px-3 py-1.5 text-dark-400 hover:text-white text-sm rounded"
                      >
                        Отмена
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSaveDryWeight(a._id)}
                        disabled={!!dryWeightSaving[a._id]}
                        className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-500 disabled:opacity-50 ml-auto"
                      >
                        {dryWeightSaving[a._id] ? 'Сохранение...' : 'Сохранить сухой вес'}
                      </button>
                    </div>
                  </div>
                )}

                {/* ════════════════════════════════════════════ */}
                {/* Phase 3: Trimming — log form, progress, strain table, popcorn */}
                {/* ════════════════════════════════════════════ */}
                {phase === 'trimming' && (
                  <>
                    {/* Progress bar */}
                    {m.dry > 0 && (
                      <div>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-dark-400">Потримлено</span>
                          <span className="text-dark-300">
                            <span className="text-green-400 font-medium">{fmt(m.trim, 0)}г</span>
                            <span className="text-dark-500"> / {fmt(m.dry, 0)}г</span>
                            <span className={`ml-2 font-medium ${m.trimProgress >= 80 ? 'text-green-400' : m.trimProgress >= 50 ? 'text-amber-400' : 'text-dark-300'}`}>
                              {m.trimProgress}%
                            </span>
                          </span>
                        </div>
                        <div className="h-2.5 bg-dark-700 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full transition-all ${progressColor(m.trimProgress)}`} style={{ width: `${m.trimProgress}%` }} />
                        </div>
                      </div>
                    )}

                    {/* Per-strain breakdown table */}
                    {sd.length > 0 && m.dry > 0 && (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-dark-500">
                              <th className="text-left py-1 pr-1">Сорт</th>
                              <th className="text-right py-1 px-1">Сухой</th>
                              <th className="text-right py-1 px-1">Потримлено</th>
                              <th className="text-right py-1 px-1">Попкорн</th>
                              <th className="text-right py-1 pl-1">Остаток</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sd.map((s, i) => {
                              const sTrim = a.trimByStrain?.[s.strain] || 0;
                              const sRemain = (s.dryWeight || 0) - sTrim - (s.popcornWeight || 0);
                              return (
                                <tr key={i} className="border-t border-dark-700/50">
                                  <td className="py-1 pr-1 text-dark-300">{s.strain}</td>
                                  <td className="py-1 px-1 text-right text-blue-400">{s.dryWeight > 0 ? `${fmt(s.dryWeight, 0)}г` : '—'}</td>
                                  <td className="py-1 px-1 text-right text-green-400">{sTrim > 0 ? `${fmt(sTrim, 0)}г` : '—'}</td>
                                  <td className="py-1 px-1 text-right text-amber-400">{(s.popcornWeight || 0) > 0 ? `${fmt(s.popcornWeight, 0)}г` : '—'}</td>
                                  <td className="py-1 pl-1 text-right">
                                    {s.dryWeight > 0
                                      ? <span className={sRemain > 0 ? 'text-dark-300' : 'text-red-400'}>{fmt(sRemain, 0)}г</span>
                                      : <span className="text-dark-500">—</span>
                                    }
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* Inline log form */}
                    {canCreate && (
                      <div className="flex items-center gap-2">
                        {isMultiStrain && (
                          <select
                            value={inlineStrains[a._id] || ''}
                            onChange={e => setInlineStrains(prev => ({ ...prev, [a._id]: e.target.value }))}
                            className="px-2 py-1.5 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm min-w-0 flex-shrink"
                          >
                            <option value="">Сорт</option>
                            {strainsList.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        )}
                        <input
                          type="number"
                          min="1"
                          placeholder="Вес (г)"
                          value={inlineWeights[a._id] || ''}
                          onChange={e => setInlineWeights(prev => ({ ...prev, [a._id]: e.target.value }))}
                          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleInlineLog(a._id); } }}
                          className="w-24 px-3 py-1.5 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                        />
                        <button
                          type="button"
                          disabled={isSaving || !inlineWeights[a._id]}
                          onClick={() => handleInlineLog(a._id)}
                          className="px-3 py-1.5 bg-green-600/80 text-white rounded-lg hover:bg-green-500 disabled:opacity-40 text-sm font-medium whitespace-nowrap"
                        >
                          {isSaving ? '...' : 'Записать'}
                        </button>
                      </div>
                    )}

                    {/* Recent logs inline */}
                    {a.recentLogs?.length > 0 && (
                      <div className="text-xs text-dark-400 flex flex-wrap gap-x-3 gap-y-0.5">
                        {a.recentLogs.map((log, i) => (
                          <span key={i}>
                            {formatLogDate(log.date)}: <span className="text-dark-300">{fmt(log.weight, 0)}г</span>
                            {isMultiStrain && log.strain && <span className="text-dark-500"> ({log.strain})</span>}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Popcorn entry */}
                    {canEdit && !hasPopcornForm && (
                      <button
                        type="button"
                        onClick={() => openPopcornForm(a)}
                        className="text-xs text-amber-400 hover:text-amber-300"
                      >
                        + Внести попкорн
                      </button>
                    )}
                    {hasPopcornForm && popcornForms[a._id] && (
                      <div className="bg-dark-900/50 rounded-lg p-3 border border-dark-600 space-y-2">
                        <p className="text-xs text-white font-medium">Попкорн по сортам</p>
                        {popcornForms[a._id].map((row, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <span className="text-xs text-dark-400 w-20 truncate">{row.strain}</span>
                            <input
                              type="number" min="0"
                              value={row.popcornWeight || ''}
                              placeholder="0"
                              onChange={e => setPopcornForms(prev => ({
                                ...prev,
                                [a._id]: prev[a._id].map((r, j) => j === i ? { ...r, popcornWeight: e.target.value } : r)
                              }))}
                              className="w-24 px-2 py-1 bg-dark-700 border border-dark-600 rounded text-white text-sm text-right"
                            />
                            <span className="text-xs text-dark-500">г</span>
                          </div>
                        ))}
                        <div className="flex gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => setPopcornOpen(prev => ({ ...prev, [a._id]: false }))}
                            className="px-3 py-1 text-dark-400 hover:text-white text-xs rounded"
                          >
                            Отмена
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSavePopcorn(a._id)}
                            disabled={!!popcornSaving[a._id]}
                            className="px-3 py-1 bg-amber-600/80 text-white rounded text-xs font-medium hover:bg-amber-500 disabled:opacity-50 ml-auto"
                          >
                            {popcornSaving[a._id] ? '...' : 'Сохранить попкорн'}
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* ════════════════════════════════════════════ */}
                {/* Phase 4: Completed — summary table */}
                {/* ════════════════════════════════════════════ */}
                {phase === 'completed' && (
                  <div className="space-y-3">
                    {/* Summary table */}
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-dark-500">
                            <th className="text-left py-1 pr-1">Сорт</th>
                            <th className="text-right py-1 px-1">Мокрый</th>
                            <th className="text-right py-1 px-1">Сухой</th>
                            <th className="text-right py-1 px-1">Потримлено</th>
                            <th className="text-right py-1 px-1">Попкорн</th>
                            <th className="text-right py-1 pl-1">Потеря</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sd.map((s, i) => {
                            const sTrim = a.trimByStrain?.[s.strain] || 0;
                            const sYield = sTrim + (s.popcornWeight || 0);
                            const sLoss = (s.dryWeight || 0) > 0 ? (((s.dryWeight || 0) - sYield) / (s.dryWeight || 1) * 100) : null;
                            return (
                              <tr key={i} className="border-t border-dark-700/50">
                                <td className="py-1 pr-1 text-dark-300 font-medium">{s.strain}</td>
                                <td className="py-1 px-1 text-right text-cyan-400">{s.wetWeight > 0 ? `${fmt(s.wetWeight, 0)}г` : '—'}</td>
                                <td className="py-1 px-1 text-right text-blue-400">{s.dryWeight > 0 ? `${fmt(s.dryWeight, 0)}г` : '—'}</td>
                                <td className="py-1 px-1 text-right text-green-400">{sTrim > 0 ? `${fmt(sTrim, 0)}г` : '—'}</td>
                                <td className="py-1 px-1 text-right text-amber-400">{(s.popcornWeight || 0) > 0 ? `${fmt(s.popcornWeight, 0)}г` : '—'}</td>
                                <td className="py-1 pl-1 text-right">
                                  {sLoss != null ? <span className="text-red-400">{fmt(sLoss, 1)}%</span> : '—'}
                                </td>
                              </tr>
                            );
                          })}
                          {/* Totals row */}
                          {sd.length > 1 && (
                            <tr className="border-t border-dark-600 font-medium">
                              <td className="py-1 pr-1 text-dark-200">Итого</td>
                              <td className="py-1 px-1 text-right text-cyan-400">{m.wet > 0 ? `${fmt(m.wet, 0)}г` : '—'}</td>
                              <td className="py-1 px-1 text-right text-blue-400">{m.dry > 0 ? `${fmt(m.dry, 0)}г` : '—'}</td>
                              <td className="py-1 px-1 text-right text-green-400">{m.trim > 0 ? `${fmt(m.trim, 0)}г` : '—'}</td>
                              <td className="py-1 px-1 text-right text-amber-400">{m.popcorn > 0 ? `${fmt(m.popcorn, 0)}г` : '—'}</td>
                              <td className="py-1 pl-1 text-right">
                                {m.trimLoss != null ? <span className="text-red-400">{fmt(m.trimLoss, 1)}%</span> : '—'}
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* ════════════════════════════════════════════ */}
                {/* Metrics bar (always visible if there's data) */}
                {/* ════════════════════════════════════════════ */}
                {(m.wet > 0 || m.dry > 0 || m.trim > 0) && (
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs pt-2 border-t border-dark-700/50">
                    {m.wet > 0 && (
                      <span><span className="text-dark-500">Мокрый: </span><span className="text-cyan-400">{fmt(m.wet, 0)}г</span></span>
                    )}
                    {m.dry > 0 && (
                      <span><span className="text-dark-500">Сухой: </span><span className="text-blue-400">{fmt(m.dry, 0)}г</span></span>
                    )}
                    {m.trim > 0 && (
                      <span><span className="text-dark-500">Потримлено: </span><span className="text-green-400">{fmt(m.trim, 0)}г</span></span>
                    )}
                    {m.popcorn > 0 && (
                      <span><span className="text-dark-500">Попкорн: </span><span className="text-amber-400">{fmt(m.popcorn, 0)}г</span></span>
                    )}
                    {m.shrinkage != null && (
                      <span><span className="text-dark-500">Усушка: </span><span className="text-red-400">{fmt(m.shrinkage, 0)}%</span></span>
                    )}
                    {m.trimLoss != null && (
                      <span><span className="text-dark-500">Потеря: </span><span className="text-red-400">{fmt(m.trimLoss, 1)}%</span></span>
                    )}
                  </div>
                )}

                {/* ════════════════════════════════════════════ */}
                {/* Action buttons */}
                {/* ════════════════════════════════════════════ */}
                <div className="flex items-center gap-2 pt-1 border-t border-dark-700">
                  {(m.trim > 0 || isCompleted) && (
                    <button
                      type="button"
                      onClick={() => toggleLogs(a._id)}
                      className="px-3 py-1.5 text-dark-400 hover:text-white hover:bg-dark-700 rounded text-xs font-medium transition"
                    >
                      {logsOpen ? 'Свернуть ▴' : 'Все записи ▸'}
                    </button>
                  )}
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => openEditModal(a._id)}
                      className="px-2 py-1.5 text-dark-400 hover:text-white hover:bg-dark-700 rounded text-xs transition"
                      title="Редактировать данные по сортам"
                    >
                      &#9881;
                    </button>
                  )}
                  {canEdit && !isCompleted && phase === 'trimming' && (
                    <button
                      type="button"
                      onClick={() => handleCompleteTrim(a._id)}
                      className="px-3 py-1.5 bg-green-600/80 text-white rounded text-xs hover:bg-green-500 ml-auto font-medium"
                    >
                      &#10003; Завершить
                    </button>
                  )}
                </div>

                {/* ════════════════════════════════════════════ */}
                {/* Accordion: full logs table */}
                {/* ════════════════════════════════════════════ */}
                {logsOpen && (
                  <div className="bg-dark-900 rounded-lg overflow-hidden">
                    {cardLogsLoading ? (
                      <div className="text-center text-dark-500 py-4 text-sm">Загрузка...</div>
                    ) : cardLogs.length === 0 ? (
                      <div className="text-center text-dark-500 py-4 text-sm">Нет записей</div>
                    ) : (
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-dark-400 text-xs uppercase">
                            <th className="px-3 py-2 text-left">Дата</th>
                            <th className="px-3 py-2 text-left">Сорт</th>
                            <th className="px-3 py-2 text-right">Вес</th>
                            {canEdit && <th className="px-3 py-2 w-8" />}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-dark-700">
                          {cardLogs.map(log => (
                            <tr key={log._id} className="hover:bg-dark-800/50">
                              <td className="px-3 py-1.5 text-dark-300">{formatDate(log.date)}</td>
                              <td className="px-3 py-1.5 text-dark-300">{log.strain || '—'}</td>
                              <td className="px-3 py-1.5 text-right text-white font-medium">{log.weight}г</td>
                              {canEdit && (
                                <td className="px-3 py-1.5 text-right">
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteLog(log._id, a._id)}
                                    className="text-red-400 hover:text-red-300 text-xs"
                                  >
                                    &times;
                                  </button>
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ─── Edit Strain Data Modal ─── */}
      {editModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={() => setEditModal(null)}>
          <div
            className="bg-dark-800 rounded-xl border border-dark-600 shadow-xl w-full max-w-lg max-h-[80vh] overflow-y-auto p-6"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">Данные по сортам</h3>
              <button type="button" onClick={() => setEditModal(null)} className="text-dark-400 hover:text-white text-xl">&times;</button>
            </div>

            <div className="overflow-x-auto mb-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-dark-500 text-xs">
                    <th className="text-left py-1 pr-2">Сорт</th>
                    <th className="text-right py-1 px-1 w-20">Мокрый (г)</th>
                    <th className="text-right py-1 px-1 w-20">Сухой (г)</th>
                    <th className="text-right py-1 pl-1 w-20">Попкорн (г)</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {editStrainData.map((s, i) => (
                    <tr key={i}>
                      <td className="py-1 pr-2">
                        <input
                          type="text"
                          value={s.strain}
                          onChange={e => setEditStrainData(prev => prev.map((r, j) => j === i ? { ...r, strain: e.target.value } : r))}
                          placeholder="Сорт"
                          className="w-full px-2 py-1.5 bg-dark-700 border border-dark-600 rounded text-white text-sm"
                        />
                      </td>
                      <td className="py-1 px-1">
                        <input
                          type="number" min="0"
                          value={s.wetWeight}
                          readOnly
                          tabIndex={-1}
                          className="w-full px-2 py-1.5 bg-dark-900 border border-dark-700 rounded text-dark-400 text-sm text-right cursor-default"
                          title="Мокрый вес берётся из данных харвеста"
                        />
                      </td>
                      <td className="py-1 px-1">
                        <input
                          type="number" min="0"
                          value={s.dryWeight}
                          onChange={e => setEditStrainData(prev => prev.map((r, j) => j === i ? { ...r, dryWeight: e.target.value } : r))}
                          className="w-full px-2 py-1.5 bg-dark-700 border border-dark-600 rounded text-white text-sm text-right"
                        />
                      </td>
                      <td className="py-1 pl-1">
                        <input
                          type="number" min="0"
                          value={s.popcornWeight}
                          onChange={e => setEditStrainData(prev => prev.map((r, j) => j === i ? { ...r, popcornWeight: e.target.value } : r))}
                          className="w-full px-2 py-1.5 bg-dark-700 border border-dark-600 rounded text-white text-sm text-right"
                        />
                      </td>
                      <td className="py-1 pl-1">
                        <button
                          type="button"
                          onClick={() => setEditStrainData(prev => prev.filter((_, j) => j !== i))}
                          className="text-red-400 hover:text-red-300 text-lg leading-none"
                        >
                          &times;
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <button
              type="button"
              onClick={() => setEditStrainData(prev => [...prev, { strain: '', wetWeight: 0, dryWeight: 0, popcornWeight: 0 }])}
              className="text-xs text-primary-400 hover:text-primary-300 mb-4"
            >
              + Добавить сорт
            </button>

            <div className="flex gap-2 pt-3 border-t border-dark-700">
              <button
                type="button"
                onClick={() => setEditModal(null)}
                className="px-4 py-2 text-dark-400 hover:bg-dark-700 rounded-lg text-sm"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={handleSaveStrainData}
                disabled={editSaving}
                className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-500 disabled:opacity-50 text-sm ml-auto"
              >
                {editSaving ? 'Сохранение...' : 'Сохранить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Trim;
