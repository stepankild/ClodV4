import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { motherRoomService } from '../../services/motherRoomService';
import { useAuth } from '../../context/AuthContext';
import MotherRoomMap from '../../components/MotherRoom/MotherRoomMap';
import { HEALTH_COLORS } from '../../components/MotherRoom/MotherPlantCell';
import StrainSelect from '../../components/StrainSelect';

const HEALTH_OPTIONS = ['excellent', 'good', 'satisfactory', 'poor', 'critical'];

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
  const [showMap, setShowMap] = useState(false);
  const [mapData, setMapData] = useState(null);
  const [mapSaving, setMapSaving] = useState(false);
  const [showRetired, setShowRetired] = useState(false);

  // Modal states
  const [editPlant, setEditPlant] = useState(null); // null=closed, {}=new, {_id,...}=edit
  const [pruneModal, setPruneModal] = useState(null); // plant _id
  const [retireModal, setRetireModal] = useState(null); // plant _id
  const [savingAction, setSavingAction] = useState(false);

  // Form state for add/edit
  const [form, setForm] = useState({ name: '', strain: '', plantedDate: '', health: 'good', notes: '' });
  // Prune form
  const [pruneForm, setPruneForm] = useState({ date: '', notes: '' });
  // Retire form
  const [retireReason, setRetireReason] = useState('');

  const loadData = useCallback(async () => {
    try {
      const [plantsData, mapRes] = await Promise.all([
        motherRoomService.getPlants({ includeRetired: true }),
        motherRoomService.getMap()
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

  const activePlants = plants.filter(p => !p.retiredAt);
  const retiredPlants = plants.filter(p => p.retiredAt);

  // Map save
  const handleMapSave = async (data) => {
    setMapSaving(true);
    try {
      const res = await motherRoomService.saveMap(data);
      setMapData(res);
    } finally {
      setMapSaving(false);
    }
  };

  // Open add/edit modal
  const openAddPlant = () => {
    setForm({ name: '', strain: '', plantedDate: new Date().toISOString().split('T')[0], health: 'good', notes: '' });
    setEditPlant({});
  };

  const openEditPlant = (plant) => {
    setForm({
      name: plant.name,
      strain: plant.strain || '',
      plantedDate: plant.plantedDate ? new Date(plant.plantedDate).toISOString().split('T')[0] : '',
      health: plant.health || 'good',
      notes: plant.notes || ''
    });
    setEditPlant(plant);
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

  // Prune
  const openPruneModal = (plantId) => {
    setPruneForm({ date: new Date().toISOString().split('T')[0], notes: '' });
    setPruneModal(plantId);
  };

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

  // Retire
  const openRetireModal = (plantId) => {
    setRetireReason('');
    setRetireModal(plantId);
  };

  const handleRetire = async () => {
    setSavingAction(true);
    try {
      const updated = await motherRoomService.retirePlant(retireModal, retireReason);
      setPlants(prev => prev.map(p => p._id === updated._id ? updated : p));
      setRetireModal(null);
      // Refresh map to remove retired plant
      const mapRes = await motherRoomService.getMap();
      setMapData(mapRes);
    } catch (err) {
      alert(err.response?.data?.message || 'Error');
    } finally {
      setSavingAction(false);
    }
  };

  // Delete
  const handleDelete = async (plantId) => {
    if (!confirm(t('common.confirmDelete'))) return;
    try {
      await motherRoomService.deletePlant(plantId);
      setPlants(prev => prev.filter(p => p._id !== plantId));
    } catch (err) {
      alert(err.response?.data?.message || 'Error');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary-500 border-t-transparent"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold text-white">{t('motherRoom.title')}</h1>
        <div className="flex gap-2 flex-wrap">
          <button type="button" onClick={() => setShowMap(!showMap)}
            className="px-3 py-1.5 text-sm bg-dark-700 text-dark-300 rounded-lg hover:bg-dark-600 transition">
            {showMap ? t('motherRoom.hideMap') : t('motherRoom.showMap')}
          </button>
          {canManage && (
            <button type="button" onClick={openAddPlant}
              className="px-4 py-1.5 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-500 transition">
              {t('motherRoom.addPlant')}
            </button>
          )}
        </div>
      </div>

      {/* Map section */}
      {showMap && (
        <div className="bg-dark-800 border border-dark-700 rounded-lg p-4">
          <MotherRoomMap
            mapData={mapData}
            plants={activePlants}
            onSave={handleMapSave}
            saving={mapSaving}
            onPlantClick={(id) => {
              const p = plants.find(x => x._id === id);
              if (p) openEditPlant(p);
            }}
          />
        </div>
      )}

      {/* Active plants */}
      {activePlants.length === 0 ? (
        <div className="text-center py-12 text-dark-400">{t('motherRoom.noPlants')}</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {activePlants.map(plant => {
            const age = daysAgo(plant.plantedDate);
            const lastPruneDays = daysAgo(plant.lastPruneDate);
            const color = HEALTH_COLORS[plant.health] || HEALTH_COLORS.good;

            return (
              <div key={plant._id} className="bg-dark-800 border border-dark-700 rounded-lg p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-white font-semibold text-sm">{plant.name}</h3>
                    {plant.strain && <span className="text-dark-400 text-xs">{plant.strain}</span>}
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${color.bg} ${color.border} ${color.text} border`}>
                    {t(`motherRoom.health${plant.health.charAt(0).toUpperCase() + plant.health.slice(1)}`)}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-dark-500">{t('motherRoom.age')}</span>
                    <span className="text-white ml-1">{age != null ? `${age} ${t('motherRoom.ageDays')}` : '—'}</span>
                  </div>
                  <div>
                    <span className="text-dark-500">{t('motherRoom.lastPrune')}</span>
                    <span className="text-white ml-1">
                      {lastPruneDays != null ? `${lastPruneDays} ${t('motherRoom.daysAgo')}` : t('motherRoom.neverPruned')}
                    </span>
                  </div>
                  {plant.pruneHistory?.length > 0 && (
                    <div className="col-span-2">
                      <span className="text-dark-500">{t('motherRoom.pruneHistory')}</span>
                      <span className="text-white ml-1">{plant.pruneHistory.length}x</span>
                    </div>
                  )}
                </div>

                {plant.notes && (
                  <p className="text-dark-400 text-xs line-clamp-2">{plant.notes}</p>
                )}

                {canManage && (
                  <div className="flex gap-1.5 pt-1 border-t border-dark-700">
                    <button type="button" onClick={() => openEditPlant(plant)}
                      className="px-2 py-1 text-xs text-dark-400 hover:text-white hover:bg-dark-700 rounded transition">
                      {t('common.edit')}
                    </button>
                    <button type="button" onClick={() => openPruneModal(plant._id)}
                      className="px-2 py-1 text-xs text-green-500 hover:text-green-400 hover:bg-dark-700 rounded transition">
                      {t('motherRoom.recordPrune')}
                    </button>
                    <button type="button" onClick={() => openRetireModal(plant._id)}
                      className="px-2 py-1 text-xs text-amber-500 hover:text-amber-400 hover:bg-dark-700 rounded transition">
                      {t('motherRoom.retire')}
                    </button>
                    <button type="button" onClick={() => handleDelete(plant._id)}
                      className="px-2 py-1 text-xs text-red-500 hover:text-red-400 hover:bg-dark-700 rounded transition ml-auto">
                      {t('common.delete')}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Retired plants section */}
      {retiredPlants.length > 0 && (
        <div>
          <button type="button" onClick={() => setShowRetired(!showRetired)}
            className="text-sm text-dark-400 hover:text-dark-300 transition mb-2">
            {showRetired ? t('motherRoom.hideRetired') : t('motherRoom.showRetired')} ({retiredPlants.length})
          </button>
          {showRetired && (
            <div className="space-y-2">
              {retiredPlants.map(plant => (
                <div key={plant._id} className="bg-dark-800/50 border border-dark-700/50 rounded-lg px-4 py-2 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-3">
                    <span className="text-dark-400 font-medium">{plant.name}</span>
                    {plant.strain && <span className="text-dark-500">{plant.strain}</span>}
                    <span className="text-dark-600">
                      {t('motherRoom.retiredAt')}: {new Date(plant.retiredAt).toLocaleDateString()}
                    </span>
                    {plant.retiredReason && <span className="text-dark-500">— {plant.retiredReason}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─── Add/Edit Plant Modal ─── */}
      {editPlant !== null && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setEditPlant(null)}>
          <div className="bg-dark-800 border border-dark-700 rounded-xl p-6 w-full max-w-md space-y-4" onClick={e => e.stopPropagation()}>
            <h2 className="text-white font-semibold">
              {editPlant._id ? t('motherRoom.editPlant') : t('motherRoom.addPlant')}
            </h2>

            <div className="space-y-3">
              <div>
                <label className="text-dark-400 text-xs mb-1 block">{t('motherRoom.plantName')}</label>
                <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-white text-sm"
                  placeholder="M-001" autoFocus />
              </div>

              <div>
                <label className="text-dark-400 text-xs mb-1 block">{t('motherRoom.strain')}</label>
                <StrainSelect value={form.strain} onChange={v => setForm(f => ({ ...f, strain: v }))} className="w-full" />
              </div>

              <div>
                <label className="text-dark-400 text-xs mb-1 block">{t('motherRoom.plantedDate')}</label>
                <input type="date" value={form.plantedDate} onChange={e => setForm(f => ({ ...f, plantedDate: e.target.value }))}
                  className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-white text-sm" />
              </div>

              <div>
                <label className="text-dark-400 text-xs mb-1 block">{t('motherRoom.health')}</label>
                <select value={form.health} onChange={e => setForm(f => ({ ...f, health: e.target.value }))}
                  className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-white text-sm">
                  {HEALTH_OPTIONS.map(h => (
                    <option key={h} value={h}>{t(`motherRoom.health${h.charAt(0).toUpperCase() + h.slice(1)}`)}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-dark-400 text-xs mb-1 block">{t('motherRoom.notes')}</label>
                <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-white text-sm resize-none"
                  rows={2} />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setEditPlant(null)}
                className="px-4 py-2 text-sm text-dark-400 hover:text-white transition">{t('common.cancel')}</button>
              <button type="button" onClick={handleSavePlant} disabled={savingAction || !form.name.trim() || !form.plantedDate}
                className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-500 disabled:opacity-50 transition">
                {savingAction ? '...' : t('common.save')}</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Prune Modal ─── */}
      {pruneModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setPruneModal(null)}>
          <div className="bg-dark-800 border border-dark-700 rounded-xl p-6 w-full max-w-sm space-y-4" onClick={e => e.stopPropagation()}>
            <h2 className="text-white font-semibold">{t('motherRoom.recordPrune')}</h2>
            <div className="space-y-3">
              <div>
                <label className="text-dark-400 text-xs mb-1 block">{t('motherRoom.pruneDate')}</label>
                <input type="date" value={pruneForm.date} onChange={e => setPruneForm(f => ({ ...f, date: e.target.value }))}
                  className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-white text-sm" />
              </div>
              <div>
                <label className="text-dark-400 text-xs mb-1 block">{t('motherRoom.pruneNotes')}</label>
                <textarea value={pruneForm.notes} onChange={e => setPruneForm(f => ({ ...f, notes: e.target.value }))}
                  className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-white text-sm resize-none"
                  rows={2} />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setPruneModal(null)}
                className="px-4 py-2 text-sm text-dark-400 hover:text-white transition">{t('common.cancel')}</button>
              <button type="button" onClick={handleRecordPrune} disabled={savingAction || !pruneForm.date}
                className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-500 disabled:opacity-50 transition">
                {savingAction ? '...' : t('common.save')}</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Retire Modal ─── */}
      {retireModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setRetireModal(null)}>
          <div className="bg-dark-800 border border-dark-700 rounded-xl p-6 w-full max-w-sm space-y-4" onClick={e => e.stopPropagation()}>
            <h2 className="text-white font-semibold">{t('motherRoom.retire')}</h2>
            <p className="text-dark-400 text-sm">{t('motherRoom.retireConfirm')}</p>
            <div>
              <label className="text-dark-400 text-xs mb-1 block">{t('motherRoom.retireReason')}</label>
              <textarea value={retireReason} onChange={e => setRetireReason(e.target.value)}
                className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-white text-sm resize-none"
                rows={2} placeholder={t('motherRoom.retireReason')} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setRetireModal(null)}
                className="px-4 py-2 text-sm text-dark-400 hover:text-white transition">{t('common.cancel')}</button>
              <button type="button" onClick={handleRetire} disabled={savingAction}
                className="px-4 py-2 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-500 disabled:opacity-50 transition">
                {savingAction ? '...' : t('motherRoom.retire')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
