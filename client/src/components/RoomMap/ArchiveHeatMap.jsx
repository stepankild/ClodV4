/**
 * Тепловая карта сбора урожая для архива.
 * Процентильная система цвета: чем тяжелее куст — тем зеленее.
 * Статистика по рядам, сравнение рядов, общая статистика.
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

// ── Helpers ──────────────────────────────────────────────────────────

function calcStats(weights) {
  if (!weights.length) return { count: 0, avg: 0, min: 0, max: 0, total: 0, median: 0 };
  const sorted = [...weights].sort((a, b) => a - b);
  const total = sorted.reduce((s, w) => s + w, 0);
  const median = sorted.length % 2 === 0
    ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    : sorted[Math.floor(sorted.length / 2)];
  return {
    count: sorted.length,
    avg: Math.round(total / sorted.length),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    total,
    median: Math.round(median),
  };
}

/** Percentile-based HSL colour for better weight differentiation */
function getHeatColor(weight, sortedWeights) {
  if (!weight || sortedWeights.length < 2) {
    return { bg: 'hsl(120, 70%, 22%)', border: 'hsl(120, 70%, 35%)', text: 'hsl(120, 70%, 75%)' };
  }

  // Find percentile rank (0 → 1)
  let below = 0;
  for (const w of sortedWeights) {
    if (w < weight) below++;
    else break;
  }
  const percentile = below / (sortedWeights.length - 1);

  // Multi-stop colour scale for better differentiation:
  // 0% → deep red (0, 85%, 20%)
  // 25% → orange (25, 85%, 24%)
  // 50% → yellow (50, 80%, 26%)
  // 75% → lime (85, 75%, 24%)
  // 100% → rich green (140, 70%, 22%)
  const stops = [
    { p: 0, h: 0, s: 85, l: 20 },
    { p: 0.25, h: 25, s: 85, l: 24 },
    { p: 0.50, h: 50, s: 80, l: 26 },
    { p: 0.75, h: 85, s: 75, l: 24 },
    { p: 1, h: 140, s: 70, l: 22 },
  ];

  // Interpolate between stops
  let lo = stops[0], hi = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (percentile >= stops[i].p && percentile <= stops[i + 1].p) {
      lo = stops[i];
      hi = stops[i + 1];
      break;
    }
  }

  const f = hi.p === lo.p ? 0.5 : (percentile - lo.p) / (hi.p - lo.p);
  const h = Math.round(lo.h + (hi.h - lo.h) * f);
  const s = Math.round(lo.s + (hi.s - lo.s) * f);
  const l = Math.round(lo.l + (hi.l - lo.l) * f);

  return {
    bg: `hsl(${h}, ${s}%, ${l}%)`,
    border: `hsl(${h}, ${s}%, ${l + 14}%)`,
    text: `hsl(${h}, ${s - 10}%, ${l + 55}%)`,
  };
}

/** Deviation-based colour: green ±15%, red below, blue above */
function getDeviationColor(weight, reference) {
  if (!weight || !reference || reference <= 0) {
    return { bg: 'hsl(0, 0%, 18%)', border: 'hsl(0, 0%, 28%)', text: 'hsl(0, 0%, 55%)' };
  }

  const deviation = (weight - reference) / reference;

  if (Math.abs(deviation) <= 0.15) {
    // GREEN ZONE: within ±15% of reference
    const intensity = 1 - Math.abs(deviation) / 0.15;
    const l = 22 + Math.round((1 - intensity) * 6);
    return {
      bg:     `hsl(140, 70%, ${l}%)`,
      border: `hsl(140, 70%, ${l + 14}%)`,
      text:   `hsl(140, 60%, ${l + 55}%)`,
    };
  }

  if (deviation < -0.15) {
    // RED ZONE: below reference by more than 15%
    const f = Math.min((Math.abs(deviation) - 0.15) / 0.85, 1);
    const h = Math.round(30 * (1 - f));
    const s = Math.round(65 + f * 20);
    const l = Math.round(24 - f * 4);
    return {
      bg:     `hsl(${h}, ${s}%, ${l}%)`,
      border: `hsl(${h}, ${s}%, ${l + 14}%)`,
      text:   `hsl(${h}, ${s - 10}%, ${l + 55}%)`,
    };
  }

  // BLUE ZONE: above reference by more than 15%
  const f = Math.min((deviation - 0.15) / 0.85, 1);
  const h = Math.round(200 + f * 20);
  const s = Math.round(60 + f * 20);
  const l = Math.round(24 + f * 4);
  return {
    bg:     `hsl(${h}, ${s}%, ${l}%)`,
    border: `hsl(${h}, ${s}%, ${l + 14}%)`,
    text:   `hsl(${h}, ${s - 10}%, ${l + 55}%)`,
  };
}

