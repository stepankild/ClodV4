import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { roomService } from '../../services/roomService';
import { cloneCutService } from '../../services/cloneCutService';
import { vegBatchService } from '../../services/vegBatchService';


const WEEKS_BEFORE_CLONE = 4;
const DAYS_BEFORE_CUT = WEEKS_BEFORE_CLONE * 7;

const getCutDateForRoom = (room) => {
  if (room.plannedCycle?.plannedStartDate) {
    const d = new Date(room.plannedCycle.plannedStartDate);
    d.setDate(d.getDate() - DAYS_BEFORE_CUT);
    return d;
  }
  if (room.isActive && room.expectedHarvestDate) {
    const d = new Date(room.expectedHarvestDate);
    d.setDate(d.getDate() - DAYS_BEFORE_CUT);
    return d;
  }
  return null;
};

const getDaysUntilCut = (cutDate) => {
  if (!cutDate) return null;
  const cut = new Date(cutDate);
  cut.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.floor((cut - today) / (24 * 60 * 60 * 1000));
};

// ── Urgency helpers ──
const getProgressColor = (progress) => {
  if (progress >= 95) return 'bg-red-500';
  if (progress >= 80) return 'bg-yellow-500';
  return 'bg-primary-500';
};

const getBorderColor = (room) => {
  if (!room.isActive) return 'border-dark-700';
  const p = room.progress ?? 0;
  if (p >= 95) return 'border-red-700/60';
  if (p >= 80) return 'border-yellow-700/40';
  return 'border-primary-700/40';
};

