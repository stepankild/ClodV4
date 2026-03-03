import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { roomService } from '../../services/roomService';
import { archiveService } from '../../services/archiveService';
import { localizeRoomName } from '../../utils/localizeRoomName';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, PieChart, Pie, Cell
} from 'recharts';

const formatDate = (date, locale) => {
  if (!date) return '—';
  return new Date(date).toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const formatNum = (n, locale) => (n != null && Number.isFinite(n) ? Number(n).toLocaleString(locale) : '—');
const roundTo = (n, d = 1) => (n != null && Number.isFinite(n) ? Math.round(n * 10 ** d) / 10 ** d : null);

const DAYS_PER_YEAR = 365;

const COLORS = ['#10b981', '#6366f1', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#14b8a6'];

const ChartTooltipStyle = {
  backgroundColor: '#1e1e2e',
  border: '1px solid #374151',
  borderRadius: '8px',
  color: '#e5e7eb',
  fontSize: '13px'
};

const TREND_ICONS = { up: '↑', down: '↓', stable: '→' };
const TREND_COLORS = { up: 'text-green-400', down: 'text-red-400', stable: 'text-dark-400' };

// ── Expandable detail card for a strain ──
const StrainDetailCard = ({ strain, period, t, locale }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const QUALITY_LABELS = {
    low: t('stats.qualityLow'),
    medium: t('stats.qualityMedium'),
    high: t('stats.qualityHigh'),
    premium: t('stats.qualityPremium')
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    archiveService.getStrainStats(strain, period).then((d) => {
      if (!cancelled) { setData(d); setLoading(false); }
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [strain, period]);

  if (loading) {
    return (
      <div className="px-4 py-6 flex justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500" />
      </div>
    );
  }

  if (!data?.summary) {
    return <div className="px-4 py-4 text-dark-500 text-sm">{t('stats.noDataShort')}</div>;
  }

  const { summary, cycles, byRoom } = data;

  // Chart data — chronological cycles
  const chartData = cycles.map((c, i) => ({
    name: c.roomName ? `${localizeRoomName(c.roomName, t)}` : `#${i + 1}`,
    date: formatDate(c.harvestDate, locale),
    gpp: roundTo(c.gramsPerPlant, 1) || 0,
    dry: Math.round(c.dryWeight || 0),
    days: c.actualDays || 0
  }));

  return (
    <div className="px-4 pb-4 space-y-4 bg-dark-850 border-t border-dark-600">
      {/* Mini summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4">
        <div className="bg-dark-800 rounded-lg p-3 border border-dark-700">
          <div className="text-dark-400 text-xs">{t('stats.strainAvgGPerPlant')}</div>
          <div className="text-lg font-bold text-blue-400">{summary.avgGramsPerPlant}</div>
        </div>
        <div className="bg-dark-800 rounded-lg p-3 border border-dark-700">
          <div className="text-dark-400 text-xs">{t('stats.strainAvgHarvestPerCycle')}</div>
          <div className="text-lg font-bold text-green-400">{formatNum(summary.avgDryPerCycle, locale)} {t('common.grams')}</div>
        </div>
        <div className="bg-dark-800 rounded-lg p-3 border border-dark-700">
          <div className="text-dark-400 text-xs">{t('stats.strainTrend')}</div>
          <div className={`text-lg font-bold ${TREND_COLORS[summary.trend]}`}>
            {TREND_ICONS[summary.trend]} {summary.trend === 'up' ? t('stats.trendUp') : summary.trend === 'down' ? t('stats.trendDown') : t('stats.trendStable')}
          </div>
        </div>
        <div className="bg-dark-800 rounded-lg p-3 border border-dark-700">
          <div className="text-dark-400 text-xs">{t('stats.strainAvgDays')}</div>
          <div className="text-lg font-bold text-white">{summary.avgDays}</div>
        </div>
      </div>

      {/* Best / worst cycle */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="bg-green-900/20 border border-green-800/30 rounded-lg p-3">
          <div className="text-green-400 text-xs font-semibold mb-1">{t('stats.bestCycleLabel')}</div>
          <div className="text-white text-sm">
            {localizeRoomName(summary.bestCycle.roomName, t)} — {formatNum(summary.bestCycle.gramsPerPlant, locale)} {t('stats.gPerPlant')}
          </div>
          <div className="text-dark-400 text-xs">{formatDate(summary.bestCycle.harvestDate, locale)} · {formatNum(summary.bestCycle.dryWeight, locale)} {t('common.grams')} {t('archive.dry')}</div>
        </div>
        <div className="bg-red-900/20 border border-red-800/30 rounded-lg p-3">
          <div className="text-red-400 text-xs font-semibold mb-1">{t('stats.worstCycleLabel')}</div>
          <div className="text-white text-sm">
            {localizeRoomName(summary.worstCycle.roomName, t)} — {formatNum(summary.worstCycle.gramsPerPlant, locale)} {t('stats.gPerPlant')}
          </div>
          <div className="text-dark-400 text-xs">{formatDate(summary.worstCycle.harvestDate, locale)} · {formatNum(summary.worstCycle.dryWeight, locale)} {t('common.grams')} {t('archive.dry')}</div>
        </div>
      </div>

      {/* Charts */}
      {chartData.length > 1 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-dark-800 rounded-lg border border-dark-700 p-4">
            <h4 className="text-sm font-semibold text-white mb-3">{t('stats.gPerPlantByCycles')}</h4>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="name" tick={{ fill: '#9ca3af', fontSize: 11 }} />
                <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} />
                <Tooltip contentStyle={ChartTooltipStyle} labelFormatter={(_, payload) => payload?.[0]?.payload?.date || ''} />
                <Line type="monotone" dataKey="gpp" stroke="#6366f1" strokeWidth={2} name={t('stats.gPerPlant')} dot={{ r: 4, fill: '#6366f1' }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="bg-dark-800 rounded-lg border border-dark-700 p-4">
            <h4 className="text-sm font-semibold text-white mb-3">{t('stats.harvestByCycles')}</h4>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="name" tick={{ fill: '#9ca3af', fontSize: 11 }} />
                <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} />
                <Tooltip contentStyle={ChartTooltipStyle} labelFormatter={(_, payload) => payload?.[0]?.payload?.date || ''} formatter={(v) => [`${v} ${t('common.grams')}`, t('stats.dryG')]} />
                <Bar dataKey="dry" fill="#10b981" radius={[4, 4, 0, 0]} name={t('stats.dryG')} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* By room */}
      {byRoom.length > 1 && (
        <div>
          <h4 className="text-sm font-semibold text-white mb-2">{t('stats.byRoomsLabel')}</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {byRoom.map((r) => (
              <div key={r.roomId} className="bg-dark-800 rounded-lg border border-dark-700 p-3 text-sm">
                <div className="font-medium text-white">{localizeRoomName(r.roomName, t)}</div>
                <div className="text-dark-400 text-xs mt-1">
                  {r.cycles} {t('stats.cyclesAbbr')} · {formatNum(r.totalWeight, locale)} {t('common.grams')} · {r.avgGramsPerPlant} {t('stats.gPerPlant')} · {r.avgDays} {t('common.days')}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Cycles table */}
      <div>
        <h4 className="text-sm font-semibold text-white mb-2">{t('stats.allCycles', { count: cycles.length })}</h4>
        <div className="overflow-x-auto rounded-lg border border-dark-700">
          <table className="w-full text-xs">
            <thead className="bg-dark-900">
              <tr>
                <th className="px-3 py-2 text-left text-dark-400">{t('stats.dateCol')}</th>
                <th className="px-3 py-2 text-left text-dark-400">{t('stats.roomTableCol')}</th>
                <th className="px-3 py-2 text-right text-dark-400">{t('stats.plantsCol')}</th>
                <th className="px-3 py-2 text-right text-dark-400">{t('stats.dryGCol')}</th>
                <th className="px-3 py-2 text-right text-dark-400">{t('stats.gPerPlantCol')}</th>
                <th className="px-3 py-2 text-right text-dark-400">{t('stats.gPerWattTableCol')}</th>
                <th className="px-3 py-2 text-right text-dark-400">{t('stats.daysTableCol')}</th>
                <th className="px-3 py-2 text-left text-dark-400">{t('stats.qualityCol')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dark-700">
              {cycles.map((c) => (
                <tr key={c._id} className="hover:bg-dark-700/30">
                  <td className="px-3 py-2 text-dark-300">{formatDate(c.harvestDate, locale)}</td>
                  <td className="px-3 py-2 text-white">{localizeRoomName(c.roomName, t)}</td>
                  <td className="px-3 py-2 text-right text-dark-300">{c.plantsCount}</td>
                  <td className="px-3 py-2 text-right text-green-400">{formatNum(Math.round(c.dryWeight), locale)}</td>
                  <td className="px-3 py-2 text-right text-blue-400">{formatNum(roundTo(c.gramsPerPlant, 1), locale)}</td>
                  <td className="px-3 py-2 text-right text-amber-400">{c.gramsPerWatt > 0 ? roundTo(c.gramsPerWatt, 2) : '—'}</td>
                  <td className="px-3 py-2 text-right text-dark-300">{c.actualDays}</td>
                  <td className="px-3 py-2 text-dark-300">{QUALITY_LABELS[c.quality] || c.quality}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// ── Expandable detail card for a room ──
const RoomDetailCard = ({ roomId, period, t, locale }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const QUALITY_LABELS = {
    low: t('stats.qualityLow'),
    medium: t('stats.qualityMedium'),
    high: t('stats.qualityHigh'),
    premium: t('stats.qualityPremium')
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    archiveService.getRoomStats(roomId, period).then((d) => {
      if (!cancelled) { setData(d); setLoading(false); }
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [roomId, period]);

  if (loading) {
    return (
      <div className="px-4 py-6 flex justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500" />
      </div>
    );
  }

  if (!data?.summary) {
    return <div className="px-4 py-4 text-dark-500 text-sm">{t('stats.noRoomData')}</div>;
  }

  const { summary, cycles, byStrain } = data;

  const chartData = cycles.map((c, i) => ({
    name: c.strain || `#${i + 1}`,
    date: formatDate(c.harvestDate, locale),
    gpp: roundTo(c.gramsPerPlant, 1) || 0,
    dry: Math.round(c.dryWeight || 0),
    days: c.actualDays || 0
  }));

  return (
    <div className="px-4 pb-4 space-y-4 bg-dark-850 border-t border-dark-600">
      {/* Mini summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4">
        <div className="bg-dark-800 rounded-lg p-3 border border-dark-700">
          <div className="text-dark-400 text-xs">{t('stats.strainAvgGPerPlant')}</div>
          <div className="text-lg font-bold text-blue-400">{summary.avgGramsPerPlant}</div>
        </div>
        <div className="bg-dark-800 rounded-lg p-3 border border-dark-700">
          <div className="text-dark-400 text-xs">{t('stats.roomTotalHarvest')}</div>
          <div className="text-lg font-bold text-green-400">{formatNum(Math.round(summary.totalDryWeight), locale)} {t('common.grams')}</div>
        </div>
        <div className="bg-dark-800 rounded-lg p-3 border border-dark-700">
          <div className="text-dark-400 text-xs">{t('stats.strainTrend')}</div>
          <div className={`text-lg font-bold ${TREND_COLORS[summary.trend]}`}>
            {TREND_ICONS[summary.trend]} {summary.trend === 'up' ? t('stats.trendUp') : summary.trend === 'down' ? t('stats.trendDown') : t('stats.trendStable')}
          </div>
        </div>
        <div className="bg-dark-800 rounded-lg p-3 border border-dark-700">
          <div className="text-dark-400 text-xs">{t('stats.strainAvgDays')}</div>
          <div className="text-lg font-bold text-white">{summary.avgDays}</div>
        </div>
      </div>

      {/* Best / worst */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="bg-green-900/20 border border-green-800/30 rounded-lg p-3">
          <div className="text-green-400 text-xs font-semibold mb-1">{t('stats.bestCycleLabel')}</div>
          <div className="text-white text-sm">
            {summary.bestCycle.strain} — {formatNum(summary.bestCycle.gramsPerPlant, locale)} {t('stats.gPerPlant')}
          </div>
          <div className="text-dark-400 text-xs">{formatDate(summary.bestCycle.harvestDate, locale)} · {formatNum(summary.bestCycle.dryWeight, locale)} {t('common.grams')} {t('archive.dry')}</div>
        </div>
        <div className="bg-red-900/20 border border-red-800/30 rounded-lg p-3">
          <div className="text-red-400 text-xs font-semibold mb-1">{t('stats.worstCycleLabel')}</div>
          <div className="text-white text-sm">
            {summary.worstCycle.strain} — {formatNum(summary.worstCycle.gramsPerPlant, locale)} {t('stats.gPerPlant')}
          </div>
          <div className="text-dark-400 text-xs">{formatDate(summary.worstCycle.harvestDate, locale)} · {formatNum(summary.worstCycle.dryWeight, locale)} {t('common.grams')} {t('archive.dry')}</div>
        </div>
      </div>

      {/* Charts */}
      {chartData.length > 1 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-dark-800 rounded-lg border border-dark-700 p-4">
            <h4 className="text-sm font-semibold text-white mb-3">{t('stats.gPerPlantByCycles')}</h4>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="name" tick={{ fill: '#9ca3af', fontSize: 11 }} />
                <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} />
                <Tooltip contentStyle={ChartTooltipStyle} labelFormatter={(_, payload) => payload?.[0]?.payload?.date || ''} />
                <Line type="monotone" dataKey="gpp" stroke="#6366f1" strokeWidth={2} name={t('stats.gPerPlant')} dot={{ r: 4, fill: '#6366f1' }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="bg-dark-800 rounded-lg border border-dark-700 p-4">
            <h4 className="text-sm font-semibold text-white mb-3">{t('stats.harvestByCycles')}</h4>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="name" tick={{ fill: '#9ca3af', fontSize: 11 }} />
                <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} />
                <Tooltip contentStyle={ChartTooltipStyle} labelFormatter={(_, payload) => payload?.[0]?.payload?.date || ''} formatter={(v) => [`${v} ${t('common.grams')}`, t('stats.dryG')]} />
                <Bar dataKey="dry" fill="#10b981" radius={[4, 4, 0, 0]} name={t('stats.dryG')} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* By strain */}
      {byStrain.length > 1 && (
        <div>
          <h4 className="text-sm font-semibold text-white mb-2">{t('stats.byStrainLabel')}</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {byStrain.map((s) => (
              <div key={s.strain} className="bg-dark-800 rounded-lg border border-dark-700 p-3 text-sm">
                <div className="font-medium text-white">{s.strain}</div>
                <div className="text-dark-400 text-xs mt-1">
                  {s.cycles} {t('stats.cyclesAbbr')} · {formatNum(s.totalWeight, locale)} {t('common.grams')} · {s.avgGramsPerPlant} {t('stats.gPerPlant')} · {s.avgDays} {t('common.days')}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Cycles table */}
      <div>
        <h4 className="text-sm font-semibold text-white mb-2">{t('stats.allCycles', { count: cycles.length })}</h4>
        <div className="overflow-x-auto rounded-lg border border-dark-700">
          <table className="w-full text-xs">
            <thead className="bg-dark-900">
              <tr>
                <th className="px-3 py-2 text-left text-dark-400">{t('stats.dateCol')}</th>
                <th className="px-3 py-2 text-left text-dark-400">{t('stats.strainTableCol')}</th>
                <th className="px-3 py-2 text-right text-dark-400">{t('stats.plantsCol')}</th>
                <th className="px-3 py-2 text-right text-dark-400">{t('stats.dryGCol')}</th>
                <th className="px-3 py-2 text-right text-dark-400">{t('stats.gPerPlantCol')}</th>
                <th className="px-3 py-2 text-right text-dark-400">{t('stats.gPerWattTableCol')}</th>
                <th className="px-3 py-2 text-right text-dark-400">{t('stats.daysTableCol')}</th>
                <th className="px-3 py-2 text-left text-dark-400">{t('stats.qualityCol')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dark-700">
              {cycles.map((c) => (
                <tr key={c._id} className="hover:bg-dark-700/30">
                  <td className="px-3 py-2 text-dark-300">{formatDate(c.harvestDate, locale)}</td>
                  <td className="px-3 py-2 text-white">{c.strain}</td>
                  <td className="px-3 py-2 text-right text-dark-300">{c.plantsCount}</td>
                  <td className="px-3 py-2 text-right text-green-400">{formatNum(Math.round(c.dryWeight), locale)}</td>
                  <td className="px-3 py-2 text-right text-blue-400">{formatNum(roundTo(c.gramsPerPlant, 1), locale)}</td>
                  <td className="px-3 py-2 text-right text-amber-400">{c.gramsPerWatt > 0 ? roundTo(c.gramsPerWatt, 2) : '—'}</td>
                  <td className="px-3 py-2 text-right text-dark-300">{c.actualDays}</td>
                  <td className="px-3 py-2 text-dark-300">{QUALITY_LABELS[c.quality] || c.quality}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// ── Main Statistics page ──
const Statistics = () => {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'en' ? 'en-US' : 'ru-RU';
  const MONTH_NAMES = t('stats.monthNames', { returnObjects: true });
  const QUALITY_LABELS = {
    low: t('stats.qualityLow'),
    medium: t('stats.qualityMedium'),
    high: t('stats.qualityHigh'),
    premium: t('stats.qualityPremium')
  };

  const [rooms, setRooms] = useState([]);
  const [stats, setStats] = useState(null);
  const [period, setPeriod] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedStrain, setExpandedStrain] = useState(null);
  const [expandedRoom, setExpandedRoom] = useState(null);

  useEffect(() => {
    load();
  }, [period]);

  const load = async () => {
    try {
      setLoading(true);
      setError('');
      const [roomsData, statsData] = await Promise.all([
        roomService.getRoomsSummary(),
        archiveService.getStats(period)
      ]);
      setRooms(Array.isArray(roomsData) ? roomsData : []);
      setStats(statsData || null);
    } catch (err) {
      setError(err.response?.data?.message || err.message || t('stats.loadError'));
      console.error(err);
      setRooms([]);
      setStats(null);
    } finally {
      setLoading(false);
    }
  };

  const toggleStrain = useCallback((strainName) => {
    setExpandedStrain((prev) => (prev === strainName ? null : strainName));
  }, []);

  const toggleRoom = useCallback((roomId) => {
    setExpandedRoom((prev) => (prev === roomId ? null : roomId));
  }, []);

  const safeRooms = (Array.isArray(rooms) ? rooms : []).filter((r) => r != null);
  const total = stats?.total || {};
  const byStrain = stats?.byStrain || [];
  const byMonth = stats?.byMonth || [];
  const byRoomId = (stats?.byRoomId || []).reduce((acc, r) => {
    acc[String(r._id)] = r;
    return acc;
  }, {});

  const periodLabel = {
    all: t('stats.periodAll'),
    year: t('stats.periodYear'),
    '6months': t('stats.period6months'),
    '3months': t('stats.period3months')
  };

  const avgCycleDays = total.avgDaysFlowering != null ? Math.round(Number(total.avgDaysFlowering)) : null;
  const cyclesPerYearFarm = avgCycleDays && avgCycleDays > 0 ? (DAYS_PER_YEAR / avgCycleDays) * safeRooms.length : null;
  const avgGpw = roundTo(total.avgGramsPerWatt, 2);
  const avgGpp = roundTo(total.avgGramsPerPlant, 1);
  // Усушка: считаем только по циклам где есть и wet и dry вес
  const shrinkageRatio = total.shrinkageWet > 0 && total.shrinkageDry > 0
    ? roundTo((1 - total.shrinkageDry / total.shrinkageWet) * 100, 1)
    : null;

  // Best strain & room by g/plant
  const bestStrain = byStrain.length > 0
    ? byStrain.reduce((best, s) => (s.avgGramsPerPlant > (best.avgGramsPerPlant || 0) ? s : best), byStrain[0])
    : null;
  const bestRoomEntry = (stats?.byRoomId || []).length > 0
    ? (stats.byRoomId).reduce((best, r) => {
        const gpp = r.avgGramsPerPlant || 0;
        const bestGpp = best.avgGramsPerPlant || 0;
        return gpp > bestGpp ? r : best;
      }, stats.byRoomId[0])
    : null;
  const bestRoomObj = bestRoomEntry ? safeRooms.find((r) => String(r._id) === String(bestRoomEntry._id)) : null;

  // Strain g/plant map for planned harvest estimates
  const strainGppMap = {};
  byStrain.forEach((s) => {
    if (s._id && s.avgGramsPerPlant > 0) strainGppMap[s._id] = s.avgGramsPerPlant;
  });

  // Данные для графика по месяцам
  const monthlyData = byMonth.map((m) => ({
    name: `${MONTH_NAMES[(m._id.month || 1) - 1]} ${String(m._id.year).slice(-2)}`,
    weight: Math.round(m.totalWeight || 0),
    cycles: m.cycles || 0,
    avgGpp: roundTo(m.avgGramsPerPlant, 1) || 0,
    avgGpw: roundTo(m.avgGramsPerWatt, 2) || 0
  }));

  // Данные для pie chart по сортам
  const strainPieData = byStrain.slice(0, 8).map((s) => ({
    name: s._id || '—',
    value: Math.round(s.totalWeight || 0)
  }));

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500" />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">{t('stats.title')}</h1>
          <p className="text-dark-400 mt-1">
            {t('stats.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-dark-500 text-sm">{t('stats.periodLabel')}</span>
          {['all', 'year', '6months', '3months'].map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                period === p
                  ? 'bg-primary-600 text-white'
                  : 'bg-dark-700 text-dark-300 hover:bg-dark-600 hover:text-white'
              }`}
            >
              {periodLabel[p]}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-800 text-red-400 px-4 py-3 rounded-lg mb-6 flex flex-wrap items-center gap-3">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => { setError(''); load(); }}
            className="px-3 py-1.5 bg-red-800/50 hover:bg-red-700/50 rounded-lg text-sm font-medium"
          >
            {t('stats.retry')}
          </button>
        </div>
      )}

      {/* Сводка по ферме — 2 ряда по 4 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
        <div className="bg-dark-800 rounded-xl border border-dark-700 p-4">
          <div className="text-dark-400 text-xs font-medium">{t('stats.totalCycles')}</div>
          <div className="text-2xl font-bold text-white mt-1">{formatNum(total.totalCycles, locale)}</div>
        </div>
        <div className="bg-dark-800 rounded-xl border border-dark-700 p-4">
          <div className="text-dark-400 text-xs font-medium">{t('stats.harvestDry')}</div>
          <div className="text-2xl font-bold text-green-400 mt-1">
            {formatNum(total.totalDryWeight, locale)}<span className="text-sm ml-1">{t('common.grams')}</span>
          </div>
        </div>
        <div className="bg-dark-800 rounded-xl border border-dark-700 p-4">
          <div className="text-dark-400 text-xs font-medium">{t('stats.avgGPerPlant')}</div>
          <div className="text-2xl font-bold text-blue-400 mt-1">
            {avgGpp != null ? avgGpp : '—'}
          </div>
        </div>
        <div className="bg-dark-800 rounded-xl border border-dark-700 p-4">
          <div className="text-dark-400 text-xs font-medium">{t('stats.avgGPerWatt')}</div>
          <div className="text-2xl font-bold text-amber-400 mt-1">
            {avgGpw != null && avgGpw > 0 ? avgGpw : '—'}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
        <div className="bg-dark-800 rounded-xl border border-dark-700 p-4">
          <div className="text-dark-400 text-xs font-medium">{t('stats.harvestWet')}</div>
          <div className="text-2xl font-bold text-teal-400 mt-1">
            {total.totalWetWeight > 0 ? formatNum(total.totalWetWeight, locale) : '—'}<span className="text-sm ml-1">{total.totalWetWeight > 0 ? t('common.grams') : ''}</span>
          </div>
        </div>
        <div className="bg-dark-800 rounded-xl border border-dark-700 p-4">
          <div className="text-dark-400 text-xs font-medium">{t('stats.trimWeight')}</div>
          <div className="text-2xl font-bold text-purple-400 mt-1">
            {total.totalTrimWeight > 0 ? formatNum(total.totalTrimWeight, locale) : '—'}<span className="text-sm ml-1">{total.totalTrimWeight > 0 ? t('common.grams') : ''}</span>
          </div>
          {total.totalTrimEntries > 0 && (
            <p className="text-dark-500 text-xs mt-0.5">{total.totalTrimEntries} {t('stats.trimEntries')}</p>
          )}
        </div>
        <div className="bg-dark-800 rounded-xl border border-dark-700 p-4">
          <div className="text-dark-400 text-xs font-medium">{t('stats.shrinkage')}</div>
          <div className="text-2xl font-bold text-orange-400 mt-1">
            {shrinkageRatio != null ? `${shrinkageRatio}%` : '—'}
          </div>
          {total.shrinkageCycles > 0 && (
            <p className="text-dark-500 text-xs mt-0.5">{t('stats.shrinkageCycles', { count: total.shrinkageCycles })}</p>
          )}
        </div>
        <div className="bg-dark-800 rounded-xl border border-dark-700 p-4">
          <div className="text-dark-400 text-xs font-medium">{t('stats.avgCycle')}</div>
          <div className="text-2xl font-bold text-white mt-1">
            {avgCycleDays != null ? t('stats.avgCycleDays', { days: avgCycleDays }) : '—'}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        <div className="bg-dark-800 rounded-xl border border-dark-700 p-4">
          <div className="text-dark-400 text-xs font-medium">{t('stats.cyclesPerYear', { rooms: safeRooms.length })}</div>
          <div className="text-2xl font-bold text-primary-400 mt-1">
            {cyclesPerYearFarm != null ? t('stats.cyclesPerYearApprox', { count: Math.round(cyclesPerYearFarm) }) : '—'}
          </div>
        </div>
        <div className="bg-dark-800 rounded-xl border border-dark-700 p-4">
          <div className="text-dark-400 text-xs font-medium">{t('stats.totalPlants')}</div>
          <div className="text-2xl font-bold text-white mt-1">
            {total.totalPlants > 0 ? formatNum(total.totalPlants, locale) : '—'}
          </div>
        </div>
        <div className="bg-dark-800 rounded-xl border border-emerald-800/40 p-4">
          <div className="text-dark-400 text-xs font-medium">{t('stats.bestStrainLabel')}</div>
          {bestStrain ? (
            <>
              <div className="text-xl font-bold text-emerald-400 mt-1 truncate" title={bestStrain._id}>
                {bestStrain._id || '—'}
              </div>
              <p className="text-dark-500 text-xs mt-0.5">{roundTo(bestStrain.avgGramsPerPlant, 1)} {t('stats.gPerPlantSuffix')}</p>
            </>
          ) : (
            <div className="text-2xl font-bold text-dark-500 mt-1">—</div>
          )}
        </div>
        <div className="bg-dark-800 rounded-xl border border-indigo-800/40 p-4">
          <div className="text-dark-400 text-xs font-medium">{t('stats.bestRoom')}</div>
          {bestRoomObj && bestRoomEntry ? (
            <>
              <div className="text-xl font-bold text-indigo-400 mt-1 truncate" title={localizeRoomName(bestRoomObj.name, t)}>
                {localizeRoomName(bestRoomObj.name, t)}
              </div>
              <p className="text-dark-500 text-xs mt-0.5">{roundTo(bestRoomEntry.avgGramsPerPlant, 1)} {t('stats.gPerPlantSuffix')}</p>
            </>
          ) : (
            <div className="text-2xl font-bold text-dark-500 mt-1">—</div>
          )}
        </div>
      </div>

      {/* Графики */}
      {monthlyData.length > 1 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Урожай по месяцам */}
          <div className="bg-dark-800 rounded-xl border border-dark-700 p-5">
            <h2 className="text-lg font-semibold text-white mb-4">{t('stats.harvestByMonth')}</h2>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="name" tick={{ fill: '#9ca3af', fontSize: 12 }} />
                <YAxis tick={{ fill: '#9ca3af', fontSize: 12 }} />
                <Tooltip contentStyle={ChartTooltipStyle} formatter={(v) => [`${v} ${t('common.grams')}`, t('stats.dryWeightG')]} />
                <Bar dataKey="weight" fill="#10b981" radius={[4, 4, 0, 0]} name={t('stats.dryWeightG')} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Эффективность по месяцам */}
          <div className="bg-dark-800 rounded-xl border border-dark-700 p-5">
            <h2 className="text-lg font-semibold text-white mb-4">{t('stats.efficiencyByMonth')}</h2>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="name" tick={{ fill: '#9ca3af', fontSize: 12 }} />
                <YAxis yAxisId="left" tick={{ fill: '#9ca3af', fontSize: 12 }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fill: '#9ca3af', fontSize: 12 }} />
                <Tooltip contentStyle={ChartTooltipStyle} />
                <Legend wrapperStyle={{ color: '#9ca3af', fontSize: 12 }} />
                <Line yAxisId="left" type="monotone" dataKey="avgGpp" stroke="#6366f1" strokeWidth={2} name={t('stats.gPerPlant')} dot={{ r: 3 }} />
                <Line yAxisId="right" type="monotone" dataKey="avgGpw" stroke="#f59e0b" strokeWidth={2} name={t('stats.gPerWatt')} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Сорта — таблица на всю ширину */}
      <div className="bg-dark-800 rounded-xl border border-dark-700 overflow-hidden mb-8">
        <h2 className="text-lg font-semibold text-white px-4 py-3 border-b border-dark-700">
          {t('stats.byStrains')}
          {byStrain.length > 0 && (
            <span className="text-dark-500 text-sm font-normal ml-2">{t('stats.clickForDetails')}</span>
          )}
        </h2>
        {byStrain.length === 0 ? (
          <div className="px-4 py-8 text-center text-dark-500">{t('stats.noStrainData')}</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-dark-900">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-dark-400 uppercase">{t('stats.strainCol')}</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-dark-400 uppercase">{t('stats.cyclesCol')}</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-dark-400 uppercase">{t('stats.harvestCol')}</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-dark-400 uppercase">{t('stats.avgCol')}</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-dark-400 uppercase">{t('stats.gPerPlantCol')}</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-dark-400 uppercase">{t('stats.gPerWattCol')}</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-dark-400 uppercase">{t('stats.avgDaysCol')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-dark-700">
                  {byStrain.map((s, i) => {
                    const strainName = s._id || '—';
                    const isExpanded = expandedStrain === strainName;
                    return (
                      <React.Fragment key={strainName}>
                        <tr
                          onClick={() => toggleStrain(strainName)}
                          className={`cursor-pointer transition ${isExpanded ? 'bg-dark-700/50' : 'hover:bg-dark-700/30'}`}
                        >
                          <td className="px-4 py-3 font-medium text-white">
                            <span className="inline-flex items-center gap-2">
                              <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                              {strainName}
                              <span className={`text-dark-500 text-xs transition-transform ${isExpanded ? 'rotate-180' : ''}`}>▼</span>
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right text-dark-300">{s.cycles}</td>
                          <td className="px-4 py-3 text-right text-green-400">{formatNum(Math.round(s.totalWeight), locale)}</td>
                          <td className="px-4 py-3 text-right text-dark-300">{formatNum(roundTo(s.avgWeight, 0), locale)}</td>
                          <td className="px-4 py-3 text-right text-blue-400">{formatNum(roundTo(s.avgGramsPerPlant, 1), locale)}</td>
                          <td className="px-4 py-3 text-right text-amber-400">{s.avgGramsPerWatt > 0 ? formatNum(roundTo(s.avgGramsPerWatt, 2), locale) : '—'}</td>
                          <td className="px-4 py-3 text-right text-dark-300">{s.avgDays != null ? Math.round(s.avgDays) : '—'}</td>
                        </tr>
                        {isExpanded && (
                          <tr>
                            <td colSpan={7} className="p-0">
                              <StrainDetailCard strain={strainName} period={period} t={t} locale={locale} />
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pie chart — под таблицей */}
            {strainPieData.length > 1 && (
              <div className="border-t border-dark-700 p-5">
                <h3 className="text-sm font-semibold text-white mb-3">{t('stats.harvestDistribution')}</h3>
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie
                      data={strainPieData}
                      cx="50%"
                      cy="50%"
                      outerRadius={90}
                      innerRadius={45}
                      paddingAngle={2}
                      dataKey="value"
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                      labelLine={{ stroke: '#6b7280' }}
                    >
                      {strainPieData.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={ChartTooltipStyle} formatter={(v) => [`${v} ${t('common.grams')}`, t('stats.dryG')]} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </>
        )}
      </div>

      {/* По комнатам */}
      <div className="bg-dark-800 rounded-xl border border-dark-700 overflow-hidden mb-8">
        <h2 className="text-lg font-semibold text-white px-4 py-3 border-b border-dark-700">
          {t('stats.byRooms')}
          <span className="text-dark-500 text-sm font-normal ml-2">{t('stats.clickForDetails')}</span>
        </h2>
        <p className="text-dark-400 text-sm px-4 pt-2 pb-3">
          {t('stats.roomsDescription')}
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-dark-900">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-dark-400 uppercase tracking-wider">{t('stats.roomCol')}</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-dark-400 uppercase tracking-wider">{t('stats.cyclesCol')}</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-dark-400 uppercase tracking-wider">{t('stats.harvestGCol')}</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-dark-400 uppercase tracking-wider">{t('stats.gPerPlantCol')}</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-dark-400 uppercase tracking-wider">{t('stats.gPerWattCol')}</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-dark-400 uppercase tracking-wider">{t('stats.avgCycleCol')}</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-dark-400 uppercase tracking-wider">{t('stats.cyclesPerYearCol')}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-dark-400 uppercase tracking-wider">{t('stats.currentCol')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dark-700">
              {safeRooms.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-dark-500">
                    {t('stats.noRooms')}
                  </td>
                </tr>
              ) : (
                safeRooms.map((room) => {
                  const rStat = byRoomId[String(room._id)];
                  const cycles = rStat?.cycles ?? 0;
                  const totalWeight = rStat?.totalWeight ?? 0;
                  const rGpp = rStat?.avgGramsPerPlant != null ? roundTo(rStat.avgGramsPerPlant, 1) : null;
                  const rGpw = rStat?.avgGramsPerWatt != null && rStat.avgGramsPerWatt > 0 ? roundTo(rStat.avgGramsPerWatt, 2) : null;
                  const avgDays = rStat?.avgDays != null ? Math.round(Number(rStat.avgDays)) : null;
                  const cyclesPerYear = avgDays && avgDays > 0 ? DAYS_PER_YEAR / avgDays : null;
                  const isExpanded = expandedRoom === String(room._id);
                  return (
                    <React.Fragment key={room._id}>
                      <tr
                        onClick={() => cycles > 0 && toggleRoom(String(room._id))}
                        className={`transition ${cycles > 0 ? 'cursor-pointer' : ''} ${isExpanded ? 'bg-dark-700/50' : 'hover:bg-dark-700/30'}`}
                      >
                        <td className="px-4 py-3 font-medium text-white">
                          <span className="inline-flex items-center gap-2">
                            {localizeRoomName(room.name, t)}
                            {cycles > 0 && (
                              <span className={`text-dark-500 text-xs transition-transform ${isExpanded ? 'rotate-180' : ''}`}>▼</span>
                            )}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-dark-300">{formatNum(cycles, locale)}</td>
                        <td className="px-4 py-3 text-right text-green-400">{formatNum(totalWeight, locale)}</td>
                        <td className="px-4 py-3 text-right text-blue-400">{rGpp != null ? formatNum(rGpp, locale) : '—'}</td>
                        <td className="px-4 py-3 text-right text-amber-400">{rGpw != null ? formatNum(rGpw, locale) : '—'}</td>
                        <td className="px-4 py-3 text-right text-dark-300">{avgDays != null ? `${avgDays} ${t('common.days')}` : '—'}</td>
                        <td className="px-4 py-3 text-right text-primary-400">
                          {cyclesPerYear != null ? `~${cyclesPerYear.toFixed(1)}` : '—'}
                        </td>
                        <td className="px-4 py-3">
                          {room.isActive ? (
                            <span className="inline-flex items-center gap-1.5 text-primary-400 text-xs">
                              <span className="w-1.5 h-1.5 rounded-full bg-primary-500" />
                              {t('stats.flowering', { date: room.expectedHarvestDate ? formatDate(room.expectedHarvestDate, locale) : '—' })}
                            </span>
                          ) : room.plannedCycle?.plannedStartDate ? (
                            <span className="text-dark-400 text-xs">
                              {t('stats.plannedFrom', { date: formatDate(room.plannedCycle.plannedStartDate, locale) })}
                            </span>
                          ) : (
                            <span className="text-dark-500 text-xs">{t('stats.roomFree')}</span>
                          )}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td colSpan={8} className="p-0">
                            <RoomDetailCard roomId={String(room._id)} period={period} t={t} locale={locale} />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Планируемый урожай (активные комнаты) */}
      <div className="bg-dark-800 rounded-xl border border-dark-700 overflow-hidden mb-8">
        <h2 className="text-lg font-semibold text-white px-4 py-3 border-b border-dark-700">
          {t('stats.plannedHarvest')}
        </h2>
        <p className="text-dark-400 text-sm px-4 pt-2 pb-3">
          {t('stats.plannedHarvestDesc')}
        </p>
        <div className="px-4 pb-4">
          {safeRooms.filter((r) => r.isActive).length === 0 ? (
            <div className="py-6 text-center text-dark-500">{t('stats.noActiveRooms')}</div>
          ) : (
            <div className="space-y-3">
              {safeRooms
                .filter((r) => r.isActive)
                .map((room) => {
                  // Use strain-specific g/plant if available, otherwise fall back to global avg
                  const roomStrains = (room.flowerStrains && room.flowerStrains.length > 0)
                    ? room.flowerStrains : (room.strain ? [{ strain: room.strain, quantity: room.plantsCount }] : []);
                  let estimatedDry = null;
                  let usedStrainGpp = false;
                  if (roomStrains.length > 0 && room.plantsCount > 0) {
                    let sum = 0;
                    let matched = 0;
                    for (const rs of roomStrains) {
                      const qty = rs.quantity || 0;
                      const sGpp = strainGppMap[rs.strain];
                      if (sGpp && qty > 0) {
                        sum += qty * sGpp;
                        matched += qty;
                      }
                    }
                    if (matched > 0) {
                      // For unmatched plants, use global avg
                      const unmatched = room.plantsCount - matched;
                      const globalGpp = total.avgGramsPerPlant != null ? Number(total.avgGramsPerPlant) : 0;
                      sum += unmatched * globalGpp;
                      estimatedDry = Math.round(sum);
                      usedStrainGpp = true;
                    }
                  }
                  if (estimatedDry == null) {
                    const avgGppVal = total.avgGramsPerPlant != null ? Number(total.avgGramsPerPlant) : null;
                    estimatedDry = room.plantsCount && avgGppVal ? Math.round(room.plantsCount * avgGppVal) : null;
                  }
                  return (
                    <div
                      key={room._id}
                      className="flex flex-wrap items-center justify-between gap-3 py-3 border-b border-dark-700 last:border-0"
                    >
                      <div>
                        <div className="font-medium text-white">{localizeRoomName(room.name, t)}</div>
                        {roomStrains.length > 0 && (
                          <div className="text-dark-500 text-xs mt-0.5">
                            {roomStrains.map((rs) => rs.strain).filter(Boolean).join(', ')}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-4 text-sm">
                        <span className="text-dark-400">
                          {t('stats.harvestLabel')} <span className="text-white">{formatDate(room.expectedHarvestDate, locale)}</span>
                        </span>
                        {room.plantsCount > 0 && (
                          <span className="text-dark-400">
                            {t('stats.plantsLabel')} <span className="text-white">{room.plantsCount}</span>
                          </span>
                        )}
                        {estimatedDry != null && (
                          <span className="text-green-400">
                            {t('stats.estimatedDry', { weight: formatNum(estimatedDry, locale) })}
                            {usedStrainGpp && <span className="text-dark-500 ml-1 text-xs">{t('stats.byStrainEst')}</span>}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      </div>

      {/* Links */}
      <div className="flex items-center gap-2 text-sm">
        <Link to="/" className="text-primary-400 hover:text-primary-300 font-medium">
          {t('stats.farmOverview')}
        </Link>
        <span className="text-dark-500">·</span>
        <Link to="/archive" className="text-primary-400 hover:text-primary-300 font-medium">
          {t('stats.cycleArchive')}
        </Link>
      </div>
    </div>
  );
};

export default Statistics;
