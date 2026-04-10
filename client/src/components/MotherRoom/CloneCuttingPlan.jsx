import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { roomService } from '../../services/roomService';
import StrainSelect from '../StrainSelect';

const CUT_LEAD_DAYS = 28; // 4 weeks
const ONE_DAY = 24 * 60 * 60 * 1000;

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
 * Computes the three cycle slots for a room and the cut event associated with each
 * planned cycle. Cut rule: clones are cut CUT_LEAD_DAYS (28) before the END of the
 * CURRENT cycle (for slot "next"), and 28 days before the end of the "next" cycle
 * (for slot "next+1").
 */
function computeCyclesForRoom(room) {
  const now = new Date();

  // Current cycle — read from FlowerRoom
  const current = {
    kind: 'current',
    strain: room.strain || '',
    plantsCount: room.plantsCount || 0,
    startDate: room.startDate || null,
    floweringDays: room.floweringDays || 56,
  };
  current.endDate = current.startDate
    ? addDays(current.startDate, current.floweringDays)
    : null;

  // Next planned cycle (order 0)
  const planOrder0 = (room.plannedCycles || []).find(p => (p.order ?? 0) === 0) || null;
  const next = planOrder0
    ? {
        kind: 'next',
        _id: planOrder0._id,
        strain: planOrder0.strain || '',
        plantsCount: planOrder0.plantsCount || 0,
        plannedStartDate: planOrder0.plannedStartDate || null,
        floweringDays: planOrder0.floweringDays || 56,
      }
    : { kind: 'next', strain: '', plantsCount: 0, plannedStartDate: null, floweringDays: 56 };

  // Clones for NEXT are cut 4 weeks before the CURRENT cycle ends
  next.cutDate = current.endDate ? addDays(current.endDate, -CUT_LEAD_DAYS) : null;
  // Default start = current cycle's end (chain) if not explicitly set
  next.effectiveStartDate = next.plannedStartDate || current.endDate || null;
  next.endDate = next.effectiveStartDate ? addDays(next.effectiveStartDate, next.floweringDays) : null;

  // Next+1 planned cycle (order 1)
  const planOrder1 = (room.plannedCycles || []).find(p => (p.order ?? 0) === 1) || null;
  const nextPlus = planOrder1
    ? {
        kind: 'nextPlus',
        _id: planOrder1._id,
        strain: planOrder1.strain || '',
        plantsCount: planOrder1.plantsCount || 0,
        plannedStartDate: planOrder1.plannedStartDate || null,
        floweringDays: planOrder1.floweringDays || 56,
      }
    : { kind: 'nextPlus', strain: '', plantsCount: 0, plannedStartDate: null, floweringDays: 56 };

  // Clones for NEXT+1 are cut 4 weeks before NEXT ends
  nextPlus.cutDate = next.endDate ? addDays(next.endDate, -CUT_LEAD_DAYS) : null;
  nextPlus.effectiveStartDate = nextPlus.plannedStartDate || next.endDate || null;
  nextPlus.endDate = nextPlus.effectiveStartDate ? addDays(nextPlus.effectiveStartDate, nextPlus.floweringDays) : null;

  // Urgency for "days until cut"
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
          plannedStartDate: saved.plannedStartDate,
          plantsCount: saved.plantsCount,
          floweringDays: saved.floweringDays,
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

  // Aggregate upcoming cuts across all rooms
  const upcomingCuts = useMemo(() => {
    const list = [];
    sortedRooms.forEach(room => {
      const { next, nextPlus } = computeCyclesForRoom(room);
      [next, nextPlus].forEach(cycle => {
        if (cycle.plantsCount > 0 && cycle.strain && cycle.cutDate) {
          list.push({
            roomName: room.name || `${t('motherRoom.roomShort')} ${room.roomNumber}`,
            roomNumber: room.roomNumber,
            strain: cycle.strain,
            quantity: cycle.plantsCount,
            cutDate: cycle.cutDate,
            cutInDays: cycle.cutInDays,
            cycleKind: cycle.kind,
          });
        }
      });
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
          title={t('motherRoom.cycleNext')}
          cutLabel={t('motherRoom.cutDate')}
          onSave={(patch) => onSave(0, patch)}
          saving={saving[key0]}
          t={t}
        />
        <PlannedCycleCard
          cycle={nextPlus}
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
      <div className="text-white text-sm font-medium truncate">{cycle.strain || '—'}</div>
      <div className="text-[11px] text-dark-400 flex items-center justify-between mt-1">
        <span>{cycle.plantsCount || 0} {t('motherRoom.pieces')}</span>
        {daysLeft != null && (
          <span className={daysLeft < 0 ? 'text-red-400' : daysLeft <= 28 ? 'text-amber-400' : 'text-dark-400'}>
            {daysLeft < 0 ? t('motherRoom.overdueBy', { days: -daysLeft }) : t('motherRoom.daysLeft', { days: daysLeft })}
          </span>
        )}
      </div>
    </div>
  );
}

function PlannedCycleCard({ cycle, title, cutLabel, onSave, saving, t }) {
  const [strain, setStrain] = useState(cycle.strain);
  const [plantsCount, setPlantsCount] = useState(cycle.plantsCount);
  const [plannedStartDate, setPlannedStartDate] = useState(isoDate(cycle.plannedStartDate));

  // Keep in sync when parent data refreshes (after a save)
  const lastServerRef = useRef({ strain: cycle.strain, plantsCount: cycle.plantsCount, plannedStartDate: isoDate(cycle.plannedStartDate) });
  useEffect(() => {
    lastServerRef.current = {
      strain: cycle.strain,
      plantsCount: cycle.plantsCount,
      plannedStartDate: isoDate(cycle.plannedStartDate),
    };
    setStrain(cycle.strain);
    setPlantsCount(cycle.plantsCount);
    setPlannedStartDate(isoDate(cycle.plannedStartDate));
  }, [cycle.strain, cycle.plantsCount, cycle.plannedStartDate]);

  // Debounced autosave — fires 500ms after the last edit of any field
  const saveTimer = useRef(null);
  const scheduleSave = (nextStrain, nextCount, nextDate) => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const last = lastServerRef.current;
      if (nextStrain === last.strain && nextCount === last.plantsCount && nextDate === last.plannedStartDate) {
        return; // no-op
      }
      onSave({
        strain: nextStrain,
        plantsCount: nextCount,
        plannedStartDate: nextDate || null,
        floweringDays: cycle.floweringDays || 56,
      });
    }, 500);
  };
  useEffect(() => () => clearTimeout(saveTimer.current), []);

  const overdue = cycle.cutInDays != null && cycle.cutInDays < 0;
  const soon = cycle.cutInDays != null && cycle.cutInDays >= 0 && cycle.cutInDays <= 7;

  return (
    <div className="border border-dark-700 rounded p-2 bg-dark-800/40 space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase text-dark-500 font-semibold">{title}</span>
        {saving && <span className="text-[10px] text-dark-400">…</span>}
      </div>

      <StrainSelect
        value={strain}
        onChange={(v) => { setStrain(v); scheduleSave(v, plantsCount, plannedStartDate); }}
        className="w-full text-sm"
      />

      <div className="flex items-center gap-1.5">
        <input
          type="number"
          min={0}
          value={plantsCount}
          onChange={e => {
            const v = parseInt(e.target.value, 10) || 0;
            setPlantsCount(v);
            scheduleSave(strain, v, plannedStartDate);
          }}
          placeholder={t('motherRoom.clonesCount')}
          className="w-16 bg-dark-700 border border-dark-600 rounded px-2 py-1 text-white text-xs text-center"
        />
        <span className="text-[10px] text-dark-500">{t('motherRoom.pieces')}</span>
        <input
          type="date"
          value={plannedStartDate}
          onChange={e => {
            setPlannedStartDate(e.target.value);
            scheduleSave(strain, plantsCount, e.target.value);
          }}
          className="flex-1 min-w-0 bg-dark-700 border border-dark-600 rounded px-2 py-1 text-white text-[11px]"
        />
      </div>

      <div className="flex items-center justify-between text-[11px] pt-0.5">
        <span className="text-dark-500">{cutLabel}:</span>
        <div className="flex items-center gap-1.5">
          <span className="text-white">{formatDate(cycle.cutDate)}</span>
          {cycle.cutInDays != null && (
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