const Overview = () => {
  const { t, i18n } = useTranslation();

  const formatDate = (date) => {
    if (!date) return '—';
    return new Date(date).toLocaleDateString(i18n.language === 'en' ? 'en-US' : 'ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
  };

  const formatNum = (n) => (n != null && Number.isFinite(n) ? Number(n).toLocaleString(i18n.language === 'en' ? 'en-US' : 'ru-RU') : '—');

  const [rooms, setRooms] = useState([]);
  const safeRooms = (Array.isArray(rooms) ? rooms : []).filter((r) => r != null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cloneCuts, setCloneCuts] = useState([]);
  const [vegBatches, setVegBatches] = useState([]);
  const [expandedNotes, setExpandedNotes] = useState({});

  const toggleNotes = (roomId) => {
    setExpandedNotes(prev => ({ ...prev, [roomId]: !prev[roomId] }));
  };

  useEffect(() => { loadSummary(); }, []);

  const loadSummary = async () => {
    try {
      setLoading(true);
      setError('');
      const [data, cuts, deletedCuts, vegs, deletedVegs] = await Promise.all([
        roomService.getRoomsSummary(),
        cloneCutService.getAll().catch(() => []),
        cloneCutService.getDeleted().catch(() => []),
        vegBatchService.getAll().catch(() => []),
        vegBatchService.getDeleted().catch(() => [])
      ]);
      setRooms(Array.isArray(data) ? data : []);
      const allCuts = [
        ...(Array.isArray(cuts) ? cuts : []),
        ...(Array.isArray(deletedCuts) ? deletedCuts : [])
      ];
      setCloneCuts(allCuts);
      const allVegs = [
        ...(Array.isArray(vegs) ? vegs : []),
        ...(Array.isArray(deletedVegs) ? deletedVegs : [])
      ];
      setVegBatches(allVegs);
    } catch (err) {
      const msg = err.response?.data?.message || err.message;
      const isNetwork = err.code === 'ECONNREFUSED' || err.message?.includes('Network Error');
      setError(isNetwork ? t('overview.networkError') : msg || t('overview.loadError'));
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500" />
      </div>
    );
  }

  // ── Computed data ──
  const safeVegBatches = Array.isArray(vegBatches) ? vegBatches : [];
  const safeCloneCuts = Array.isArray(cloneCuts) ? cloneCuts : [];

  const activeRooms = safeRooms.filter(r => r.isActive);
  const flowerPlants = activeRooms.reduce((s, r) => s + (r.plantsCount || 0), 0);

  // Veg plants: active (not deleted, not transplanted to flower) batches
  const activeVegBatches = safeVegBatches.filter(b => !b.deletedAt && !b.transplantedToFlowerAt);
  const vegPlants = activeVegBatches.reduce((s, b) => {
    const total = b.strains?.length > 0
      ? b.strains.reduce((ss, st) => ss + (st.quantity || 0), 0)
      : (b.quantity || 0);
    return s + total - (b.diedCount || 0) - (b.notGrownCount || 0) - (b.sentToFlowerCount || 0) - (b.disposedCount || 0);
  }, 0);

  // Clone plants: done (not deleted) batches that haven't been transplanted to veg yet
  const activeCloneCuts = safeCloneCuts.filter(c => !c.deletedAt && c.isDone && !safeVegBatches.some(
    v => String(v.sourceCloneCut?._id || v.sourceCloneCut || '') === String(c._id)
  ));
  const clonePlants = activeCloneCuts.reduce((s, c) => {
    return s + (c.strains?.length > 0
      ? c.strains.reduce((ss, st) => ss + (st.quantity || 0), 0)
      : (c.quantity || 0));
  }, 0);

  const totalPlants = flowerPlants + Math.max(0, vegPlants) + clonePlants;
  const nearestHarvest = activeRooms
    .filter(r => r.expectedHarvestDate)
    .sort((a, b) => new Date(a.expectedHarvestDate) - new Date(b.expectedHarvestDate))[0] || null;

  const nearestDays = nearestHarvest?.daysRemaining;

  // Alerts — things requiring attention
  const alerts = [];

  const findCurrentCut = (room) => {
    const cutDate = getCutDateForRoom(room);
    const roomCuts = safeCloneCuts
      .filter(c => !c.deletedAt && String(c.room?._id || c.room || '') === String(room._id))
      .sort((a, b) => new Date(b.cutDate) - new Date(a.cutDate));
    if (!cutDate || roomCuts.length === 0) return roomCuts[0] || null;
    const target = new Date(cutDate).getTime();
    const margin = 60 * 24 * 60 * 60 * 1000;
    return roomCuts.find(c => Math.abs(new Date(c.cutDate).getTime() - target) <= margin) || null;
  };

  const hasVegBatchForRoom = (room) => {
    const cutDate = getCutDateForRoom(room);
    const allRoomCuts = safeCloneCuts
      .filter(c => String(c.room?._id || c.room || '') === String(room._id));
    if (allRoomCuts.length === 0) return false;
    let relevantCuts = allRoomCuts;
    if (cutDate) {
      const target = new Date(cutDate).getTime();
      const margin = 60 * 24 * 60 * 60 * 1000;
      relevantCuts = allRoomCuts.filter(c => Math.abs(new Date(c.cutDate).getTime() - target) <= margin);
    }
    const relevantCutIds = new Set(relevantCuts.map(c => String(c._id)));
    return safeVegBatches.some(b =>
      !b.deletedAt &&
      !b.transplantedToFlowerAt &&
      relevantCutIds.has(String(b.sourceCloneCut?._id || b.sourceCloneCut || ''))
    );
  };

  safeRooms.forEach(room => {
    const cutDate = getCutDateForRoom(room);
    if (!cutDate) return;
    const daysUntil = getDaysUntilCut(cutDate);
    const cut = findCurrentCut(room);
    const isDone = cut?.isDone ?? false;
    const hasTransplanted = hasVegBatchForRoom(room);
    if (!isDone && !hasTransplanted && daysUntil !== null && daysUntil <= 3) {
      alerts.push({
        type: daysUntil < 0 ? 'danger' : 'warning',
        icon: '✂️',
        text: daysUntil < 0
          ? t('overview.alerts.clonesOverdue', { name: room.name, days: -daysUntil })
          : daysUntil === 0
            ? t('overview.alerts.clonesToday', { name: room.name })
            : t('overview.alerts.clonesIn', { name: room.name, days: daysUntil }),
        link: '/clones'
      });
    }
  });

  // Rooms ready to harvest
  activeRooms.forEach(room => {
    if ((room.progress ?? 0) >= 100) {
      alerts.push({
        type: 'danger',
        icon: '🌿',
        text: t('overview.alerts.readyToHarvest', { name: room.name, currentDay: room.currentDay, floweringDays: room.floweringDays }),
        link: '/harvest'
      });
    }
  });

  // Rooms missing lamp data
  const roomsMissingLamps = safeRooms.filter(r =>
    r.isActive && (!r.lighting?.lampCount || !r.lighting?.lampWattage)
  );
  if (roomsMissingLamps.length > 0) {
    const names = roomsMissingLamps.map(r => r.name).join(', ');
    alerts.push({
      type: 'warning',
      icon: '💡',
      text: roomsMissingLamps.length === 1
        ? t('overview.alerts.lampsNotSet', { names })
        : t('overview.alerts.lampsNotSetMultiple', { names }),
      link: '/active'
    });
  }

  // Overdue pending tasks
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  safeRooms.forEach(room => {
    (room.pendingTasks || []).forEach(task => {
      if (task.scheduledDate && new Date(task.scheduledDate) < today) {
        alerts.push({
          type: 'warning',
          icon: '⚠️',
          text: t('overview.alerts.taskOverdue', { name: room.name, title: task.title }),
          link: '/active'
        });
      }
    });
  });

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">{t('overview.title')}</h1>
        <p className="text-dark-400 mt-1 text-sm">{t('overview.subtitle')} <Link to="/active" className="text-primary-400 hover:text-primary-300">{t('overview.activeRoomsLink')}</Link></p>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-800 text-red-400 px-4 py-3 rounded-lg mb-6 flex flex-wrap items-center gap-3">
          <span>{error}</span>
          <button type="button" onClick={() => { setError(''); loadSummary(); }} className="px-3 py-1.5 bg-red-800/50 hover:bg-red-700/50 rounded-lg text-sm font-medium">
            {t('overview.retry')}
          </button>
        </div>
      )}

      {/* Farm summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        <div className="bg-dark-800 rounded-xl border border-dark-700 p-4">
          <div className="text-dark-400 text-xs font-medium">{t('overview.stats.active')}</div>
          <div className="text-xl font-bold text-primary-400 mt-0.5">{activeRooms.length}<span className="text-dark-500 text-sm font-normal"> / {safeRooms.length}</span></div>
        </div>
        <div className="bg-dark-800 rounded-xl border border-dark-700 p-4">
          <div className="text-dark-400 text-xs font-medium">{t('overview.stats.plants')}</div>
          <div className="text-xl font-bold text-green-400 mt-0.5">{totalPlants > 0 ? formatNum(totalPlants) : '—'}</div>
          {totalPlants > 0 && (
            <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-1">
              {flowerPlants > 0 && <span className="text-xs text-purple-400">🌸 {flowerPlants}</span>}
              {vegPlants > 0 && <span className="text-xs text-emerald-400">🌱 {Math.max(0, vegPlants)}</span>}
              {clonePlants > 0 && <span className="text-xs text-blue-400">✂️ {clonePlants}</span>}
            </div>
          )}
        </div>
        <div className="bg-dark-800 rounded-xl border border-dark-700 p-4">
          <div className="text-dark-400 text-xs font-medium">{t('overview.stats.nearestHarvest')}</div>
          <div className="text-xl font-bold text-white mt-0.5">
            {nearestDays != null ? (
              nearestDays <= 0 ? <span className="text-red-400">{t('overview.stats.harvestNow')}</span> : t('overview.stats.daysShort', { days: nearestDays })
            ) : '—'}
          </div>
          {nearestHarvest && <p className="text-dark-500 text-xs mt-0.5">{nearestHarvest.name}</p>}
        </div>
        <div className="bg-dark-800 rounded-xl border border-dark-700 p-4">
          <div className="text-dark-400 text-xs font-medium">{t('overview.stats.strainsFlowering')}</div>
          <div className="text-xl font-bold text-purple-400 mt-0.5">
            {[...new Set(activeRooms.map(r => r.strain).filter(Boolean))].length || '—'}
          </div>
        </div>
        <div className="bg-dark-800 rounded-xl border border-dark-700 p-4">
          <div className="text-dark-400 text-xs font-medium">{t('overview.stats.pendingTasks')}</div>
          <div className="text-xl font-bold text-white mt-0.5">
            {safeRooms.reduce((s, r) => s + (r.pendingTasks?.length || 0), 0) || '—'}
          </div>
        </div>
      </div>

      {/* Alerts */}
      {alerts.length > 0 && (
        <div className="mb-6 space-y-2">
          {alerts.map((a, i) => (
            <Link
              key={i}
              to={a.link}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition hover:brightness-110 ${
                a.type === 'danger'
                  ? 'bg-red-900/20 border-red-700/50 text-red-300'
                  : 'bg-yellow-900/20 border-yellow-700/50 text-yellow-300'
              }`}
            >
              <span className="text-lg shrink-0">{a.icon}</span>
              <span className="text-sm font-medium">{a.text}</span>
              <svg className="w-4 h-4 ml-auto shrink-0 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          ))}
        </div>
      )}

      {/* Room cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
        {safeRooms.map((room) => {
          const cutDate = getCutDateForRoom(room);
          const daysUntilCut = cutDate ? getDaysUntilCut(cutDate) : null;
          const cut = findCurrentCut(room);
          const hasTransplantedRoom = hasVegBatchForRoom(room);
          const clonesDone = (cut?.isDone ?? false) || hasTransplantedRoom;
          const hasCutPlan = cutDate != null;

          return (
            <div key={room._id} className={`bg-dark-800 rounded-xl border ${getBorderColor(room)} overflow-hidden transition hover:border-dark-500`}>
              {/* Card header */}
              <div className="px-4 pt-4 pb-2 flex items-start justify-between">
                <div className="min-w-0">
                  <Link to="/active" className="text-base font-semibold text-white hover:text-primary-400 transition block truncate">
                    {room.name}
                  </Link>
                  {room.isActive ? (
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-primary-400 text-sm font-medium truncate">{room.strain || room.cycleName || '—'}</span>
                      {room.plantsCount > 0 && (
                        <span className="text-dark-500 text-xs shrink-0">{t('overview.card.plantsCount', { count: room.plantsCount })}</span>
                      )}
                    </div>
                  ) : (
                    <span className="text-dark-500 text-xs">{t('overview.card.noCycle')}</span>
                  )}
                </div>
                {room.isActive ? (
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium shrink-0 ml-2">
                    <span className="w-2 h-2 rounded-full bg-primary-500 animate-pulse" />
                    <span className="text-primary-400">{t('overview.card.flowering')}</span>
                  </span>
                ) : (
                  <span className="text-dark-600 text-xs shrink-0 ml-2">{t('overview.card.free')}</span>
                )}
              </div>

              {/* Room info badges */}
              {(room.squareMeters > 0 || room.lighting?.lampType) && (
                <div className="px-4 pb-2 flex flex-wrap gap-1.5">
                  {room.squareMeters > 0 && (
                    <span className="px-2 py-0.5 bg-dark-700 rounded text-dark-400 text-xs">{t('overview.card.greenArea', { area: room.squareMeters })}</span>
                  )}
                  {room.lighting?.lampType && (
                    <span className="px-2 py-0.5 bg-dark-700 rounded text-dark-400 text-xs">{room.lighting.lampType}</span>
                  )}
                </div>
              )}

              {/* Active cycle content */}
              {room.isActive && (
                <div className="px-4 pb-3">
                  {/* Progress bar */}
                  <div className="mb-3">
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-dark-400">
                        {t('overview.card.day')} <span className="text-white font-medium">{room.currentDay ?? 0}</span>
                        <span className="text-dark-600"> / {room.floweringDays ?? '?'}</span>
                      </span>
                      <span className={`font-medium ${(room.progress ?? 0) >= 95 ? 'text-red-400' : (room.progress ?? 0) >= 80 ? 'text-yellow-400' : 'text-primary-400'}`}>
                        {room.progress ?? 0}%
                      </span>
                    </div>
                    <div className="h-2 bg-dark-700 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${getProgressColor(room.progress ?? 0)}`}
                        style={{ width: `${Math.min(room.progress ?? 0, 100)}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-xs text-dark-500 mt-1">
                      <span>{t('overview.card.harvest')}: {formatDate(room.expectedHarvestDate)}</span>
                      {room.daysRemaining != null && room.daysRemaining >= 0 && (
                        <span className={room.daysRemaining <= 3 ? 'text-red-400 font-medium' : ''}>
                          {room.daysRemaining === 0 ? t('overview.card.today') : t('overview.stats.daysShort', { days: room.daysRemaining })}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Milestones — compact row */}
                  {(() => {
                    const day = room.currentDay ?? 0;
                    const trimDone = !!room.trimWeek2Done;
                    const defolDone = !!room.defoliationWeek4Done;
                    return (
                      <div className="flex gap-2 mb-3">
                        <div className={`flex-1 rounded-lg px-2.5 py-1.5 text-xs ${trimDone ? 'bg-green-900/30 text-green-400' : day >= 14 ? 'bg-red-900/20 text-red-400' : 'bg-dark-700/50 text-dark-400'}`}>
                          <div className="font-medium">{t('overview.card.trimming')}</div>
                          <div>{trimDone ? formatDate(room.trimWeek2Done) : day >= 14 ? t('overview.card.overdue') : t('overview.card.inDays', { days: 14 - day })}</div>
                        </div>
                        <div className={`flex-1 rounded-lg px-2.5 py-1.5 text-xs ${defolDone ? 'bg-green-900/30 text-green-400' : day >= 28 ? 'bg-red-900/20 text-red-400' : 'bg-dark-700/50 text-dark-400'}`}>
                          <div className="font-medium">{t('overview.card.defoliation')}</div>
                          <div>{defolDone ? formatDate(room.defoliationWeek4Done) : day >= 28 ? t('overview.card.overdue') : t('overview.card.inDays', { days: 28 - day })}</div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Completed tasks — compact chips */}
                  {room.completedTasks && Object.keys(room.completedTasks).length > 0 && (
                    <div className="border-t border-dark-700 pt-2 mb-2">
                      <div className="text-xs text-dark-500 mb-1.5">{t('overview.card.completed')}</div>
                      <div className="flex flex-wrap gap-1">
                        {room.completedTasks.net?.length > 0 && (
                          <span className="px-2 py-0.5 bg-green-900/30 text-green-400 rounded text-xs">{t('overview.card.nets')}</span>
                        )}
                        {room.completedTasks.spray?.map((task, i) => (
                          <span key={`sp-${i}`} className="px-2 py-0.5 bg-blue-900/30 text-blue-400 rounded text-xs truncate max-w-[140px]">
                            {task.sprayProduct || t('overview.card.spray')}
                          </span>
                        ))}
                        {room.completedTasks.feed?.map((task, i) => (
                          <span key={`fd-${i}`} className="px-2 py-0.5 bg-emerald-900/30 text-emerald-400 rounded text-xs truncate max-w-[140px]">
                            {task.feedProduct || t('overview.card.feeding')}
                          </span>
                        ))}
                        {room.completedTasks.trim?.length > 0 && (
                          <span className="px-2 py-0.5 bg-purple-900/30 text-purple-400 rounded text-xs">
                            {t('overview.card.trimmingCount', { count: room.completedTasks.trim.length })}
                          </span>
                        )}
                        {room.completedTasks.defoliation?.length > 0 && (
                          <span className="px-2 py-0.5 bg-yellow-900/30 text-yellow-400 rounded text-xs">
                            {t('overview.card.defoliationCount', { count: room.completedTasks.defoliation.length })}
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Pending tasks — compact */}
                  {room.pendingTasks?.length > 0 && (
                    <div className="border-t border-dark-700 pt-2 mb-2">
                      <div className="text-xs text-dark-500 mb-1">{t('overview.card.scheduled', { count: room.pendingTasks.length })}</div>
                      <div className="space-y-0.5">
                        {room.pendingTasks.slice(0, 3).map(task => {
                          const isOverdue = task.scheduledDate && new Date(task.scheduledDate) < today;
                          return (
                            <div key={task._id} className="flex items-center gap-1.5 text-xs">
                              <span className={isOverdue ? 'text-red-400' : 'text-dark-500'}>○</span>
                              <span className={`truncate ${isOverdue ? 'text-red-400' : 'text-dark-400'}`}>{task.title}</span>
                              {task.scheduledDate && (
                                <span className={`ml-auto shrink-0 ${isOverdue ? 'text-red-500' : 'text-dark-600'}`}>{formatDate(task.scheduledDate)}</span>
                              )}
                            </div>
                          );
                        })}
                        {room.pendingTasks.length > 3 && (
                          <div className="text-xs text-dark-600">{t('overview.card.more', { count: room.pendingTasks.length - 3 })}</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Card footer — last archive, planned, notes, clone plan */}
              <div className="px-4 pb-3 space-y-2">
                {/* Clone cut status for this room */}
                {hasCutPlan && (
                  <div className={`flex items-center justify-between gap-2 text-xs rounded-lg px-2.5 py-1.5 ${
                    clonesDone ? 'bg-green-900/20 text-green-400'
                      : daysUntilCut !== null && daysUntilCut < 0 ? 'bg-red-900/20 text-red-400'
                      : daysUntilCut !== null && daysUntilCut <= 7 ? 'bg-yellow-900/20 text-yellow-400'
                      : 'bg-dark-700/30 text-dark-400'
                  }`}>
                    <span className="font-medium">{t('overview.card.clonesLabel')}</span>
                    <span>
                      {hasTransplantedRoom ? t('overview.card.inVeg') :
                        clonesDone ? t('overview.card.clonesCut') :
                        daysUntilCut === null ? '—' :
                        daysUntilCut < 0 ? t('overview.card.overdueByDays', { days: -daysUntilCut }) :
                        daysUntilCut === 0 ? t('overview.card.today') :
                        t('overview.card.inDays', { days: daysUntilCut })}
                    </span>
                  </div>
                )}

                {/* Last archive */}
                {room.lastArchive && (
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-dark-500">{t('overview.card.previous')}:</span>
                    <Link to={`/archive/${room.lastArchive._id}`} className="text-primary-400 hover:text-primary-300 truncate text-right">
                      {room.lastArchive.strain || room.lastArchive.cycleName || t('overview.card.cycle')}
                      {room.lastArchive.harvestData?.dryWeight > 0 && ` · ${room.lastArchive.harvestData.dryWeight}${t('overview.card.grams')}`}
                    </Link>
                  </div>
                )}

                {/* Planned cycle */}
                {room.plannedCycle && (
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-dark-500">{t('overview.card.plan')}:</span>
                    <span className="text-dark-300 truncate text-right">
                      {room.plannedCycle.strain || room.plannedCycle.cycleName || t('overview.card.cycle')}
                      {room.plannedCycle.plannedStartDate && ` · ${formatDate(room.plannedCycle.plannedStartDate)}`}
                    </span>
                  </div>
                )}

                {/* Notes toggle */}
                {room.notes && (
                  <div>
                    <button
                      onClick={(e) => { e.preventDefault(); toggleNotes(room._id); }}
                      className="flex items-center gap-1.5 text-xs text-dark-500 hover:text-dark-300 w-full text-left"
                    >
                      <span className={`transition-transform inline-block ${expandedNotes[room._id] ? 'rotate-90' : ''}`} style={{ fontSize: '8px' }}>▶</span>
                      {t('overview.card.notes')}
                    </button>
                    {expandedNotes[room._id] && (
                      <p className="text-xs text-dark-300 mt-1.5 whitespace-pre-wrap bg-dark-700/30 rounded-lg p-2 max-h-24 overflow-y-auto">
                        {room.notes}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Quick links */}
      <div className="mt-6 flex flex-wrap gap-3">
        <Link to="/active" className="px-4 py-2 bg-dark-800 border border-dark-700 rounded-lg text-primary-400 hover:border-primary-700/50 transition text-sm font-medium">
          {t('overview.links.activeRooms')} →
        </Link>
        <Link to="/clones" className="px-4 py-2 bg-dark-800 border border-dark-700 rounded-lg text-primary-400 hover:border-primary-700/50 transition text-sm font-medium">
          {t('overview.links.clones')} →
        </Link>
        <Link to="/statistics" className="px-4 py-2 bg-dark-800 border border-dark-700 rounded-lg text-primary-400 hover:border-primary-700/50 transition text-sm font-medium">
          {t('overview.links.statistics')} →
        </Link>
        <Link to="/archive" className="px-4 py-2 bg-dark-800 border border-dark-700 rounded-lg text-primary-400 hover:border-primary-700/50 transition text-sm font-medium">
          {t('overview.links.archive')} →
        </Link>
      </div>
    </div>
  );
};

export default Overview;
