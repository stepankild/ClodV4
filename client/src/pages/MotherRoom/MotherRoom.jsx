import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { motherRoomService } from '../../services/motherRoomService';
import { useAuth } from '../../context/AuthContext';
import MotherRoomMap from '../../components/MotherRoom/MotherRoomMap';
import CloneCuttingPlan from '../../components/MotherRoom/CloneCuttingPlan';
import StrainSelect from '../../components/StrainSelect';

const HEALTH_OPTIONS = ['excellent', 'good', 'satisfactory', 'poor', 'critical'];
const PRUNE_WARN_DAYS = 30;

function daysAgo(date) {
  if (!date) return null;
  return Math.floor((Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24));
}

export default function MotherRoom() {
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const canManage = hasPermission('mothers:manage');

  const [plants, setPlants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [mapData, setMapData] = useState(null);
  const [showRetired, setShowRetired] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [saveStatus, setSaveStatus] = useState('idle'); // idle | saving | saved | error

  // Modal states
  const [editPlant, setEditPlant] = useState(null);
  const [pruneModal, setPruneModal] = useState(null);
  const [retireModal, setRetireModal] = useState(null);
  const [savingAction, setSavingAction] = useState(false);

  const [form, setForm] = useState({ name: '', strain: '', plantedDate: '', health: 'good', notes: '' });
  const [pruneForm, setPruneForm] = useState({ date: '', notes: '' });
  const [retireReason, setRetireReason] = useState('');

  const loadData = useCallback(async () => {
    try {
      const [plantsData, mapRes] = await Promise.all([
        motherRoomService.getPlants({ includeRetired: true }),
        motherRoomService.getMap(),
      ]);
      setPlants(plantsData);
      setMapData(mapRes);
    } catch (err) {
      console.error('Load mother room data error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const activePlants = useMemo(() => plants.filter(p => !p.retiredAt), [plants]);
  const retiredPlants = useMemo(() => plants.filter(p => p.retiredAt), [plants]);

  // Stats
  const placedCount = mapData?.plantPositions?.length || 0;
  const unplacedCount = Math.max(0, activePlants.length - placedCount);
  const needsPruneCount = useMemo(
    () => activePlants.filter(p => {
      const d = daysAgo(p.lastPruneDate);
      return d == null || d > PRUNE_WARN_DAYS;
    }).length,
    [activePlants]
  );

  // ============ Map autosave handler ============
  const handleAutoSave = useCallback(async (data) => {
    setSaveStatus('saving');
    try {
      const res = await motherRoomService.saveMap(data);
      setMapData(res);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus(s => s === 'saved' ? 'idle' : s), 1500);
    } catch (err) {
      console.error('Autosave error:', err);
      setSaveStatus('error');
    }
  }, []);

  // ============ Quick create (from map cell click) ============
  const handleQuickCreate = useCallback(async ({ name, strain }) => {
    try {
      const created = await motherRoomService.createPlant({
        name,
        strain: strain || '',
        plantedDate: new Date().toISOString().split('T')[0],
        health: 'good',
      });
      setPlants(prev => [...prev, created]);
      return created;
    } catch (err) {
      alert(err.response?.data?.message || 'Error');
      return null;
    }
  }, []);

  // ============ Plant detail popover actions ============
  const openEditPlant = useCallback((plantOrId) => {
    const plant = typeof plantOrId === 'string' ? plants.find(p => p._id === plantOrId) : plantOrId;
    if (!plant) return;
    setForm({
      name: plant.name,
      strain: plant.strain || '',
      plantedDate: plant.plantedDate ? new Date(plant.plantedDate).toISOString().split('T')[0] : '',
      health: plant.health || 'good',
      notes: plant.notes || '',
    });
    setEditPlant(plant);
  }, [plants]);

  const openAddPlant = () => {
    setForm({ name: '', strain: '', plantedDate: new Date().toISOString().split('T')[0], health: 'good', notes: '' });
    setEditPlant({});
  };

  const handleSavePlant = async () => {
    setSavingAction(true);
    try {
      if (editPlant._id) {
        const updated = await motherRoomService.updatePlant(editPlant._id, form);
        setPlants(prev => prev.map(p => p._id === updated._id ? updated : p));
      } else {
        const created = await motherRoomService.createPlant(form);
        setPlants(prev => [...prev, created]);
      }
      setEditPlant(null);
    } catch (err) {
      alert(err.response?.data?.message || 'Error');
    } finally {
      setSavingAction(false);
    }
  };

  const openPruneModal = useCallback((plantId) => {
    setPruneForm({ date: new Date().toISOString().split('T')[0], notes: '' });
    setPruneModal(plantId);
  }, []);

  const handleRecordPrune = async () => {
    setSavingAction(true);
    try {
      const updated = await motherRoomService.recordPrune(pruneModal, pruneForm);
      setPlants(prev => prev.map(p => p._id === updated._id ? updated : p));
      setPruneModal(null);
    } catch (err) {
      alert(err.response?.data?.message || 'Error');
    } finally {
      setSavingAction(false);
    }
  };

  const openRetireModal = useCallback((plantId) => {
    setRetireReason('');
    setRetireModal(plantId);
  }, []);

  const handleRetire = async () => {
    setSavingAction(true);
    try {
      const updated = await motherRoomService.retirePlant(retireModal, retireReason);
      setPlants(prev => prev.map(p => p._id === updated._id ? updated : p));
      setRetireModal(null);
      // Reload map because backend auto-removes retired plants from positions
      const mapRes = await motherRoomService.getMap();
      setMapData(mapRes);
    } catch (err) {
      alert(err.response?.data?.message || 'Error');
    } finally {
      setSavingAction(false);
    }
  };

  const handleDeletePlant = useCallback(async (plantId) => {
    if (!confirm(t('common.confirmDelete'))) return false;
    try {
      await motherRoomService.deletePlant(plantId);
      setPlants(prev => prev.filter(p => p._id !== plantId));
      return true;
    } catch (err) {
      alert(err.response?.data?.message || 'Error');
      return false;
    }
  }, [t]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary-500 border-t-transparent"></div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold text-white">{t('motherRoom.title')}</h1>
        <div className="flex gap-2 flex-wrap items-center">
          {/* Save status indicator */}
          <SaveIndicator status={saveStatus} t={t} />
          {canManage && (
            <>
              <button
                type="button"
                onClick={openAddPlant}
                className="px-3 py-1.5 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-500 transition"
              >
                + {t('motherRoom.addPlant')}
              </button>
              <button
                type="button"
                onClick={() => setShowSetup(true)}
                className="px-3 py-1.5 text-sm bg-dark-700 text-dark-300 rounded-lg hover:bg-dark-600 transition"
                title={t('motherRoom.setupTitle')}
              >
                ⚙ {t('motherRoom.setupBtn')}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Stats bar */}
      <div className="flex flex-wrap gap-4 text-xs bg-dark-800/40 border border-dark-700 rounded-lg px-4 py-2">
        <StatItem label={t('motherRoom.totalPlants')} value={activePlants.length} />
        <StatItem
          label={t('motherRoom.needsPrune')}
          value={needsPruneCount}
          accent={needsPruneCount > 0 ? 'text-amber-400' : undefined}
        />
        <StatItem
          label={t('motherRoom.unplaced')}
          value={unplacedCount}
          accent={unplacedCount > 0 ? 'text-primary-400' : undefined}
        />
      </div>

      {/* Map (always visible) */}
      <div className="bg-dark-800 border border-dark-700 rounded-lg p-4">
        <MotherRoomMap
          mapData={mapData}
          plants={activePlants}
          canManage={canManage}
          onAutoSave={handleAutoSave}
          onQuickCreate={handleQuickCreate}
          onPlantEdit={openEditPlant}
          onPlantPrune={openPruneModal}
          onPlantRetire={openRetireModal}
          onPlantDelete={handleDeletePlant}
          saveStatus={saveStatus}
          showSetupProp={showSetup}
          onCloseSetup={() => setShowSetup(false)}
        />
      </div>

      {/* Clone cutting plan — 3 cycles per room */}
      <CloneCuttingPlan />

      {/* Retired plants (collapsed) */}
      {retiredPlants.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowRetired(!showRetired)}
            className="text-sm text-dark-400 hover:text-dark-300 transition mb-2"
          >
            {showRetired ? '▾' : '▸'} {t('motherRoom.retired')} ({retiredPlants.length})
          </button>
          {showRetired && (
            <div className="space-y-1">
              {retiredPlants.map(plant => (
                <div
                  key={plant._id}
                  className="bg-dark-800/50 border border-dark-700/50 rounded-lg px-4 py-2 flex items-center justify-between text-xs"
                >
                  <div className="flex items-center gap-3 flex-wrap min-w-0">
                    <span className="text-dark-400 font-medium">{plant.name}</span>
                    {plant.strain && <span className="text-dark-500">{plant.strain}</span>}
                    <span className="text-dark-600">
                      {t('motherRoom.retiredAt')}: {new Date(plant.retiredAt).toLocaleDateString()}
                    </span>
                    {plant.retiredReason && (
                      <span className="text-dark-500 truncate">— {plant.retiredReason}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─── Add/Edit Plant Modal ─── */}
      {editPlant !== null && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4"
          onClick={() => setEditPlant(null)}
        >
          <div
            className="bg-dark-800 border border-dark-700 rounded-xl p-6 w-full max-w-md space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <h2 className="text-white font-semibold">
              {editPlant._id ? t('motherRoom.editPlant') : t('motherRoom.addPlant')}
            </h2>

            <div className="space-y-3">
              <div>
                <label className="text-dark-400 text-xs mb-1 block">{t('motherRoom.plantName')}</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-white text-sm"
                  placeholder="M-001"
                  autoFocus
                />
              </div>

              <div>
                <label className="text-dark-400 text-xs mb-1 block">{t('motherRoom.strain')}</label>
                <StrainSelect value={form.strain} onChange={v => setForm(f => ({ ...f, strain: v }))} className="w-full" />
              </div>

              <div>
                <label className="text-dark-400 text-xs mb-1 block">{t('motherRoom.plantedDate')}</label>
                <input
                  type="date"
                  value={form.plantedDate}
                  onChange={e => setForm(f => ({ ...f, plantedDate: e.target.value }))}
                  className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-white text-sm"
                />
              </div>

              <div>
                <label className="text-dark-400 text-xs mb-1 block">{t('motherRoom.health')}</label>
                <select
                  value={form.health}
                  onChange={e => setForm(f => ({ ...f, health: e.target.value }))}
                  className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-white text-sm"
                >
                  {HEALTH_OPTIONS.map(h => (
                    <option key={h} value={h}>
                      {t(`motherRoom.health${h.charAt(0).toUpperCase() + h.slice(1)}`)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-dark-400 text-xs mb-1 block">{t('motherRoom.notes')}</label>
                <textarea
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-white text-sm resize-none"
                  rows={2}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditPlant(null)}
                className="px-4 py-2 text-sm text-dark-400 hover:text-white transition"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={handleSavePlant}
                disabled={savingAction || !form.name.trim() || !form.plantedDate}
                className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-500 disabled:opacity-50 transition"
              >
                {savingAction ? '...' : t('common.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Prune Modal ─── */}
      {pruneModal && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4"
          onClick={() => setPruneModal(null)}
        >
          <div
            className="bg-dark-800 border border-dark-700 rounded-xl p-6 w-full max-w-sm space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <h2 className="text-white font-semibold">{t('motherRoom.recordPrune')}</h2>
            <div className="space-y-3">
              <div>
                <label className="text-dark-400 text-xs mb-1 block">{t('motherRoom.pruneDate')}</label>
                <input
                  type="date"
                  value={pruneForm.date}
                  onChange={e => setPruneForm(f => ({ ...f, date: e.target.value }))}
                  className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-white text-sm"
                />
              </div>
              <div>
                <label className="text-dark-400 text-xs mb-1 block">{t('motherRoom.pruneNotes')}</label>
                <textarea
                  value={pruneForm.notes}
                  onChange={e => setPruneForm(f => ({ ...f, notes: e.target.value }))}
                  className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-white text-sm resize-none"
                  rows={2}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPruneModal(null)}
                className="px-4 py-2 text-sm text-dark-400 hover:text-white transition"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={handleRecordPrune}
                disabled={savingAction || !pruneForm.date}
                className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-500 disabled:opacity-50 transition"
              >
                {savingAction ? '...' : t('common.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Retire Modal ─── */}
      {retireModal && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4"
          onClick={() => setRetireModal(null)}
        >
          <div
            className="bg-dark-800 border border-dark-700 rounded-xl p-6 w-full max-w-sm space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <h2 className="text-white font-semibold">{t('motherRoom.retire')}</h2>
            <p className="text-dark-400 text-sm">{t('motherRoom.retireConfirm')}</p>
            <div>
              <label className="text-dark-400 text-xs mb-1 block">{t('motherRoom.retireReason')}</label>
              <textarea
                value={retireReason}
                onChange={e => setRetireReason(e.target.value)}
                className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-white text-sm resize-none"
                rows={2}
                placeholder={t('motherRoom.retireReason')}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setRetireModal(null)}
                className="px-4 py-2 text-sm text-dark-400 hover:text-white transition"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={handleRetire}
                disabled={savingAction}
                className="px-4 py-2 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-500 disabled:opacity-50 transition"
              >
                {savingAction ? '...' : t('motherRoom.retire')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatItem({ label, value, accent }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-dark-500">{label}:</span>
      <span className={`font-semibold ${accent || 'text-white'}`}>{value}</span>
    </div>
  );
}

function SaveIndicator({ status, t }) {
  if (status === 'idle') return null;
  const map = {
    saving: { text: t('motherRoom.saving'), className: 'text-dark-400' },
    saved: { text: `✓ ${t('motherRoom.saved')}`, className: 'text-green-400' },
    error: { text: `✕ ${t('motherRoom.saveError')}`, className: 'text-red-400' },
  };
  const cur = map[status];
  if (!cur) return null;
  return <span className={`text-xs ${cur.className}`}>{cur.text}</span>;
}
