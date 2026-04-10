import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { roomService } from '../../services/roomService';
import StrainSelect from '../StrainSelect';

const DEFAULT_CUT_LEAD_DAYS = 28; // 4 weeks
const ONE_DAY = 24 * 60 * 60 * 1000;

// Convert a plan object into a unified strains array:
// if plannedCycle.strains[] is non-empty, use it; otherwise fall back to the legacy
// single strain + plantsCount pair.
function toStrainRows(plan) {
  if (plan && Array.isArray(plan.strains) && plan.strains.length > 0) {
    return plan.strains.map(s => ({
      strain: s.strain || '',
      quantity: Number(s.quantity) || 0
    }));
  }
  if (plan && (plan.strain || plan.plantsCount)) {
    return [{ strain: plan.strain || '', quantity: Number(plan.plantsCount) || 0 }];
  }
  return [];
}

function strainRowsTotal(rows) {
  return rows.reduce((acc, r) => acc + (Number(r.quantity) || 0), 0);
}

function hasAnyStrain(rows) {
  return rows.some(r => (r.strain || '').trim() && Number(r.quantity) > 0);
}

function addDays(date, days) {
  if (!date) return null;
  return new Date(new Date(date).getTime() + days * ONE_DAY);
}

function diffDays(from, to) {
  if (!from || !to) return null;
  return Math.round((new Date(to).getTime() - new Date(from).getTime()) / ONE_DAY);
}

function formatDate(date) {
  if (!date) return '—';
  return new Date(date).toLocaleDateString();
}

function isoDate(date) {
  if (!date) return '';
  return new Date(date).toISOString().split('T')[0];
}

/**
 * Summarizes a room's pipeline: all CloneCut + VegBatch entries targeted at this
 * room belong to its NEXT cycle. We just sum them and group by strain — no clever
 * matching, no chronological assignment.
 */
function summarizePipeline(pipeline) {
  const batches = pipeline?.batches || [];
  if (batches.length === 0) return { empty: true, totalCut: 0, totalVeg: 0, byStrain: [], earliestDate: null };

  let totalCut = 0;
  let totalVeg = 0;
  const strainMap = new Map();
  let earliestDate = null;

  for (const b of batches) {
    const qty = Number(b.quantity) || 0;
    if (qty <= 0) continue;
    if (b.kind === 'veg') totalVeg += qty;
    else totalCut += qty;
    const key = (b.strain || '—').trim() || '—';
    const prev = strainMap.get(key) || { strain: key, cut: 0, veg: 0 };
    if (b.kind === 'veg') prev.veg += qty;
    else prev.cut += qty;
    strainMap.set(key, prev);

    if (b.cutDate) {
      const t = new Date(b.cutDate).getTime();
      if (earliestDate == null || t < earliestDate) earliestDate = t;
    }
  }

  const byStrain = Array.from(strainMap.values())
    .sort((a, b) => (b.cut + b.veg) - (a.cut + a.veg));

  return {
    empty: false,
    totalCut,
    totalVeg,
    total: totalCut + totalVeg,
    byStrain,
    earliestDate: earliestDate ? new Date(earliestDate) : null,
  };
}

/**
 * Computes the three cycle slots for a room and the cut event associated with each
 * planned cycle. Cut rule: clones are cut CUT_LEAD_DAYS (28) before the END of the
 * CURRENT cycle (for slot "next"), and 28 days before the end of the "next" cycle
 * (for slot "next+1").
 */