// ── Row stats mini-bar ───────────────────────────────────────────────

function RowStats({ stats, label, globalMax, t }) {
  if (!stats.count) return null;
  const barWidth = globalMax > 0 ? Math.max(8, (stats.avg / globalMax) * 100) : 100;

  return (
    <div className="mt-1.5 px-1">
      <div className="flex items-center gap-2 text-[10px] text-dark-400">
        <span className="whitespace-nowrap font-medium text-dark-300">{label}</span>
        <span>ø {stats.avg}{t('common.grams')}</span>
        <span className="text-red-400/80">{stats.min}{t('common.grams')}</span>
        <span className="text-dark-600">—</span>
        <span className="text-green-400/80">{stats.max}{t('common.grams')}</span>
        <span className="text-dark-500">Σ{stats.total}{t('common.grams')}</span>
      </div>
      {/* Visual bar — avg relative to room maximum */}
      <div className="h-1 mt-0.5 rounded-full bg-dark-700 overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${barWidth}%`,
            background: `linear-gradient(90deg, hsl(25,80%,30%), hsl(80,70%,30%), hsl(140,70%,28%))`,
          }}
        />
      </div>
    </div>
  );
}

// ── Comparison table ─────────────────────────────────────────────────

function RowComparisonTable({ rowStats, globalStats, t }) {
  if (rowStats.length < 2) return null;

  const best = Math.max(...rowStats.map(r => r.stats.avg));
  const worst = Math.min(...rowStats.filter(r => r.stats.count > 0).map(r => r.stats.avg));

  return (
    <div className="mt-4 space-y-2">
      <h4 className="text-sm font-semibold text-white flex items-center gap-2">
        <span className="text-base">📊</span> {t('roomMap.rowComparison')}
      </h4>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-dark-400 border-b border-dark-700">
              <th className="text-left py-1.5 pr-3 font-medium">{t('roomMap.colRow')}</th>
              <th className="text-right py-1.5 px-2 font-medium">{t('roomMap.colPlants')}</th>
              <th className="text-right py-1.5 px-2 font-medium">{t('roomMap.colAvgWeight')}</th>
              <th className="text-right py-1.5 px-2 font-medium">{t('roomMap.colMin')}</th>
              <th className="text-right py-1.5 px-2 font-medium">{t('roomMap.colMax')}</th>
              <th className="text-right py-1.5 px-2 font-medium">{t('roomMap.colMedian')}</th>
              <th className="text-right py-1.5 px-2 font-medium">{t('roomMap.colTotal')}</th>
              <th className="text-left py-1.5 pl-3 font-medium min-w-[100px]">{t('roomMap.colVisual')}</th>
            </tr>
          </thead>
          <tbody>
            {rowStats.map(({ name, stats }, i) => {
              if (!stats.count) return null;
              const isBest = stats.avg === best && rowStats.length > 1;
              const isWorst = stats.avg === worst && rowStats.length > 1 && best !== worst;
              const barPct = globalStats.max > 0 ? Math.max(5, (stats.avg / globalStats.max) * 100) : 0;
              const diffPct = globalStats.avg > 0
                ? (((stats.avg - globalStats.avg) / globalStats.avg) * 100).toFixed(1)
                : '0.0';
              const diffPositive = parseFloat(diffPct) >= 0;

              return (
                <tr key={i} className="border-b border-dark-700/50 hover:bg-dark-700/30 transition-colors">
                  <td className="py-1.5 pr-3">
                    <span className="text-white font-medium">{name}</span>
                    {isBest && <span className="ml-1 text-green-400" title={t('roomMap.bestRow')}>🏆</span>}
                    {isWorst && <span className="ml-1 text-red-400/70" title={t('roomMap.worstRow')}>▼</span>}
                  </td>
                  <td className="text-right py-1.5 px-2 text-dark-300">{stats.count}</td>
                  <td className="text-right py-1.5 px-2 text-white font-medium">{stats.avg}{t('common.grams')}</td>
                  <td className="text-right py-1.5 px-2 text-red-400/80">{stats.min}{t('common.grams')}</td>
                  <td className="text-right py-1.5 px-2 text-green-400/80">{stats.max}{t('common.grams')}</td>
                  <td className="text-right py-1.5 px-2 text-dark-300">{stats.median}{t('common.grams')}</td>
                  <td className="text-right py-1.5 px-2 text-dark-300">{stats.total}{t('common.grams')}</td>
                  <td className="py-1.5 pl-3">
                    <div className="flex items-center gap-1.5">
                      <div className="flex-1 h-2.5 rounded-full bg-dark-700 overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${barPct}%`,
                            backgroundColor: isBest ? 'hsl(140,70%,35%)' : isWorst ? 'hsl(0,70%,35%)' : 'hsl(50,70%,35%)',
                          }}
                        />
                      </div>
                      <span className={`text-[10px] font-medium whitespace-nowrap ${diffPositive ? 'text-green-400/80' : 'text-red-400/80'}`}>
                        {diffPositive ? '+' : ''}{diffPct}%
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Stat card ────────────────────────────────────────────────────────

function StatCard({ label, value, highlight, color }) {
  return (
    <div className="bg-dark-700/40 rounded-lg px-3 py-2 text-center">
      <div className="text-dark-400 text-[10px] leading-tight">{label}</div>
      <div className={`text-sm font-semibold ${highlight ? 'text-white' : color || 'text-dark-200'}`}>
        {value}
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────

export default function ArchiveHeatMap({ harvestMapData, extraNutritionPlants, extraNutritionMode, onExtraNutritionToggle }) {
  const { t } = useTranslation();
  const { customRows = [], plants = [] } = harvestMapData || {};

  // ── Data prep (memoised) ──
  const {
    posMap,
    sortedWeights,
    globalStats,
    rowStatsArr,
    strainBreakdown,
    histogram,
  } = useMemo(() => {
    const pm = {};
    plants.forEach(p => { pm[`${p.row}:${p.position}`] = p; });

    const weights = plants.filter(p => p.wetWeight > 0).map(p => p.wetWeight);
    const sw = [...weights].sort((a, b) => a - b);
    const gs = calcStats(weights);

    // Per-row stats
    const rsa = customRows.map((row, rowIdx) => {
      const rowPlants = plants.filter(p => p.row === rowIdx && p.wetWeight > 0);
      const rw = rowPlants.map(p => p.wetWeight);
      return {
        name: row.name || t('roomMap.rowDefault', { num: rowIdx + 1 }),
        stats: calcStats(rw),
      };
    });

    // Strain breakdown — count plants and sum weight per strain
    const strainMap = {};
    plants.forEach(p => {
      const s = p.strain || t('roomMap.noStrain');
      if (!strainMap[s]) strainMap[s] = { count: 0, totalWeight: 0, weights: [] };
      strainMap[s].count++;
      if (p.wetWeight > 0) {
        strainMap[s].totalWeight += p.wetWeight;
        strainMap[s].weights.push(p.wetWeight);
      }
    });
    const sb = Object.entries(strainMap)
      .map(([name, data]) => ({
        name,
        count: data.count,
        totalWeight: data.totalWeight,
        avgWeight: data.weights.length ? Math.round(data.totalWeight / data.weights.length) : 0,
      }))
      .sort((a, b) => b.count - a.count);

    // Histogram (5 buckets)
    const hist = { buckets: [], maxBucket: 0 };
    if (sw.length >= 3) {
      const bMin = sw[0];
      const bMax = sw[sw.length - 1];
      const bucketCount = 5;
      const bucketSize = (bMax - bMin) / bucketCount || 1;
      const bkts = Array.from({ length: bucketCount }, (_, i) => ({
        from: Math.round(bMin + i * bucketSize),
        to: Math.round(bMin + (i + 1) * bucketSize),
        count: 0,
      }));
      sw.forEach(w => {
        const idx = Math.min(Math.floor((w - bMin) / bucketSize), bucketCount - 1);
        bkts[idx].count++;
      });
      hist.buckets = bkts;
      hist.maxBucket = Math.max(...bkts.map(b => b.count));
    }

    return { posMap: pm, sortedWeights: sw, globalStats: gs, rowStatsArr: rsa, strainBreakdown: sb, histogram: hist };
  }, [customRows, plants, t]);

  // ── Color mode state ──
  const [colorMode, setColorMode] = useState(0);
  const [customRef, setCustomRef] = useState('');

  const COLOR_MODES = [
    { id: 0, label: t('roomMap.percentile') },
    { id: 1, label: t('roomMap.rowAvg') },
    { id: 2, label: t('roomMap.roomAvg') },
    { id: 3, label: t('roomMap.customWeight') },
  ];

  function getCellColor(weight, rowIndex) {
    switch (colorMode) {
      case 1: return getDeviationColor(weight, rowStatsArr[rowIndex]?.stats?.avg);
      case 2: return getDeviationColor(weight, globalStats.avg);
      case 3: {
        const ref = parseFloat(customRef);
        return getDeviationColor(weight, isNaN(ref) || ref <= 0 ? null : ref);
      }
      default: return getHeatColor(weight, sortedWeights);
    }
  }

  if (!customRows.length || !plants.length) return null;

  return (
    <div className="space-y-4">
      {/* ── Color mode selector ── */}
      <div className="flex flex-wrap items-center gap-2">
        {COLOR_MODES.map(m => (
          <button
            key={m.id}
            onClick={() => setColorMode(m.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              colorMode === m.id
                ? 'bg-primary-900/50 text-primary-400 ring-1 ring-primary-500/30'
                : 'bg-dark-700/50 text-dark-400 hover:text-dark-200'
            }`}
          >
            {m.label}
          </button>
        ))}

        {colorMode === 3 && (
          <input
            type="number"
            min="0"
            step="1"
            value={customRef}
            onChange={(e) => setCustomRef(e.target.value)}
            placeholder={t('roomMap.targetWeightPlaceholder')}
            className="w-36 px-3 py-1.5 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm placeholder:text-dark-500 focus:outline-none focus:ring-1 focus:ring-primary-500/50"
          />
        )}
      </div>

      {/* ── Heat map grid ── */}
      <div className="flex gap-3 overflow-x-auto pb-2">
        {customRows.map((row, rowIdx) => {
          const cols = row.cols || 1;
          const rowsCount = row.rows || 1;
          const rowStat = rowStatsArr[rowIdx];

          return (
            <div key={rowIdx} className="flex flex-col shrink-0">
              <span className="text-xs text-dark-400 font-medium whitespace-nowrap mb-1 text-center">
                {row.name || t('roomMap.rowDefault', { num: rowIdx + 1 })}
              </span>

              <div
                className="grid gap-1"
                style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
              >
                {Array.from({ length: rowsCount }, (_, rIdx) =>
                  Array.from({ length: cols }, (_, cIdx) => {
                    const posIdx = rIdx * cols + cIdx;
                    const plant = posMap[`${rowIdx}:${posIdx}`];

                    if (!plant) {
                      return (
                        <div
                          key={posIdx}
                          className="min-w-[40px] min-h-[40px] sm:min-w-[48px] sm:min-h-[48px] border border-dashed border-dark-600 rounded-md flex items-center justify-center"
                        >
                          <span className="text-dark-600 text-[9px]">—</span>
                        </div>
                      );
                    }

                    if (!plant.wetWeight) {
                      return (
                        <div
                          key={posIdx}
                          className="min-w-[40px] min-h-[40px] sm:min-w-[48px] sm:min-h-[48px] bg-dark-700 border border-dark-500 rounded-md flex flex-col items-center justify-center"
                          title={t('roomMap.notRecorded', { num: plant.plantNumber })}
                        >
                          <span className="text-[10px] font-bold text-dark-400">{plant.plantNumber}</span>
                          <span className="text-[8px] text-dark-500">—</span>
                        </div>
                      );
                    }

                    const isExtraNutr = extraNutritionPlants?.has?.(plant.plantNumber);
                    const color = getCellColor(plant.wetWeight, rowIdx);
                    const cellTitle = plant.strain
                      ? t('roomMap.cellTitleWithStrain', { num: plant.plantNumber, weight: plant.wetWeight, strain: plant.strain })
                      : t('roomMap.cellTitle', { num: plant.plantNumber, weight: plant.wetWeight });

                    // Nutrition markup mode: clickable cells
                    if (extraNutritionMode) {
                      return (
                        <button
                          key={posIdx}
                          type="button"
                          onClick={() => onExtraNutritionToggle?.(plant.plantNumber)}
                          className={`min-w-[40px] min-h-[40px] sm:min-w-[48px] sm:min-h-[48px] rounded-md flex flex-col items-center justify-center transition cursor-pointer hover:scale-105 ${
                            isExtraNutr
                              ? 'bg-yellow-500/30 border-2 border-yellow-400 ring-1 ring-yellow-400/50'
                              : 'border border-dark-600 hover:border-yellow-500/50'
                          }`}
                          style={!isExtraNutr ? { backgroundColor: color.bg } : undefined}
                          title={cellTitle}
                        >
                          <span className={`text-[10px] font-bold leading-tight ${isExtraNutr ? 'text-yellow-300' : ''}`}
                            style={!isExtraNutr ? { color: color.text } : undefined}
                          >
                            {plant.plantNumber}
                          </span>
                          <span className={`text-[8px] leading-tight ${isExtraNutr ? 'text-yellow-300/80' : ''}`}
                            style={!isExtraNutr ? { color: color.text, opacity: 0.8 } : undefined}
                          >
                            {plant.wetWeight}{t('common.grams')}
                          </span>
                          {isExtraNutr && <span className="text-[7px] leading-tight">🧪</span>}
                        </button>
                      );
                    }

                    return (
                      <div
                        key={posIdx}
                        className={`min-w-[40px] min-h-[40px] sm:min-w-[48px] sm:min-h-[48px] rounded-md flex flex-col items-center justify-center transition ${
                          isExtraNutr ? 'ring-2 ring-yellow-400/60' : ''
                        }`}
                        style={{
                          backgroundColor: color.bg,
                          borderWidth: '1px',
                          borderStyle: 'solid',
                          borderColor: isExtraNutr ? 'hsl(45, 90%, 50%)' : color.border,
                        }}
                        title={cellTitle}
                      >
                        <span
                          className="text-[10px] font-bold leading-tight"
                          style={{ color: color.text }}
                        >
                          {plant.plantNumber}
                        </span>
                        <span
                          className="text-[8px] leading-tight"
                          style={{ color: color.text, opacity: 0.8 }}
                        >
                          {plant.wetWeight}{t('common.grams')}
                        </span>
                        {isExtraNutr && <span className="text-[6px] leading-tight">🧪</span>}
                      </div>
                    );
                  })
                )}
              </div>

              {/* Per-row inline stats */}
              <RowStats
                stats={rowStat.stats}
                label={rowStat.name}
                globalMax={globalStats.max}
                t={t}
              />
            </div>
          );
        })}
      </div>

      {/* ── Legend ── */}
      {sortedWeights.length > 1 && (
        colorMode === 0 ? (
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-dark-400 whitespace-nowrap">{globalStats.min}{t('common.grams')}</span>
              <div
                className="flex-1 h-3 rounded-full"
                style={{
                  background: 'linear-gradient(to right, hsl(0,85%,20%), hsl(25,85%,24%), hsl(50,80%,26%), hsl(85,75%,24%), hsl(140,70%,22%))'
                }}
              />
              <span className="text-[10px] text-dark-400 whitespace-nowrap">{globalStats.max}{t('common.grams')}</span>
            </div>
            <div className="flex justify-center">
              <span className="text-[10px] text-dark-500">{t('roomMap.lightToHeavy')}</span>
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            <div className="flex items-center gap-1">
              <div className="flex-1 h-3 rounded-l-full" style={{
                background: 'linear-gradient(to right, hsl(0,85%,20%), hsl(30,65%,24%))'
              }} />
              <div className="flex-1 h-3" style={{ background: 'hsl(140,70%,22%)' }} />
              <div className="flex-1 h-3 rounded-r-full" style={{
                background: 'linear-gradient(to right, hsl(200,60%,24%), hsl(220,80%,28%))'
              }} />
            </div>
            <div className="flex justify-between text-[10px] text-dark-500 px-1">
              <span>{t('roomMap.belowNorm')}</span>
              <span>{t('roomMap.withinNorm')}</span>
              <span>{t('roomMap.aboveNorm')}</span>
            </div>
            <div className="flex justify-center">
              <span className="text-[10px] text-dark-400">
                {colorMode === 1 && t('roomMap.refRowAvg')}
                {colorMode === 2 && t('roomMap.refRoomAvg', { avg: globalStats.avg })}
                {colorMode === 3 && t('roomMap.refCustom', { weight: customRef || '—' })}
              </span>
            </div>
          </div>
        )
      )}

      {/* ── Strain breakdown ── */}
      {strainBreakdown.length > 1 && (
        <div className="space-y-1.5">
          <h4 className="text-sm font-semibold text-white flex items-center gap-2">
            <span className="text-base">🌿</span> {t('roomMap.byStrains')}
          </h4>
          <div className="flex flex-wrap gap-2">
            {strainBreakdown.map((s, i) => (
              <div
                key={i}
                className="bg-dark-700/50 rounded-lg px-3 py-1.5 flex items-baseline gap-2"
              >
                <span className="text-white text-xs font-medium">{s.name}</span>
                <span className="text-dark-400 text-[10px]">{t('roomMap.plantsCount', { count: s.count })}</span>
                {s.avgWeight > 0 && (
                  <span className="text-dark-500 text-[10px]">ø {s.avgWeight}{t('common.grams')}</span>
                )}
                {s.totalWeight > 0 && (
                  <span className="text-dark-500 text-[10px]">Σ{s.totalWeight}{t('common.grams')}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Row comparison table ── */}
      <RowComparisonTable rowStats={rowStatsArr} globalStats={globalStats} t={t} />

      {/* ── Overall room stats ── */}
      <div className="mt-4 space-y-2">
        <h4 className="text-sm font-semibold text-white flex items-center gap-2">
          <span className="text-base">🏠</span> {t('roomMap.roomStats')}
        </h4>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
          <StatCard label={t('roomMap.statPlants')} value={globalStats.count} />
          <StatCard label={t('roomMap.statAvg')} value={`${globalStats.avg}${t('common.grams')}`} highlight />
          <StatCard label={t('roomMap.statMedian')} value={`${globalStats.median}${t('common.grams')}`} />
          <StatCard label={t('roomMap.statMin')} value={`${globalStats.min}${t('common.grams')}`} color="text-red-400" />
          <StatCard label={t('roomMap.statMax')} value={`${globalStats.max}${t('common.grams')}`} color="text-green-400" />
          <StatCard label={t('roomMap.statTotal')} value={`${globalStats.total}${t('common.grams')}`} highlight />
        </div>

        {/* Weight distribution histogram */}
        {histogram.buckets.length > 0 && (
          <div className="mt-3">
            <div className="text-[10px] text-dark-400 mb-1.5 font-medium">{t('roomMap.weightDistribution')}</div>
            <div className="flex items-end gap-1 h-16">
              {histogram.buckets.map((b, i) => {
                const hPct = histogram.maxBucket > 0 ? Math.max(4, (b.count / histogram.maxBucket) * 100) : 0;
                // Colour gradient matching heat map
                const frac = histogram.buckets.length > 1 ? i / (histogram.buckets.length - 1) : 0.5;
                const hue = Math.round(frac * 140);

                return (
                  <div key={i} className="flex-1 flex flex-col items-center justify-end h-full">
                    <span className="text-[9px] text-dark-400 mb-0.5">{b.count}</span>
                    <div
                      className="w-full rounded-t transition-all"
                      style={{
                        height: `${hPct}%`,
                        backgroundColor: `hsl(${hue}, 70%, 32%)`,
                        minHeight: '2px',
                      }}
                      title={t('roomMap.histogramTitle', { from: b.from, to: b.to, count: b.count })}
                    />
                    <span className="text-[8px] text-dark-500 mt-0.5 whitespace-nowrap">
                      {b.from}—{b.to}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
