import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { archiveService } from '../../services/archiveService';
import { roomService } from '../../services/roomService';
import { localizeRoomName } from '../../utils/localizeRoomName';

const formatDate = (date, locale) => {
  if (!date) return '—';
  return new Date(date).toLocaleDateString(locale === 'en' ? 'en-US' : 'ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
};

const formatNum = (n, locale) => (n != null && Number.isFinite(n) ? Number(n).toLocaleString(locale === 'en' ? 'en-US' : 'ru-RU') : '—');
const formatG = (n, locale) => (n != null && Number.isFinite(n) && n > 0 ? `${Number(n).toLocaleString(locale === 'en' ? 'en-US' : 'ru-RU')}${locale === 'en' ? 'g' : 'г'}` : '—');
const pct = (a, b) => (a > 0 && b > 0 ? ((a / b) * 100).toFixed(1) : null);

/* ── Helpers ── */
const daysBetween = (a, b) => {
  if (!a || !b) return null;
  return Math.max(0, Math.round((new Date(b) - new Date(a)) / 86400000));
};

/* ── Small components ── */
const StatCard = ({ label, value, sub, color = 'text-white' }) => (
  <div className="bg-dark-800 border border-dark-700 rounded-lg px-3 py-2.5">
    <div className="text-dark-500 text-xs truncate">{label}</div>
    <div className={`text-lg font-bold ${color} leading-tight`}>{value}</div>
    {sub && <div className="text-dark-500 text-xs">{sub}</div>}
  </div>
);

const QualityDot = ({ quality }) => {
  const c = { low: 'bg-red-500', medium: 'bg-yellow-500', high: 'bg-green-500', premium: 'bg-purple-500' };
  return <span className={`inline-block w-2 h-2 rounded-full ${c[quality] || 'bg-dark-600'}`} title={quality} />;
};

/* ── Timeline bar for a single archive ── */
const TimelineBar = ({ archive, t, i18n }) => {
  const a = archive;
  const clone = a.cloneData || {};
  const veg = a.vegData || {};
  const lang = i18n.language;
  const MONTH_NAMES = t('archive.monthNames', { returnObjects: true });

  // Collect phase dates
  const cutDate = clone.cutDate ? new Date(clone.cutDate) : null;
  const vegStart = veg.transplantedToVegAt ? new Date(veg.transplantedToVegAt) : null;
  const flowerStart = veg.transplantedToFlowerAt ? new Date(veg.transplantedToFlowerAt) : (a.startDate ? new Date(a.startDate) : null);
  const harvestDate = a.harvestDate ? new Date(a.harvestDate) : null;
  const trimEnd = a.trimCompletedAt ? new Date(a.trimCompletedAt) : (a.lastTrimDate ? new Date(a.lastTrimDate) : null);

  // If no timeline data at all, show just flower period
  const timelineStart = cutDate || vegStart || flowerStart;
  const timelineEnd = trimEnd || harvestDate;

  if (!timelineStart || !timelineEnd) {
    return <span className="text-dark-600 text-xs">—</span>;
  }

  const totalMs = timelineEnd.getTime() - timelineStart.getTime();
  if (totalMs <= 0) return <span className="text-dark-600 text-xs">—</span>;

  const pctOf = (start, end) => {
    if (!start || !end) return { left: 0, width: 0 };
    const l = Math.max(0, (start.getTime() - timelineStart.getTime()) / totalMs * 100);
    const w = Math.max(0, (end.getTime() - start.getTime()) / totalMs * 100);
    return { left: l, width: Math.max(w, 1) };
  };

  // Phases
  const phases = [];

  // Clone/rooting phase
  if (cutDate && (vegStart || flowerStart)) {
    const end = vegStart || flowerStart;
    const d = daysBetween(cutDate, end);
    phases.push({ key: 'clone', ...pctOf(cutDate, end), color: 'bg-purple-500', label: t('archive.phaseClones'), days: d });
  }

  // Veg phase
  if (vegStart && flowerStart) {
    const d = daysBetween(vegStart, flowerStart);
    phases.push({ key: 'veg', ...pctOf(vegStart, flowerStart), color: 'bg-green-500', label: t('archive.phaseVeg'), days: d });
  }

  // Flower phase
  if (flowerStart && harvestDate) {
    const d = daysBetween(flowerStart, harvestDate);
    phases.push({ key: 'flower', ...pctOf(flowerStart, harvestDate), color: 'bg-yellow-500', label: t('archive.phaseFlower'), days: d });
  }

  // Drying + trim (harvest to trim end)
  if (harvestDate && trimEnd && trimEnd > harvestDate) {
    const d = daysBetween(harvestDate, trimEnd);
    phases.push({ key: 'dry', ...pctOf(harvestDate, trimEnd), color: 'bg-orange-500', label: t('archive.phaseDryTrim'), days: d });
  }

  const totalDays = daysBetween(timelineStart, timelineEnd);

  return (
    <div className="w-full">
      {/* Bar */}
      <div className="relative h-4 bg-dark-700 rounded-full overflow-hidden">
        {phases.map((p) => (
          <div
            key={p.key}
            className={`absolute top-0 h-full ${p.color} opacity-80`}
            style={{ left: `${p.left}%`, width: `${p.width}%` }}
            title={t('archive.phaseDaysTitle', { label: p.label, days: p.days || '?' })}
          />
        ))}
      </div>
      {/* Legend */}
      <div className="flex items-center gap-3 mt-1 flex-wrap">
        {phases.map((p) => (
          <span key={p.key} className="flex items-center gap-1 text-[10px] text-dark-400">
            <span className={`w-2 h-2 rounded-sm ${p.color}`} />
            {p.label} {p.days != null ? t('archive.phaseDaysLabel', { days: p.days }) : ''}
          </span>
        ))}
        {totalDays != null && (
          <span className="text-[10px] text-dark-500 ml-auto">{t('archive.totalDays', { days: totalDays })}</span>
        )}
      </div>
    </div>
  );
};

/* ═══════════════════════════════════ */
/*              MAIN PAGE              */
/* ═══════════════════════════════════ */
export default function Archives() {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState({ archives: [], total: 0 });
  const [stats, setStats] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filters
  const [roomId, setRoomId] = useState('');
  const [strain, setStrain] = useState('');
  const [period, setPeriod] = useState('all');
  const [sortBy, setSortBy] = useState('harvestDate');
  const [sortOrder, setSortOrder] = useState('desc');
  const [showStats, setShowStats] = useState(true);
  const [expandedId, setExpandedId] = useState(null);

  const lang = i18n.language;
  const MONTH_NAMES = t('archive.monthNames', { returnObjects: true });

  const load = async () => {
    try {
      setLoading(true);
      setError('');
      const params = { limit: 100 };
      if (roomId) params.roomId = roomId;
      if (strain.trim()) params.strain = strain.trim();
      const res = await archiveService.getArchives(params);
      let archives = Array.isArray(res.archives) ? res.archives : [];

      // Client-side period filtering
      if (period !== 'all') {
        const now = new Date();
        let cutoff;
        if (period === 'year') cutoff = new Date(now.getFullYear(), 0, 1);
        else if (period === '6months') { cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - 6); }
        else if (period === '3months') { cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - 3); }
        else if (period === 'month') { cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - 1); }
        archives = archives.filter(a => new Date(a.harvestDate) >= cutoff);
      }

      // Client-side sorting
      archives.sort((a, b) => {
        let va, vb;
        if (sortBy === 'harvestDate' || sortBy === 'startDate') {
          va = new Date(a[sortBy] || 0).getTime();
          vb = new Date(b[sortBy] || 0).getTime();
        } else if (sortBy === 'dryWeight') {
          va = a.harvestData?.dryWeight || 0;
          vb = b.harvestData?.dryWeight || 0;
        } else if (sortBy === 'gramsPerPlant') {
          va = a.metrics?.gramsPerPlant || 0;
          vb = b.metrics?.gramsPerPlant || 0;
        } else if (sortBy === 'shrinkage') {
          const wa = a.harvestData?.wetWeight || 0, fa = (a.harvestData?.finalWeight || 0) > 0 ? a.harvestData.finalWeight : (a.trimLogWeight || a.harvestData?.trimWeight || 0);
          va = wa > 0 && fa > 0 ? (wa - fa) / wa : 0;
          const wb = b.harvestData?.wetWeight || 0, fb = (b.harvestData?.finalWeight || 0) > 0 ? b.harvestData.finalWeight : (b.trimLogWeight || b.harvestData?.trimWeight || 0);
          vb = wb > 0 && fb > 0 ? (wb - fb) / wb : 0;
        } else {
          va = a[sortBy] || 0;
          vb = b[sortBy] || 0;
        }
        return sortOrder === 'desc' ? vb - va : va - vb;
      });

      setData({ archives, total: archives.length });
    } catch (err) {
      setError(err.response?.data?.message || err.message || t('archive.loadError'));
      setData({ archives: [], total: 0 });
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async () => {
    try {
      const res = await archiveService.getStats(period);
      setStats(res);
    } catch (err) {
      console.error('Stats error:', err);
    }
  };

  useEffect(() => { load(); }, [roomId, strain, period, sortBy, sortOrder]);
  useEffect(() => { loadStats(); }, [period]);
  useEffect(() => {
    roomService.getRooms().then((list) => setRooms(Array.isArray(list) ? list : [])).catch(() => setRooms([]));
  }, []);

  const archives = data.archives;
  const st = stats?.total || {};
  // Усушка: (wet - finalProduct) / wet * 100, где finalProduct = shrinkageFinal (trimWeight + popcornMachine)
  const shrinkagePct = st.shrinkageWet > 0 && st.shrinkageFinal > 0
    ? (((st.shrinkageWet - st.shrinkageFinal) / st.shrinkageWet) * 100).toFixed(1)
    : null;

  return (
    <div className="p-4 sm:p-6 max-w-[1400px] mx-auto">
      {/* ─── Header ─── */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">{t('archive.title')}</h1>
          <p className="text-dark-500 text-xs mt-0.5">{t('archive.completedCycles', { count: data.total })}</p>
        </div>
        <button
          onClick={() => setShowStats(!showStats)}
          className="px-3 py-1.5 bg-dark-800 border border-dark-700 rounded-lg text-dark-400 hover:text-white text-sm transition"
        >
          {showStats ? t('archive.hideStats') : t('archive.showStats')}
        </button>
      </div>

      {/* ─── Stats ─── */}
      {showStats && stats && (
        <div className="mb-5 space-y-4">
          {/* Summary cards */}
          <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-8 gap-2">
            <StatCard label={t('archive.cycles')} value={st.totalCycles || 0} />
            <StatCard label={t('archive.plantsLabel')} value={formatNum(st.totalPlants, lang)} />
            <StatCard label={t('archive.dryWeight')} value={formatG(st.totalDryWeight, lang)} color="text-green-400" />
            <StatCard label={t('archive.wetWeight')} value={formatG(st.totalWetWeight, lang)} color="text-blue-400" />
            <StatCard label={t('archive.avgGPerPlant')} value={formatNum(Math.round(st.avgGramsPerPlant || 0), lang)} color="text-primary-400" />
            <StatCard label={t('archive.avgCycle')} value={t('archive.avgCycleDays', { days: Math.round(st.avgDaysFlowering || 0) })} />
            {shrinkagePct && <StatCard label={t('archive.shrinkage')} value={t('archive.shrinkagePct', { pct: shrinkagePct })} color="text-red-400" />}
            {st.avgGramsPerWatt > 0 && <StatCard label={t('archive.gramsPerWatt')} value={(st.avgGramsPerWatt).toFixed(2)} color="text-amber-400" />}
          </div>

          {/* Top strains */}
          {stats?.byStrain?.length > 0 && (
            <div className="bg-dark-800 rounded-lg border border-dark-700 p-3">
              <div className="text-dark-400 text-xs font-medium mb-2">{t('archive.topStrains')}</div>
              <div className="flex flex-wrap gap-1.5">
                {stats.byStrain.slice(0, 8).map((s, i) => (
                  <button
                    key={i}
                    onClick={() => setStrain(strain === s._id ? '' : (s._id || ''))}
                    className={`px-2.5 py-1.5 rounded-md text-xs transition ${
                      strain === s._id
                        ? 'bg-primary-600/30 border border-primary-500 text-white'
                        : 'bg-dark-700/60 text-dark-300 hover:bg-dark-600/60 hover:text-white'
                    }`}
                  >
                    <span className="font-medium">{s._id || 'N/A'}</span>
                    <span className="text-dark-500 ml-1.5">{formatG(s.totalWeight, lang)} · {s.cycles}{lang === 'en' ? 'c' : 'ц'}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Room + Monthly side by side */}
          {(stats.byRoom?.length > 0 || stats.byMonth?.length > 0) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {stats.byRoom?.length > 0 && (
                <div className="bg-dark-800 rounded-lg border border-dark-700 overflow-hidden">
                  <div className="text-dark-400 text-xs font-medium px-3 py-2 border-b border-dark-700">{t('archive.byRooms')}</div>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-dark-600">
                        <th className="px-3 py-1.5 text-left font-normal">{t('archive.roomCol')}</th>
                        <th className="px-2 py-1.5 text-right font-normal">{t('archive.cyclesCol')}</th>
                        <th className="px-2 py-1.5 text-right font-normal">{t('archive.weightCol')}</th>
                        <th className="px-2 py-1.5 text-right font-normal">{t('archive.avgCol')}</th>
                        <th className="px-2 py-1.5 text-right font-normal">{t('archive.daysCol')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-dark-700/50">
                      {stats.byRoom.map((r, i) => (
                        <tr key={i} className="hover:bg-dark-700/30">
                          <td className="px-3 py-1.5 text-white">{t('archive.roomPrefix', { num: r._id })}</td>
                          <td className="px-2 py-1.5 text-right text-dark-400">{r.cycles}</td>
                          <td className="px-2 py-1.5 text-right text-green-400">{formatG(r.totalWeight, lang)}</td>
                          <td className="px-2 py-1.5 text-right text-dark-300">{formatG(Math.round(r.avgWeight || 0), lang)}</td>
                          <td className="px-2 py-1.5 text-right text-dark-500">{Math.round(r.avgDays || 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {stats.byMonth?.length > 0 && (
                <div className="bg-dark-800 rounded-lg border border-dark-700 overflow-hidden">
                  <div className="text-dark-400 text-xs font-medium px-3 py-2 border-b border-dark-700">{t('archive.byMonths')}</div>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-dark-600">
                        <th className="px-3 py-1.5 text-left font-normal">{t('archive.monthCol')}</th>
                        <th className="px-2 py-1.5 text-right font-normal">{t('archive.cyclesCol')}</th>
                        <th className="px-2 py-1.5 text-right font-normal">{t('archive.weightCol')}</th>
                        <th className="px-2 py-1.5 text-right font-normal">{t('archive.gPerPlantCol')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-dark-700/50">
                      {stats.byMonth.map((m, i) => (
                        <tr key={i} className="hover:bg-dark-700/30">
                          <td className="px-3 py-1.5 text-white">{MONTH_NAMES[(m._id?.month || 1) - 1]} {m._id?.year}</td>
                          <td className="px-2 py-1.5 text-right text-dark-400">{m.cycles}</td>
                          <td className="px-2 py-1.5 text-right text-green-400">{formatG(m.totalWeight, lang)}</td>
                          <td className="px-2 py-1.5 text-right text-primary-400">{formatNum(Math.round(m.avgGramsPerPlant || 0), lang)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ─── Filters ─── */}
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <div>
          <label className="block text-dark-500 text-[10px] mb-0.5">{t('archive.roomFilter')}</label>
          <select
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            className="bg-dark-800 border border-dark-700 rounded-lg px-2.5 py-1.5 text-white text-sm min-w-[120px]"
          >
            <option value="">{t('archive.allRooms')}</option>
            {rooms.map((r) => (
              <option key={r._id} value={r._id}>{localizeRoomName(r.name, t) || `${t('archive.room')} ${r.roomNumber}`}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-dark-500 text-[10px] mb-0.5">{t('archive.strainFilter')}</label>
          <input
            type="text"
            placeholder={t('archive.searchPlaceholder')}
            value={strain}
            onChange={(e) => setStrain(e.target.value)}
            className="bg-dark-800 border border-dark-700 rounded-lg px-2.5 py-1.5 text-white text-sm w-28"
          />
        </div>

        <div>
          <label className="block text-dark-500 text-[10px] mb-0.5">{t('archive.periodFilter')}</label>
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="bg-dark-800 border border-dark-700 rounded-lg px-2.5 py-1.5 text-white text-sm"
          >
            <option value="all">{t('archive.periodAll')}</option>
            <option value="year">{t('archive.periodYear')}</option>
            <option value="6months">{t('archive.period6months')}</option>
            <option value="3months">{t('archive.period3months')}</option>
            <option value="month">{t('archive.periodMonth')}</option>
          </select>
        </div>

        <div>
          <label className="block text-dark-500 text-[10px] mb-0.5">{t('archive.sortLabel')}</label>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="bg-dark-800 border border-dark-700 rounded-lg px-2.5 py-1.5 text-white text-sm"
          >
            <option value="harvestDate">{t('archive.sortDate')}</option>
            <option value="dryWeight">{t('archive.sortWeight')}</option>
            <option value="gramsPerPlant">{t('archive.sortGPerPlant')}</option>
            <option value="actualDays">{t('archive.sortDays')}</option>
            <option value="shrinkage">{t('archive.sortShrinkage')}</option>
          </select>
        </div>

        <button
          onClick={() => setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc')}
          className="px-2 py-1.5 bg-dark-800 border border-dark-700 rounded-lg text-dark-400 hover:text-white text-sm transition"
          title={t('archive.sortOrderTitle')}
        >
          {sortOrder === 'desc' ? '↓' : '↑'}
        </button>

        {(roomId || strain || period !== 'all') && (
          <button
            onClick={() => { setRoomId(''); setStrain(''); setPeriod('all'); }}
            className="px-2.5 py-1.5 text-dark-500 hover:text-white text-sm"
          >
            {t('archive.resetFilters')}
          </button>
        )}
      </div>

      {/* ─── Error ─── */}
      {error && (
        <div className="mb-4 p-3 bg-red-900/20 border border-red-800 rounded-lg text-red-400 text-sm">{error}</div>
      )}

      {/* ─── Loading ─── */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-500" />
        </div>
      ) : archives.length === 0 ? (
        <div className="text-center py-16 bg-dark-800/50 rounded-xl border border-dark-700">
          <div className="text-4xl mb-3">📦</div>
          <p className="text-dark-400">{t('archive.noCompletedCycles')}</p>
        </div>
      ) : (
        /* ─── Archive Cards ─── */
        <div className="space-y-2">
          {archives.map((a) => {
            const wet = a.harvestData?.wetWeight || 0;
            const dry = a.harvestData?.dryWeight || 0;
            const trim = a.trimLogWeight || a.harvestData?.trimWeight || 0;
            // finalWeight (ручной ввод) — основной; fallback на trim для старых данных
            const finalProduct = (a.harvestData?.finalWeight || 0) > 0 ? a.harvestData.finalWeight : trim;
            // Усушка: (wet - finalProduct) / wet * 100
            const shrink = wet > 0 && finalProduct > 0 ? (((wet - finalProduct) / wet) * 100).toFixed(1) : null;
            const strainCount = Array.isArray(a.strains) ? a.strains.length : 0;
            const isExpanded = expandedId === a._id;
            const gpp = a.metrics?.gramsPerPlant;
            const gpw = a.metrics?.gramsPerWatt;

            return (
              <div key={a._id} className="bg-dark-800 border border-dark-700 rounded-lg overflow-hidden">
                {/* ── Main row ── */}
                <div
                  className="flex items-center gap-2 px-3 py-2.5 cursor-pointer hover:bg-dark-750 transition"
                  onClick={() => setExpandedId(isExpanded ? null : a._id)}
                >
                  {/* Room + strain */}
                  <div className="min-w-[110px] shrink-0">
                    <div className="text-white text-sm font-medium leading-tight">
                      {localizeRoomName(a.roomName, t) || `${t('archive.roomPrefix', { num: a.roomNumber })}`}
                    </div>
                    <div className="text-dark-400 text-xs leading-tight truncate max-w-[140px]">
                      {a.strain || '—'}
                      {strainCount > 1 && <span className="text-dark-600 ml-1">+{strainCount - 1}</span>}
                    </div>
                  </div>

                  {/* Date range */}
                  <div className="min-w-[85px] shrink-0 text-center">
                    <div className="text-dark-400 text-xs">{formatDate(a.startDate, lang)}</div>
                    <div className="text-dark-500 text-[10px]">{formatDate(a.harvestDate, lang)}</div>
                  </div>

                  {/* Days */}
                  <div className="min-w-[40px] text-center shrink-0">
                    <div className="text-dark-300 text-sm font-medium">{a.actualDays || '—'}</div>
                    <div className="text-dark-600 text-[10px]">{t('archive.daysShort')}</div>
                  </div>

                  {/* Plants */}
                  <div className="min-w-[35px] text-center shrink-0">
                    <div className="text-dark-300 text-sm">{a.plantsCount || '—'}</div>
                    <div className="text-dark-600 text-[10px]">{t('archive.plantsShort')}</div>
                  </div>

                  {/* Weights */}
                  <div className="flex items-center gap-3 min-w-[180px] shrink-0">
                    <div className="text-center">
                      <div className="text-blue-400 text-sm">{formatG(wet, lang)}</div>
                      <div className="text-dark-600 text-[10px]">{t('archive.wet')}</div>
                    </div>
                    <div className="text-dark-700">→</div>
                    <div className="text-center">
                      <div className="text-green-400 text-sm font-medium">{formatG(dry, lang)}</div>
                      <div className="text-dark-600 text-[10px]">{t('archive.dry')}</div>
                    </div>
                    {trim > 0 && (
                      <>
                        <div className="text-dark-700">+</div>
                        <div className="text-center">
                          <div className="text-orange-400 text-xs">{formatG(trim, lang)}</div>
                          <div className="text-dark-600 text-[10px]">{t('archive.trimLabel')}</div>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Metrics */}
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    {gpp > 0 && (
                      <div className="text-center">
                        <div className="text-primary-400 text-sm font-medium">{formatNum(gpp, lang)}</div>
                        <div className="text-dark-600 text-[10px]">{t('archive.gPerPlantShort')}</div>
                      </div>
                    )}
                    {shrink && (
                      <div className="text-center">
                        <div className="text-dark-400 text-xs">{shrink}%</div>
                        <div className="text-dark-600 text-[10px]">{t('archive.shrinkageShort')}</div>
                      </div>
                    )}
                    {gpw > 0 && (
                      <div className="text-center hidden sm:block">
                        <div className="text-amber-400 text-xs">{gpw.toFixed(2)}</div>
                        <div className="text-dark-600 text-[10px]">{t('archive.gPerWattShort')}</div>
                      </div>
                    )}
                  </div>

                  {/* Quality + detail link + expand */}
                  <div className="flex items-center gap-2 shrink-0">
                    <QualityDot quality={a.harvestData?.quality} />
                    <Link
                      to={`/archive/${a._id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="px-2.5 py-1 bg-primary-600/20 border border-primary-500/30 text-primary-400 hover:bg-primary-600/30 hover:text-primary-300 rounded-md text-xs font-medium transition"
                    >
                      {t('archive.viewDetails')}
                    </Link>
                    <svg
                      className={`w-4 h-4 text-dark-600 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                      fill="none" stroke="currentColor" viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>

                {/* ── Expanded: Timeline ── */}
                {isExpanded && (
                  <div className="px-3 pb-3 border-t border-dark-700/50">
                    <div className="pt-3">
                      {/* Timeline phases text */}
                      <div className="mb-3">
                        <TimelinePhases archive={a} t={t} i18n={i18n} />
                      </div>

                      {/* Visual timeline bar */}
                      <TimelineBar archive={a} t={t} i18n={i18n} />

                      {/* Extra info */}
                      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs">
                        {a.cycleName && (
                          <span className="text-dark-500">{t('archive.cycleName')}: <span className="text-dark-300">{a.cycleName}</span></span>
                        )}
                        {a.environment?.medium && (
                          <span className="text-dark-500">{t('archive.medium')}: <span className="text-dark-300">
                            {{ soil: t('archive.mediumSoil'), coco: t('archive.mediumCoco'), hydro: t('archive.mediumHydro'), aero: t('archive.mediumAero') }[a.environment.medium] || a.environment.medium}
                          </span></span>
                        )}
                        {a.lighting?.totalWatts > 0 && (
                          <span className="text-dark-500">{t('archive.lightLabel')}: <span className="text-dark-300">{t('archive.lightWatts', { watts: a.lighting.totalWatts })}</span></span>
                        )}
                        {a.squareMeters > 0 && (
                          <span className="text-dark-500">{t('archive.areaLabel')}: <span className="text-dark-300">{t('archive.areaSqM', { area: a.squareMeters })}</span></span>
                        )}
                        {a.trimLogEntries > 0 && (
                          <span className="text-dark-500">{t('archive.trimEntries')}: <span className="text-dark-300">{a.trimLogEntries}</span></span>
                        )}
                      </div>

                      {/* Strain data breakdown */}
                      {Array.isArray(a.strainData) && a.strainData.length > 1 && (
                        <div className="mt-3">
                          <div className="text-dark-500 text-[10px] mb-1">{t('archive.byStrains')}</div>
                          <div className="flex flex-wrap gap-2">
                            {a.strainData.map((sd, i) => (
                              <div key={i} className="bg-dark-700/50 rounded px-2 py-1 text-xs">
                                <span className="text-white font-medium">{sd.strain}</span>
                                {sd.dryWeight > 0 && <span className="text-green-400 ml-1.5">{sd.dryWeight}{lang === 'en' ? 'g' : 'г'}</span>}
                                {sd.wetWeight > 0 && <span className="text-dark-500 ml-1">({sd.wetWeight}{lang === 'en' ? 'g' : 'г'} {t('archive.wetAbbr')})</span>}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Link */}
                      <div className="mt-3">
                        <Link
                          to={`/archive/${a._id}`}
                          className="inline-flex items-center gap-1 px-3 py-1.5 bg-primary-600/20 border border-primary-500/30 text-primary-400 hover:bg-primary-600/30 hover:text-primary-300 rounded-lg text-xs font-medium transition"
                        >
                          {t('archive.openFullReport')}
                        </Link>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!loading && data.total > 0 && (
        <p className="mt-3 text-dark-500 text-xs">{t('archive.shown', { shown: archives.length, total: data.total })}</p>
      )}
    </div>
  );
}

/* ── Timeline text phases ── */
function TimelinePhases({ archive, t, i18n }) {
  const a = archive;
  const clone = a.cloneData || {};
  const veg = a.vegData || {};
  const lang = i18n.language;

  const phases = [];

  // Clone
  if (clone.cutDate) {
    const qty = clone.quantity || clone.strains?.reduce((s, x) => s + (x.quantity || 0), 0) || '?';
    const daysToVeg = daysBetween(clone.cutDate, veg.transplantedToVegAt);
    phases.push({
      icon: '✂️',
      label: t('archive.phaseClones'),
      date: formatDate(clone.cutDate, lang),
      info: t('archive.phaseCloneInfo', { qty }),
      days: daysToVeg != null ? t('archive.phaseDaysInfo', { days: daysToVeg }) : null,
      color: 'text-purple-400'
    });
  }

  // Veg
  if (veg.transplantedToVegAt) {
    const daysInVeg = veg.vegDaysActual || daysBetween(veg.transplantedToVegAt, veg.transplantedToFlowerAt);
    phases.push({
      icon: '🌱',
      label: t('archive.phaseVeg'),
      date: formatDate(veg.transplantedToVegAt, lang),
      info: daysInVeg != null ? t('archive.phaseDaysInfo', { days: daysInVeg }) : null,
      days: null,
      color: 'text-green-400'
    });
  }

  // Flower
  const flowerStart = veg.transplantedToFlowerAt || a.startDate;
  if (flowerStart) {
    phases.push({
      icon: '🌸',
      label: t('archive.phaseFlowering'),
      date: formatDate(flowerStart, lang),
      info: a.actualDays ? t('archive.phaseDaysInfo', { days: a.actualDays }) : null,
      days: null,
      color: 'text-yellow-400'
    });
  }

  // Harvest
  if (a.harvestDate) {
    const dryingDays = daysBetween(a.harvestDate, a.firstTrimDate || a.trimCompletedAt);
    phases.push({
      icon: '🌿',
      label: t('archive.phaseHarvest'),
      date: formatDate(a.harvestDate, lang),
      info: a.harvestData?.wetWeight ? t('archive.phaseWetInfo', { weight: formatG(a.harvestData.wetWeight, lang) }) : null,
      days: null,
      color: 'text-primary-400'
    });

    // Drying (harvest → first trim or trim complete)
    if (dryingDays != null && dryingDays > 0) {
      phases.push({
        icon: '🏜️',
        label: t('archive.phaseDrying'),
        date: '',
        info: t('archive.phaseDryingInfo', { days: dryingDays }),
        days: null,
        color: 'text-orange-400'
      });
    }
  }

  // Trim
  if (a.firstTrimDate || a.trimCompletedAt) {
    const trimDays = daysBetween(a.firstTrimDate, a.lastTrimDate || a.trimCompletedAt);
    const trimW = a.trimLogWeight || a.harvestData?.trimWeight || 0;
    phases.push({
      icon: '✂️',
      label: t('archive.phaseTrim'),
      date: a.firstTrimDate ? formatDate(a.firstTrimDate, lang) : '',
      info: trimW > 0 ? formatG(trimW, lang) : (trimDays != null ? t('archive.phaseDaysInfo', { days: trimDays }) : null),
      days: null,
      color: 'text-amber-400'
    });
  }

  // Trim done
  if (a.trimStatus === 'completed') {
    phases.push({
      icon: '✅',
      label: t('archive.phaseDone'),
      date: a.trimCompletedAt ? formatDate(a.trimCompletedAt, lang) : '',
      info: (() => {
        const fp = (a.harvestData?.finalWeight || 0) > 0 ? a.harvestData.finalWeight : (a.harvestData?.trimWeight || 0);
        return fp > 0 ? t('archive.phaseTotalInfo', { weight: formatG(fp, lang) }) : (a.harvestData?.dryWeight ? t('archive.phaseTotalInfo', { weight: formatG(a.harvestData.dryWeight, lang) }) : null);
      })(),
      days: null,
      color: 'text-green-400'
    });
  }

  if (phases.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1">
      {phases.map((p, i) => (
        <div key={i} className="flex items-center gap-0.5">
          {i > 0 && <span className="text-dark-700 mx-1">→</span>}
          <span className="text-sm">{p.icon}</span>
          <span className={`text-xs font-medium ${p.color}`}>{p.label}</span>
          {p.date && <span className="text-dark-500 text-[10px]">{p.date}</span>}
          {p.info && <span className="text-dark-400 text-[10px]">({p.info})</span>}
        </div>
      ))}
    </div>
  );
}