function computeCyclesForRoom(room) {
  const now = new Date();

  // Current cycle — read from FlowerRoom (room-level flowerStrains if present)
  const current = {
    kind: 'current',
    strainRows: Array.isArray(room.flowerStrains) && room.flowerStrains.length > 0
      ? room.flowerStrains.map(s => ({ strain: s.strain || '', quantity: s.quantity || 0 }))
      : (room.strain || room.plantsCount
          ? [{ strain: room.strain || '', quantity: room.plantsCount || 0 }]
          : []),
    startDate: room.startDate || null,
    floweringDays: room.floweringDays || 56,
  };
  current.plantsCount = strainRowsTotal(current.strainRows);
  current.endDate = current.startDate
    ? addDays(current.startDate, current.floweringDays)
    : null;

  const makePlanned = (kind, plan) => {
    const rows = toStrainRows(plan);
    return {
      kind,
      _id: plan?._id || null,
      strainRows: rows,
      plantsCount: strainRowsTotal(rows),
      plannedStartDate: plan?.plannedStartDate || null,
      floweringDays: plan?.floweringDays || 56,
      cutLeadDays: plan?.cutLeadDays ?? DEFAULT_CUT_LEAD_DAYS,
    };
  };

  const planOrder0 = (room.plannedCycles || []).find(p => (p.order ?? 0) === 0) || null;
  const next = makePlanned('next', planOrder0);
  // Clones for NEXT are cut `cutLeadDays` before the CURRENT cycle ends
  next.cutDate = current.endDate ? addDays(current.endDate, -next.cutLeadDays) : null;
  next.effectiveStartDate = next.plannedStartDate || current.endDate || null;
  next.endDate = next.effectiveStartDate ? addDays(next.effectiveStartDate, next.floweringDays) : null;

  const planOrder1 = (room.plannedCycles || []).find(p => (p.order ?? 0) === 1) || null;
  const nextPlus = makePlanned('nextPlus', planOrder1);
  // Clones for NEXT+1 are cut `cutLeadDays` before NEXT ends
  nextPlus.cutDate = next.endDate ? addDays(next.endDate, -nextPlus.cutLeadDays) : null;
  nextPlus.effectiveStartDate = nextPlus.plannedStartDate || next.endDate || null;
  nextPlus.endDate = nextPlus.effectiveStartDate ? addDays(nextPlus.effectiveStartDate, nextPlus.floweringDays) : null;

  const cutDays = (d) => (d ? diffDays(now, d) : null);
  next.cutInDays = cutDays(next.cutDate);
  nextPlus.cutInDays = cutDays(nextPlus.cutDate);

  return { current, next, nextPlus };
}

export default function CloneCuttingPlan() {
  const { t } = useTranslation();
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState({}); // { [roomId_order]: boolean }

  const loadRooms = useCallback(async () => {
    setLoading(true);
    try {
      const data = await roomService.getRoomsSummary();
      setRooms(data.filter(r => r.roomNumber && r.roomNumber > 0));
    } catch (err) {
      console.error('Load rooms summary error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadRooms(); }, [loadRooms]);

  // Save (or upsert) a planned cycle for a given room + order. Merges the saved
  // plan into local state so we don't reload the whole rooms list mid-typing.
  const savePlan = async (roomId, order, patch) => {
    const key = `${roomId}_${order}`;
    setSaving(s => ({ ...s, [key]: true }));
    try {
      const saved = await roomService.createPlan({ roomId, order, ...patch });
      setRooms(prev => prev.map(r => {
        if (r._id !== roomId) return r;
        const existing = r.plannedCycles || [];
        const idx = existing.findIndex(p => (p.order ?? 0) === order);
        const savedLite = {
          _id: saved._id,
          cycleName: saved.cycleName,
          strain: saved.strain,
          strains: saved.strains || [],
          plannedStartDate: saved.plannedStartDate,
          plantsCount: saved.plantsCount,
          floweringDays: saved.floweringDays,
          cutLeadDays: saved.cutLeadDays ?? 28,
          order: saved.order ?? order,
          notes: saved.notes,
        };
        const nextPlans = idx >= 0
          ? existing.map((p, i) => (i === idx ? savedLite : p))
          : [...existing, savedLite].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        const nextPlannedCycle = nextPlans.find(p => (p.order ?? 0) === 0) || nextPlans[0] || null;
        return { ...r, plannedCycles: nextPlans, plannedCycle: nextPlannedCycle };
      }));
    } catch (err) {
      console.error('Save plan error:', err);
      alert(err.response?.data?.message || 'Error');
    } finally {
      setSaving(s => ({ ...s, [key]: false }));
    }
  };

  // Active rooms first, then inactive
  const sortedRooms = useMemo(() => {
    return [...rooms].sort((a, b) => {
      if ((b.isActive ? 1 : 0) !== (a.isActive ? 1 : 0)) return (b.isActive ? 1 : 0) - (a.isActive ? 1 : 0);
      return (a.roomNumber || 0) - (b.roomNumber || 0);
    });
  }, [rooms]);

  // Aggregate upcoming cuts across all rooms. NEXT cycle is covered if there's
  // ANY pipeline batch for that room. NEXT+1 is always based on the manual plan.
  // Each planned cycle may have several strains → expand into multiple cut entries.
  const upcomingCuts = useMemo(() => {
    const list = [];
    sortedRooms.forEach(room => {
      const { next, nextPlus } = computeCyclesForRoom(room);
      const pipelineSummary = summarizePipeline(room.pipeline);
      const roomLabel = room.name || `${t('motherRoom.roomShort')} ${room.roomNumber}`;

      const pushCycleCuts = (cycle) => {
        if (!cycle.cutDate) return;
        cycle.strainRows.forEach(row => {
          if (!row.strain || !(row.quantity > 0)) return;
          list.push({
            roomName: roomLabel,
            roomNumber: room.roomNumber,
            strain: row.strain,
            quantity: row.quantity,
            cutDate: cycle.cutDate,
            cutInDays: cycle.cutInDays,
            cycleKind: cycle.kind,
          });
        });
      };

      // NEXT: only if pipeline is empty and plan has any filled strain row
      if (pipelineSummary.empty && hasAnyStrain(next.strainRows)) {
        pushCycleCuts(next);
      }
      // NEXT+1: always driven by the manual plan
      if (hasAnyStrain(nextPlus.strainRows)) {
        pushCycleCuts(nextPlus);
      }
    });
    list.sort((a, b) => new Date(a.cutDate) - new Date(b.cutDate));
    return list;
  }, [sortedRooms, t]);

  // Total clones grouped by strain, only counting cuts happening in the next 8 weeks
  const strainTotals = useMemo(() => {
    const totals = new Map();
    upcomingCuts.forEach(cut => {
      if (cut.cutInDays == null || cut.cutInDays > 56) return;
      totals.set(cut.strain, (totals.get(cut.strain) || 0) + cut.quantity);
    });
    return Array.from(totals.entries()).sort((a, b) => b[1] - a[1]);
  }, [upcomingCuts]);

  if (loading) {
    return (
      <div className="text-center py-6 text-dark-500 text-xs">
        {t('common.loading', 'Загрузка…')}
      </div>
    );
  }

  if (sortedRooms.length === 0) {
    return null;
  }

  return (
    <div className="bg-dark-800 border border-dark-700 rounded-lg p-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-sm font-semibold text-white">{t('motherRoom.cloneCuttingPlan')}</h3>
        <span className="text-[11px] text-dark-500">{t('motherRoom.cutRuleHint')}</span>
      </div>


      {/* Aggregated upcoming cuts */}
      {upcomingCuts.length > 0 ? (
        <div className="bg-dark-900/40 border border-dark-700 rounded-lg p-3 space-y-2">
          <div className="text-[11px] text-dark-400 font-medium">
            {t('motherRoom.upcomingCuts')}
            {strainTotals.length > 0 && (
              <span className="text-dark-500 font-normal ml-2">
                — {strainTotals.map(([s, c]) => `${s}: ${c}`).join(', ')}
              </span>
            )}
          </div>
          <div className="flex flex-col gap-1">
            {upcomingCuts.map((cut, idx) => {
              const overdue = cut.cutInDays != null && cut.cutInDays < 0;
              const soon = cut.cutInDays != null && cut.cutInDays >= 0 && cut.cutInDays <= 7;
              return (
                <div
                  key={idx}
                  className={`flex items-center justify-between text-[11px] rounded px-2 py-1 ${
                    overdue ? 'bg-red-900/30 text-red-300' : soon ? 'bg-amber-900/20 text-amber-300' : 'text-dark-300'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-dark-500 shrink-0">#{cut.roomNumber}</span>
                    <span className="font-medium truncate">{cut.strain}</span>
                    <span className="text-dark-500">×</span>
                    <span className="font-semibold">{cut.quantity}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px]">
                    <span>{formatDate(cut.cutDate)}</span>
                    {cut.cutInDays != null && (
                      <span className={overdue ? 'font-semibold' : ''}>
                        {overdue
                          ? t('motherRoom.overdueBy', { days: -cut.cutInDays })
                          : cut.cutInDays === 0
                            ? t('motherRoom.today')
                            : t('motherRoom.inDays', { days: cut.cutInDays })}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="text-[11px] text-dark-500 italic">{t('motherRoom.noCutsPlanned')}</div>
      )}

      {/* Per-room planning cards */}
      <div className="space-y-3">
        {sortedRooms.map(room => (
          <RoomPlanRow
            key={room._id}
            room={room}
            onSave={(order, patch) => savePlan(room._id, order, patch)}
            saving={saving}
            t={t}
          />
        ))}
      </div>
    </div>
  );
}

function RoomPlanRow({ room, onSave, saving, t }) {
  const { current, next, nextPlus } = useMemo(() => computeCyclesForRoom(room), [room]);
  const pipelineSummary = useMemo(() => summarizePipeline(room.pipeline), [room.pipeline]);
  const key0 = `${room._id}_0`;
  const key1 = `${room._id}_1`;

  return (
    <div className="border border-dark-700 rounded-lg p-3 bg-dark-900/20">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
        <div className="text-sm text-white font-medium">
          <span className="text-dark-500 mr-1">#{room.roomNumber}</span>
          {room.name || `${t('motherRoom.roomShort')} ${room.roomNumber}`}
        </div>
        {!room.isActive && (
          <span className="text-[10px] text-dark-500 uppercase">{t('motherRoom.roomInactive')}</span>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <CurrentCycleCard cycle={current} t={t} />
        <PlannedCycleCard
          cycle={next}
          pipelineSummary={pipelineSummary}
          title={t('motherRoom.cycleNext')}
          cutLabel={t('motherRoom.cutDate')}
          onSave={(patch) => onSave(0, patch)}
          saving={saving[key0]}
          t={t}
        />
        <PlannedCycleCard
          cycle={nextPlus}
          pipelineSummary={null}
          title={t('motherRoom.cycleNextPlus')}
          cutLabel={t('motherRoom.cutDate')}
          onSave={(patch) => onSave(1, patch)}
          saving={saving[key1]}
          t={t}
        />
      </div>
    </div>
  );
}

function CurrentCycleCard({ cycle, t }) {
  const daysLeft = cycle.endDate ? diffDays(new Date(), cycle.endDate) : null;
  const rows = cycle.strainRows || [];
  const hasRows = rows.length > 0;

  return (
    <div className="border border-dark-700 rounded p-2 bg-dark-800/40">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] uppercase text-dark-500 font-semibold">{t('motherRoom.cycleCurrent')}</span>
        {cycle.startDate ? (
          <span className="text-[10px] text-dark-600">{formatDate(cycle.endDate)}</span>
        ) : (
          <span className="text-[10px] text-dark-600">{t('motherRoom.notStarted')}</span>
        )}
      </div>

      {hasRows ? (
        <div className="flex flex-col gap-0.5 text-[11px]">
          {rows.map((row, i) => (
            <div key={i} className="flex items-center justify-between gap-2">
              <span className="text-white font-medium truncate">{row.strain || '—'}</span>
              <span className="text-dark-300 shrink-0">{row.quantity || 0}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-white text-sm font-medium truncate">—</div>
      )}

      <div className="text-[11px] text-dark-400 flex items-center justify-between mt-1 pt-1 border-t border-dark-700/60">
        <span>{t('motherRoom.totalPlants')}: <span className="text-white">{cycle.plantsCount || 0}</span></span>
        {daysLeft != null && (
          <span className={daysLeft < 0 ? 'text-red-400' : daysLeft <= 28 ? 'text-amber-400' : 'text-dark-400'}>
            {daysLeft < 0 ? t('motherRoom.overdueBy', { days: -daysLeft }) : t('motherRoom.daysLeft', { days: daysLeft })}
          </span>
        )}
      </div>
    </div>
  );
}

function PlannedCycleCard({ cycle, pipelineSummary, title, cutLabel, onSave, saving, t }) {
  // Local form state
  const [strainRows, setStrainRows] = useState(cycle.strainRows);
  const [plannedStartDate, setPlannedStartDate] = useState(isoDate(cycle.plannedStartDate));
  const [cutLeadDays, setCutLeadDays] = useState(cycle.cutLeadDays ?? DEFAULT_CUT_LEAD_DAYS);

  // Keep in sync when parent data refreshes (after a save)
  const lastServerRef = useRef({
    strainRows: cycle.strainRows,
    plannedStartDate: isoDate(cycle.plannedStartDate),
    cutLeadDays: cycle.cutLeadDays ?? DEFAULT_CUT_LEAD_DAYS,
  });
  useEffect(() => {
    lastServerRef.current = {
      strainRows: cycle.strainRows,
      plannedStartDate: isoDate(cycle.plannedStartDate),
      cutLeadDays: cycle.cutLeadDays ?? DEFAULT_CUT_LEAD_DAYS,
    };
    setStrainRows(cycle.strainRows);
    setPlannedStartDate(isoDate(cycle.plannedStartDate));
    setCutLeadDays(cycle.cutLeadDays ?? DEFAULT_CUT_LEAD_DAYS);
  }, [cycle.strainRows, cycle.plannedStartDate, cycle.cutLeadDays]);

  // Debounced autosave
  const saveTimer = useRef(null);
  const scheduleSave = (nextRows, nextDate, nextLeadDays) => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      onSave({
        strains: nextRows.filter(r => r.strain || r.quantity > 0),
        plannedStartDate: nextDate || null,
        floweringDays: cycle.floweringDays || 56,
        cutLeadDays: Number.isFinite(nextLeadDays) ? nextLeadDays : DEFAULT_CUT_LEAD_DAYS,
      });
    }, 500);
  };
  useEffect(() => () => clearTimeout(saveTimer.current), []);

  // Strain row handlers
  const updateRow = (idx, patch) => {
    const next = strainRows.map((r, i) => (i === idx ? { ...r, ...patch } : r));
    setStrainRows(next);
    scheduleSave(next, plannedStartDate, cutLeadDays);
  };
  const addRow = () => {
    const next = [...strainRows, { strain: '', quantity: 0 }];
    setStrainRows(next);
    // Don't save yet — user hasn't filled in data
  };
  const removeRow = (idx) => {
    const next = strainRows.filter((_, i) => i !== idx);
    setStrainRows(next);
    scheduleSave(next, plannedStartDate, cutLeadDays);
  };

  const hasPipeline = pipelineSummary && !pipelineSummary.empty;
  const overdue = !hasPipeline && cycle.cutInDays != null && cycle.cutInDays < 0;
  const soon = !hasPipeline && cycle.cutInDays != null && cycle.cutInDays >= 0 && cycle.cutInDays <= 7;

  // Ensure there's always at least one empty row to edit when plan view is shown
  const displayRows = strainRows.length > 0 ? strainRows : [{ strain: '', quantity: 0 }];

  return (
    <div className="border border-dark-700 rounded p-2 bg-dark-800/40 space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase text-dark-500 font-semibold">{title}</span>
        {saving && <span className="text-[10px] text-dark-400">…</span>}
      </div>

      {hasPipeline ? (
        // ─── Pipeline view: batches already exist for this cycle ───
        <div className="space-y-1">
          <div className="flex items-baseline gap-1.5">
            <span className="text-lg font-bold text-green-400">{pipelineSummary.total}</span>
            <span className="text-[10px] text-dark-400">{t('motherRoom.pieces')}</span>
            <span className="text-[10px] text-green-500 ml-auto">✓ {t('motherRoom.covered')}</span>
          </div>
          <div className="flex flex-wrap gap-1 text-[10px]">
            {pipelineSummary.totalCut > 0 && (
              <span className="px-1 rounded bg-blue-900/40 text-blue-400">
                {t('motherRoom.pipelineCut')} {pipelineSummary.totalCut}
              </span>
            )}
            {pipelineSummary.totalVeg > 0 && (
              <span className="px-1 rounded bg-green-900/40 text-green-400">
                {t('motherRoom.pipelineVeg')} {pipelineSummary.totalVeg}
              </span>
            )}
          </div>
          <div className="flex flex-col gap-0.5 text-[10px] text-dark-300">
            {pipelineSummary.byStrain.map(s => (
              <div key={s.strain} className="flex items-center justify-between">
                <span className="truncate">{s.strain}</span>
                <span className="text-white font-medium">{s.cut + s.veg}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        // ─── Plan view: editable strain rows + dates ───
        <div className="space-y-1">
          {displayRows.map((row, idx) => (
            <div key={idx} className="flex items-center gap-1">
              <StrainSelect
                value={row.strain}
                onChange={(v) => updateRow(idx, { strain: v })}
                className="flex-1 min-w-0 text-xs"
              />
              <input
                type="number"
                min={0}
                value={row.quantity}
                onChange={e => updateRow(idx, { quantity: parseInt(e.target.value, 10) || 0 })}
                placeholder={t('motherRoom.clonesCount')}
                className="w-14 bg-dark-700 border border-dark-600 rounded px-1.5 py-1 text-white text-xs text-center shrink-0"
              />
              {displayRows.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeRow(idx)}
                  className="text-dark-500 hover:text-red-400 text-sm leading-none px-1 shrink-0"
                  title={t('common.delete')}
                >×</button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={addRow}
            className="text-[10px] text-primary-400 hover:text-primary-300"
          >
            + {t('motherRoom.addStrain')}
          </button>

          <div className="flex items-center gap-1 pt-0.5">
            <input
              type="date"
              value={plannedStartDate}
              onChange={e => {
                setPlannedStartDate(e.target.value);
                scheduleSave(strainRows, e.target.value, cutLeadDays);
              }}
              className="flex-1 min-w-0 bg-dark-700 border border-dark-600 rounded px-2 py-1 text-white text-[11px]"
              title={t('motherRoom.plannedStartDate', 'Дата старта')}
            />
            <div className="flex items-center gap-0.5 shrink-0" title={t('motherRoom.cutLeadDaysHint')}>
              <span className="text-[10px] text-dark-500">−</span>
              <input
                type="number"
                min={1}
                max={365}
                value={cutLeadDays}
                onChange={e => {
                  const v = parseInt(e.target.value, 10) || DEFAULT_CUT_LEAD_DAYS;
                  setCutLeadDays(v);
                  scheduleSave(strainRows, plannedStartDate, v);
                }}
                className="w-10 bg-dark-700 border border-dark-600 rounded px-1 py-1 text-white text-[11px] text-center"
              />
              <span className="text-[10px] text-dark-500">{t('motherRoom.daysShort')}</span>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between text-[11px] pt-0.5">
        <span className="text-dark-500">{cutLabel}:</span>
        <div className="flex items-center gap-1.5">
          <span className={hasPipeline ? 'text-dark-500 line-through' : 'text-white'}>
            {formatDate(cycle.cutDate)}
          </span>
          {!hasPipeline && cycle.cutInDays != null && (
            <span className={`text-[10px] px-1 rounded ${
              overdue ? 'bg-red-900/40 text-red-400' : soon ? 'bg-amber-900/30 text-amber-400' : 'text-dark-500'
            }`}>
              {overdue
                ? t('motherRoom.overdueBy', { days: -cycle.cutInDays })
                : cycle.cutInDays === 0
                  ? t('motherRoom.today')
                  : t('motherRoom.inDays', { days: cycle.cutInDays })}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
