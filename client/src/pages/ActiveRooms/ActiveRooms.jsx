import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { roomService } from '../../services/roomService';
import RoomMap from '../../components/RoomMap/RoomMap';
import StrainSelect from '../../components/StrainSelect';

export default function ActiveRooms() {
  const { t, i18n } = useTranslation();
  const { hasPermission } = useAuth();
  const canEditCycleName = hasPermission ? hasPermission('cycles:edit_name') : false;
  const canHarvest = hasPermission ? hasPermission('harvest:complete') : false;

  const formatDate = (date) => {
    if (!date) return '—';
    return new Date(date).toLocaleDateString(i18n.language === 'en' ? 'en-US' : 'ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
  };

  const formatDateInput = (date) => {
    if (!date) return '';
    return new Date(date).toISOString().slice(0, 10);
  };

  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [startMode, setStartMode] = useState(false);
  const [mapMode, setMapMode] = useState(false);
  const [saving, setSaving] = useState(false);

  const [editForm, setEditForm] = useState({
    cycleName: '',
    strain: '',
    plantsCount: '',
    floweringDays: '',
    notes: '',
    startDate: ''
  });

  const [startForm, setStartForm] = useState({
    cycleName: '',
    flowerStrains: [{ strain: '', quantity: '' }],
    floweringDays: '56',
    notes: '',
    startDate: ''
  });

  const [planMode, setPlanMode] = useState(null);
  const [planForm, setPlanForm] = useState({
    cycleName: '',
    strain: '',
    plannedStartDate: '',
    plantsCount: '',
    floweringDays: '56',
    notes: ''
  });
  const [planSaving, setPlanSaving] = useState(false);

  // Quick tasks state
  const [roomTasks, setRoomTasks] = useState([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [sprayFormOpen, setSprayFormOpen] = useState(false);
  const [sprayProduct, setSprayProduct] = useState('');
  const [sprayDate, setSprayDate] = useState(new Date().toISOString().slice(0, 10));
  const [sprayNote, setSprayNote] = useState('');
  const [trimFormOpen, setTrimFormOpen] = useState(false);
  const [trimDate, setTrimDate] = useState(new Date().toISOString().slice(0, 10));
  const [trimNote, setTrimNote] = useState('');
  const [defolFormOpen, setDefolFormOpen] = useState(false);
  const [defolDate, setDefolDate] = useState(new Date().toISOString().slice(0, 10));
  const [defolNote, setDefolNote] = useState('');
  const [netFormOpen, setNetFormOpen] = useState(false);
  const [netDate, setNetDate] = useState(new Date().toISOString().slice(0, 10));
  const [netNote, setNetNote] = useState('');
  const [customFormOpen, setCustomFormOpen] = useState(false);
  const [customTitle, setCustomTitle] = useState('');
  const [customDate, setCustomDate] = useState(new Date().toISOString().slice(0, 10));
  const [customNote, setCustomNote] = useState('');
  const [noteInput, setNoteInput] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);

  // Room settings state
  const [settingsMode, setSettingsMode] = useState(false);
  const [settingsForm, setSettingsForm] = useState({
    squareMeters: '',
    lampCount: '',
    lampWattage: '',
    lampType: '',
    potSize: ''
  });

  // Transfer cycle state
  const [transferMode, setTransferMode] = useState(false);
  const [transferTarget, setTransferTarget] = useState('');
  const [transferReason, setTransferReason] = useState('');
  const [transferSaving, setTransferSaving] = useState(false);
  const [transferStrains, setTransferStrains] = useState([]);

  useEffect(() => {
    loadRooms();
  }, []);

  const loadRooms = async () => {
    try {
      setLoading(true);
      setError('');
      const data = await roomService.getRoomsSummary();
      setRooms(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.response?.data?.message || t('rooms.loadError'));
    } finally {
      setLoading(false);
    }
  };

  const refreshSelectedRoom = async () => {
    await loadRooms();
    const list = await roomService.getRoomsSummary();
    if (selectedRoom) {
      const updated = list.find(r => r._id === selectedRoom._id);
      if (updated) setSelectedRoom(updated);
    }
  };

  const loadRoomTasks = async (roomId) => {
    setTasksLoading(true);
    try {
      const tasks = await roomService.getRoomTasks(roomId);
      setRoomTasks(Array.isArray(tasks) ? tasks : []);
    } catch (err) {
      console.error('Failed to load tasks:', err);
      setRoomTasks([]);
    } finally {
      setTasksLoading(false);
    }
  };

  const openRoom = (room, openMap = false) => {
    setSelectedRoom(room);
    setEditMode(false);
    setStartMode(false);
    setMapMode(openMap);
    setSettingsMode(false);
    setTransferMode(false);
    setSprayFormOpen(false);
    setSprayProduct('');
    setNoteInput('');
    if (room.isActive) {
      loadRoomTasks(room._id);
    } else {
      setRoomTasks([]);
    }
  };

  const closeRoom = () => {
    setSelectedRoom(null);
    setEditMode(false);
    setStartMode(false);
    setMapMode(false);
    setSettingsMode(false);
    setTransferMode(false);
    setRoomTasks([]);
  };

  const startEditMode = () => {
    if (!selectedRoom) return;
    setEditForm({
      cycleName: selectedRoom.cycleName || '',
      strain: selectedRoom.strain || '',
      plantsCount: selectedRoom.plantsCount || '',
      floweringDays: selectedRoom.floweringDays || 56,
      notes: selectedRoom.notes || '',
      startDate: formatDateInput(selectedRoom.startDate)
    });
    setEditMode(true);
  };

  const openSettings = () => {
    if (!selectedRoom) return;
    setSettingsForm({
      squareMeters: selectedRoom.squareMeters ?? '',
      lampCount: selectedRoom.lighting?.lampCount ?? '',
      lampWattage: selectedRoom.lighting?.lampWattage ?? '',
      lampType: selectedRoom.lighting?.lampType ?? '',
      potSize: selectedRoom.potSize ?? ''
    });
    setSettingsMode(true);
    setEditMode(false);
    setStartMode(false);
  };

  const handleSettingsSave = async () => {
    if (!selectedRoom) return;
    setSaving(true);
    try {
      await roomService.updateRoom(selectedRoom._id, {
        squareMeters: settingsForm.squareMeters === '' ? null : Number(settingsForm.squareMeters),
        lighting: {
          lampCount: settingsForm.lampCount === '' ? null : Number(settingsForm.lampCount),
          lampWattage: settingsForm.lampWattage === '' ? null : Number(settingsForm.lampWattage),
          lampType: settingsForm.lampType || null
        },
        potSize: settingsForm.potSize === '' ? null : Number(settingsForm.potSize)
      });
      setSettingsMode(false);
      await refreshSelectedRoom();
    } catch (err) {
      setError(err.response?.data?.message || t('rooms.settingsSaveError'));
    } finally {
      setSaving(false);
    }
  };

  const handleMapSave = async (layoutData) => {
    if (!selectedRoom) return;
    setSaving(true);
    try {
      await roomService.updateRoom(selectedRoom._id, {
        roomLayout: layoutData
      });
      await refreshSelectedRoom();
    } catch (err) {
      setError(err.response?.data?.message || t('rooms.mapSaveError'));
    } finally {
      setSaving(false);
    }
  };

  const startStartMode = () => {
    const today = new Date().toISOString().slice(0, 10);
    setStartForm({
      cycleName: '',
      flowerStrains: [{ strain: '', quantity: '' }],
      floweringDays: '56',
      notes: '',
      startDate: today
    });
    setStartMode(true);
  };

  const handleEditSave = async () => {
    if (!selectedRoom) return;
    setSaving(true);
    try {
      await roomService.updateRoom(selectedRoom._id, {
        cycleName: editForm.cycleName.trim(),
        strain: editForm.strain.trim(),
        plantsCount: Number(editForm.plantsCount) || 0,
        floweringDays: Number(editForm.floweringDays) || 56,
        notes: editForm.notes.trim(),
        startDate: editForm.startDate || null
      });
      setEditMode(false);
      await refreshSelectedRoom();
    } catch (err) {
      setError(err.response?.data?.message || t('rooms.saveError'));
    } finally {
      setSaving(false);
    }
  };

  // Helpers for multi-strain form
  const computeStrainRanges = (strains) => {
    let current = 1;
    return strains.map(s => {
      const qty = parseInt(s.quantity, 10) || 0;
      if (qty <= 0) return { ...s, startNumber: null, endNumber: null };
      const start = current;
      const end = current + qty - 1;
      current = end + 1;
      return { ...s, startNumber: start, endNumber: end };
    });
  };
  const totalPlantsFromStrains = (strains) => strains.reduce((sum, s) => sum + (parseInt(s.quantity, 10) || 0), 0);
  const updateFlowerStrain = (index, field, value) => {
    setStartForm(f => {
      const updated = [...f.flowerStrains];
      updated[index] = { ...updated[index], [field]: value };
      return { ...f, flowerStrains: updated };
    });
  };
  const addFlowerStrain = () => {
    setStartForm(f => ({ ...f, flowerStrains: [...f.flowerStrains, { strain: '', quantity: '' }] }));
  };
  const removeFlowerStrain = (index) => {
    setStartForm(f => {
      const updated = f.flowerStrains.filter((_, i) => i !== index);
      return { ...f, flowerStrains: updated.length ? updated : [{ strain: '', quantity: '' }] };
    });
  };

  const handleStartCycle = async () => {
    if (!selectedRoom) return;
    setSaving(true);
    try {
      const fs = startForm.flowerStrains.filter(s => s.strain.trim() || (parseInt(s.quantity, 10) || 0) > 0);
      const strainJoined = fs.map(s => s.strain.trim()).filter(Boolean).join(' / ');
      const totalPlants = fs.reduce((sum, s) => sum + (parseInt(s.quantity, 10) || 0), 0);
      await roomService.startCycle(selectedRoom._id, {
        cycleName: startForm.cycleName.trim(),
        strain: strainJoined,
        plantsCount: totalPlants,
        flowerStrains: fs.map(s => ({ strain: s.strain.trim(), quantity: parseInt(s.quantity, 10) || 0 })),
        floweringDays: Number(startForm.floweringDays) || 56,
        notes: startForm.notes.trim(),
        startDate: startForm.startDate || new Date().toISOString()
      });
      setStartMode(false);
      await refreshSelectedRoom();
    } catch (err) {
      setError(err.response?.data?.message || t('rooms.startCycleError'));
    } finally {
      setSaving(false);
    }
  };

  const handleHarvest = async () => {
    if (!selectedRoom || !canHarvest) return;
    if (!confirm(t('rooms.confirmHarvest', { name: selectedRoom.name }))) return;
    setSaving(true);
    try {
      await roomService.harvestRoom(selectedRoom._id);
      await refreshSelectedRoom();
    } catch (err) {
      setError(err.response?.data?.message || t('rooms.harvestError'));
    } finally {
      setSaving(false);
    }
  };

  const handleTransfer = async () => {
    if (!selectedRoom || !transferTarget) return;
    const totalTransfer = transferStrains.reduce((s, t) => s + (t.transfer || 0), 0);
    const totalDisposed = transferStrains.reduce((s, t) => s + ((t.original || 0) - (t.transfer || 0)), 0);
    if (totalTransfer === 0) {
      setError(t('rooms.transferAtLeastOne'));
      return;
    }
    const targetName = rooms.find(r => r._id === transferTarget)?.name || t('rooms.selectedRoom');
    const disposeMsg = totalDisposed > 0 ? `\n${t('rooms.transferDisposeCount', { count: totalDisposed })}` : '';
    if (!confirm(t('rooms.confirmTransfer', { count: totalTransfer, from: selectedRoom.name, to: targetName }) + disposeMsg + `\n${t('rooms.transferNote')}`)) return;
    setTransferSaving(true);
    try {
      const strainsToSend = transferStrains
        .filter(s => s.transfer > 0)
        .map(s => ({ strain: s.strain, quantity: s.transfer }));
      await roomService.transferCycle(selectedRoom._id, transferTarget, transferReason, strainsToSend);
      setTransferMode(false);
      setTransferTarget('');
      setTransferReason('');
      setTransferStrains([]);
      closeRoom();
      await loadRooms();
    } catch (err) {
      setError(err.response?.data?.message || t('rooms.transferError'));
    } finally {
      setTransferSaving(false);
    }
  };

  const openPlanMode = (room) => {
    const plan = room.plannedCycle;
    setPlanMode(room);
    setPlanForm({
      cycleName: plan?.cycleName || '',
      strain: plan?.strain || '',
      plannedStartDate: plan?.plannedStartDate ? new Date(plan.plannedStartDate).toISOString().slice(0, 10) : '',
      plantsCount: plan?.plantsCount ?? '',
      floweringDays: String(plan?.floweringDays ?? 56),
      notes: plan?.notes || ''
    });
  };

  const closePlanMode = () => {
    setPlanMode(null);
  };

  const handlePlanSubmit = async (e) => {
    e.preventDefault();
    if (!planMode) return;
    setPlanSaving(true);
    try {
      const payload = {
        roomId: planMode._id,
        cycleName: planForm.cycleName.trim(),
        strain: planForm.strain.trim(),
        plannedStartDate: planForm.plannedStartDate || null,
        plantsCount: Number(planForm.plantsCount) || 0,
        floweringDays: Number(planForm.floweringDays) || 56,
        notes: planForm.notes.trim()
      };
      if (planMode.plannedCycle?._id) {
        await roomService.updatePlan(planMode.plannedCycle._id, {
          cycleName: payload.cycleName,
          strain: payload.strain,
          plannedStartDate: payload.plannedStartDate,
          plantsCount: payload.plantsCount,
          floweringDays: payload.floweringDays,
          notes: payload.notes
        });
      } else {
        await roomService.createPlan(payload);
      }
      closePlanMode();
      await refreshSelectedRoom();
    } catch (err) {
      setError(err.response?.data?.message || t('rooms.planSaveError'));
    } finally {
      setPlanSaving(false);
    }
  };

  const handlePlanDelete = async () => {
    if (!planMode?.plannedCycle?._id) return;
    if (!confirm(t('rooms.confirmDeletePlan'))) return;
    setPlanSaving(true);
    try {
      await roomService.deletePlan(planMode.plannedCycle._id);
      closePlanMode();
      await refreshSelectedRoom();
    } catch (err) {
      setError(err.response?.data?.message || t('rooms.planDeleteError'));
    } finally {
      setPlanSaving(false);
    }
  };

  // --- Quick task handlers ---

  const handleNetAdd = async () => {
    if (!selectedRoom) return;
    try {
      await roomService.quickTask(selectedRoom._id, {
        type: 'net',
        completedAt: netDate ? new Date(netDate).toISOString() : undefined,
        description: netNote.trim() || undefined
      });
      setNetFormOpen(false);
      setNetDate(new Date().toISOString().slice(0, 10));
      setNetNote('');
      await loadRoomTasks(selectedRoom._id);
      await refreshSelectedRoom();
    } catch (err) {
      setError(err.response?.data?.message || t('rooms.error'));
    }
  };

  const handleSprayAdd = async () => {
    if (!selectedRoom || !sprayProduct.trim()) return;
    try {
      await roomService.quickTask(selectedRoom._id, {
        type: 'spray',
        product: sprayProduct.trim(),
        completedAt: sprayDate ? new Date(sprayDate).toISOString() : undefined,
        description: sprayNote.trim() || undefined
      });
      setSprayProduct('');
      setSprayDate(new Date().toISOString().slice(0, 10));
      setSprayNote('');
      setSprayFormOpen(false);
      await loadRoomTasks(selectedRoom._id);
      await refreshSelectedRoom();
    } catch (err) {
      setError(err.response?.data?.message || t('rooms.error'));
    }
  };

  const handleTrimAdd = async () => {
    if (!selectedRoom) return;
    try {
      await roomService.quickTask(selectedRoom._id, {
        type: 'trim',
        completedAt: trimDate ? new Date(trimDate).toISOString() : undefined,
        description: trimNote.trim() || undefined
      });
      setTrimFormOpen(false);
      setTrimDate(new Date().toISOString().slice(0, 10));
      setTrimNote('');
      await loadRoomTasks(selectedRoom._id);
      await refreshSelectedRoom();
    } catch (err) {
      setError(err.response?.data?.message || t('rooms.error'));
    }
  };

  const handleDefoliationAdd = async () => {
    if (!selectedRoom) return;
    try {
      await roomService.quickTask(selectedRoom._id, {
        type: 'defoliation',
        completedAt: defolDate ? new Date(defolDate).toISOString() : undefined,
        description: defolNote.trim() || undefined
      });
      setDefolFormOpen(false);
      setDefolDate(new Date().toISOString().slice(0, 10));
      setDefolNote('');
      await loadRoomTasks(selectedRoom._id);
      await refreshSelectedRoom();
    } catch (err) {
      setError(err.response?.data?.message || t('rooms.error'));
    }
  };

  const handleCustomAdd = async () => {
    if (!selectedRoom || !customTitle.trim()) return;
    try {
      await roomService.quickTask(selectedRoom._id, {
        type: 'custom',
        description: customTitle.trim(),
        completedAt: customDate ? new Date(customDate).toISOString() : undefined
      });
      setCustomFormOpen(false);
      setCustomTitle('');
      setCustomDate(new Date().toISOString().slice(0, 10));
      setCustomNote('');
      await loadRoomTasks(selectedRoom._id);
      await refreshSelectedRoom();
    } catch (err) {
      setError(err.response?.data?.message || t('rooms.error'));
    }
  };

  const handleAddNote = async () => {
    if (!selectedRoom || !noteInput.trim()) return;
    setNoteSaving(true);
    try {
      await roomService.addNote(selectedRoom._id, noteInput.trim());
      setNoteInput('');
      await refreshSelectedRoom();
    } catch (err) {
      setError(err.response?.data?.message || t('rooms.addNoteError'));
    } finally {
      setNoteSaving(false);
    }
  };

  const handleDeleteTask = async (taskId) => {
    const task = roomTasks.find(t => t._id === taskId);
    if (!task) return;
    if (!confirm(t('rooms.confirmDeleteTask', { title: task.title }))) return;
    try {
      await roomService.deleteTask(taskId);
      await loadRoomTasks(selectedRoom._id);
      await refreshSelectedRoom();
    } catch (err) {
      setError(err.response?.data?.message || t('rooms.error'));
    }
  };

  const getProgressColor = (progress) => {
    if (progress >= 90) return 'bg-red-500';
    if (progress >= 70) return 'bg-yellow-500';
    return 'bg-primary-500';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500" />
      </div>
    );
  }

  const activeRooms = rooms.filter(r => r.isActive);
  const inactiveRooms = rooms.filter(r => !r.isActive);

  const completedTasks = roomTasks.filter(t => t.completed).sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));

  return (
    <div className="p-6">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">{t('rooms.title')}</h1>
        <p className="text-dark-400 mt-1">{t('rooms.subtitle')}</p>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-800 text-red-400 px-4 py-3 rounded-lg mb-6 flex items-center gap-3">
          <span>{error}</span>
          <button onClick={() => setError('')} className="ml-auto text-red-300 hover:text-white">✕</button>
        </div>
      )}

      {/* Active rooms */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-primary-500 animate-pulse" />
          {t('rooms.flowering', { count: activeRooms.length })}
        </h2>
        {activeRooms.length === 0 ? (
          <p className="text-dark-400">{t('rooms.noActiveCycles')}</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {activeRooms.map(room => (
              <div
                key={room._id}
                onClick={() => openRoom(room)}
                className="bg-dark-800 rounded-xl border border-dark-700 p-5 cursor-pointer hover:border-primary-500/50 transition"
              >
                <div className="flex items-start justify-between mb-3">
                  <h3 className="text-lg font-semibold text-white">{room.name}</h3>
                  <span className="text-xs px-2 py-1 rounded bg-primary-900/50 text-primary-400">
                    {t('rooms.dayN', { n: room.currentDay || 1 })}
                  </span>
                </div>

                <div className="text-sm text-dark-300 mb-2">
                  {room.cycleName && <div className="font-medium text-white">{room.cycleName}</div>}
                  {room.strain && <div>{room.strain}</div>}
                </div>

                <div className="mb-3">
                  <div className="flex justify-between text-xs text-dark-400 mb-1">
                    <span>{t('rooms.progress')}</span>
                    <span>{room.progress || 0}%</span>
                  </div>
                  <div className="h-2 bg-dark-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${getProgressColor(room.progress || 0)}`}
                      style={{ width: `${Math.min(room.progress || 0, 100)}%` }}
                    />
                  </div>
                </div>

                <div className="text-xs text-dark-500 space-y-1">
                  <div className="flex justify-between">
                    <span>{t('rooms.plantsLabel')}:</span>
                    <span className="text-dark-300">
                      {room.plantsCount || 0}
                      {room.squareMeters > 0 && room.plantsCount > 0 && (
                        <span className="text-dark-500 ml-1">({(room.plantsCount / room.squareMeters).toFixed(1)}/{t('rooms.sqm')})</span>
                      )}
                    </span>
                  </div>
                  {room.flowerStrains && room.flowerStrains.length > 1 && (
                    <div className="text-dark-400">
                      {room.flowerStrains.map(s => `${s.strain || '—'}: ${s.quantity}`).join(', ')}
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span>{t('rooms.harvestLabel')}:</span>
                    <span className="text-dark-300">{formatDate(room.expectedHarvestDate)}</span>
                  </div>
                  {room.daysRemaining != null && room.daysRemaining >= 0 && (
                    <div className="flex justify-between">
                      <span>{t('rooms.remaining')}:</span>
                      <span className="text-primary-400">{t('rooms.daysShort', { days: room.daysRemaining })}</span>
                    </div>
                  )}
                </div>

                {/* Quick access to room map */}
                {room.roomLayout?.customRows?.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-dark-700">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); openRoom(room, true); }}
                      className="w-full px-3 py-1.5 text-xs bg-dark-700/50 text-dark-400 rounded-lg hover:bg-dark-600 hover:text-dark-200 transition"
                    >
                      {t('rooms.roomMap')}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Inactive rooms */}
      <div>
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-dark-500" />
          {t('rooms.available', { count: inactiveRooms.length })}
        </h2>
        {inactiveRooms.length === 0 ? (
          <p className="text-dark-400">{t('rooms.allOccupied')}</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {inactiveRooms.map(room => (
              <div
                key={room._id}
                onClick={() => openRoom(room)}
                className="bg-dark-800 rounded-xl border border-dark-700 p-5 cursor-pointer hover:border-dark-500 transition"
              >
                <div className="flex items-start justify-between mb-3">
                  <h3 className="text-lg font-semibold text-white">{room.name}</h3>
                  <span className="text-xs px-2 py-1 rounded bg-dark-700 text-dark-400">
                    {t('rooms.free')}
                  </span>
                </div>
                <p className="text-dark-500 text-sm">{t('rooms.clickToStart')}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Room modal */}
      {selectedRoom && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={closeRoom}>
          <div
            className={`bg-dark-800 rounded-xl border border-dark-600 shadow-xl w-full max-h-[90vh] overflow-y-auto ${mapMode ? 'max-w-3xl' : 'max-w-lg'}`}
            onClick={e => e.stopPropagation()}
          >
            <div className="p-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-xl font-semibold text-white">{selectedRoom.name}</h3>
                  <p className="text-dark-400 text-sm">
                    {selectedRoom.isActive ? t('rooms.activeCycle') : t('rooms.roomFree')}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={openSettings} className="text-dark-400 hover:text-white p-1" title={t('rooms.roomSettings')}>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </button>
                  <button onClick={closeRoom} className="text-dark-400 hover:text-white text-2xl leading-none">
                    ×
                  </button>
                </div>
              </div>

              {/* Edit mode */}
              {editMode && selectedRoom.isActive && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs text-dark-400 mb-1">{t('rooms.form.cycleName')}</label>
                    <input
                      type="text"
                      value={editForm.cycleName}
                      onChange={e => setEditForm(f => ({ ...f, cycleName: e.target.value }))}
                      className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                      disabled={!canEditCycleName}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-dark-400 mb-1">{t('rooms.form.strain')}</label>
                    <StrainSelect
                      value={editForm.strain}
                      onChange={(val) => setEditForm(f => ({ ...f, strain: val }))}
                      className="w-full px-3 py-2 rounded-lg text-sm"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs text-dark-400 mb-1">{t('rooms.form.plants')}</label>
                      <input
                        type="number"
                        min="0"
                        value={editForm.plantsCount}
                        onChange={e => setEditForm(f => ({ ...f, plantsCount: e.target.value }))}
                        className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-dark-400 mb-1">{t('rooms.form.floweringDays')}</label>
                      <input
                        type="number"
                        min="1"
                        value={editForm.floweringDays}
                        onChange={e => setEditForm(f => ({ ...f, floweringDays: e.target.value }))}
                        className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-dark-400 mb-1">{t('rooms.form.startDate')}</label>
                    <input
                      type="date"
                      value={editForm.startDate}
                      onChange={e => setEditForm(f => ({ ...f, startDate: e.target.value }))}
                      className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-dark-400 mb-1">{t('rooms.form.notes')}</label>
                    <textarea
                      value={editForm.notes}
                      onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))}
                      rows={3}
                      className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm resize-none"
                    />
                  </div>
                  <div className="flex gap-2 pt-2">
                    <button
                      onClick={handleEditSave}
                      disabled={saving}
                      className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-500 transition disabled:opacity-50"
                    >
                      {saving ? t('rooms.saving') : t('rooms.save')}
                    </button>
                    <button
                      onClick={() => setEditMode(false)}
                      className="px-4 py-2 text-dark-400 hover:bg-dark-700 rounded-lg transition"
                    >
                      {t('rooms.cancel')}
                    </button>
                  </div>
                </div>
              )}

              {/* Room settings */}
              {settingsMode && (
                <div className="space-y-4">
                  <h4 className="text-sm font-medium text-dark-300 border-b border-dark-700 pb-2">{t('rooms.settings.areaAndPots')}</h4>
                  <div>
                    <label className="block text-xs text-dark-400 mb-1">{t('rooms.settings.greenArea')}</label>
                    <input
                      type="number" min="0" step="0.1"
                      value={settingsForm.squareMeters}
                      onChange={e => setSettingsForm(f => ({ ...f, squareMeters: e.target.value }))}
                      className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                      placeholder={t('rooms.settings.greenAreaPlaceholder')}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-dark-400 mb-1">{t('rooms.settings.potSize')}</label>
                    <input type="number" min="0" step="0.5"
                      value={settingsForm.potSize}
                      onChange={e => setSettingsForm(f => ({ ...f, potSize: e.target.value }))}
                      className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                      placeholder={t('rooms.settings.potSizePlaceholder')} />
                  </div>

                  <h4 className="text-sm font-medium text-dark-300 border-b border-dark-700 pb-2 pt-2">{t('rooms.settings.lighting')}</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs text-dark-400 mb-1">{t('rooms.settings.lampCount')}</label>
                      <input type="number" min="0"
                        value={settingsForm.lampCount}
                        onChange={e => setSettingsForm(f => ({ ...f, lampCount: e.target.value }))}
                        className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs text-dark-400 mb-1">{t('rooms.settings.lampWattage')}</label>
                      <input type="number" min="0"
                        value={settingsForm.lampWattage}
                        onChange={e => setSettingsForm(f => ({ ...f, lampWattage: e.target.value }))}
                        className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-dark-400 mb-1">{t('rooms.settings.lampType')}</label>
                    <select
                      value={settingsForm.lampType || ''}
                      onChange={e => setSettingsForm(f => ({ ...f, lampType: e.target.value }))}
                      className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                    >
                      <option value="">{t('rooms.settings.lampTypeNotSet')}</option>
                      <option value="LED">LED</option>
                      <option value="HPS">{t('rooms.settings.lampHPS')}</option>
                      <option value="CMH">{t('rooms.settings.lampCMH')}</option>
                      <option value="MH">{t('rooms.settings.lampMH')}</option>
                      <option value="fluorescent">{t('rooms.settings.lampFluorescent')}</option>
                      <option value="other">{t('rooms.settings.lampOther')}</option>
                    </select>
                  </div>

                  <div className="flex gap-2 pt-2">
                    <button
                      onClick={handleSettingsSave}
                      disabled={saving}
                      className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-500 transition disabled:opacity-50"
                    >
                      {saving ? t('rooms.saving') : t('rooms.save')}
                    </button>
                    <button
                      onClick={() => setSettingsMode(false)}
                      className="px-4 py-2 text-dark-400 hover:bg-dark-700 rounded-lg transition"
                    >
                      {t('rooms.cancel')}
                    </button>
                  </div>
                </div>
              )}

              {/* Start cycle mode */}
              {startMode && !selectedRoom.isActive && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs text-dark-400 mb-1">{t('rooms.form.cycleName')}</label>
                    <input
                      type="text"
                      value={startForm.cycleName}
                      onChange={e => setStartForm(f => ({ ...f, cycleName: e.target.value }))}
                      className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                      placeholder={t('rooms.form.cycleNamePlaceholder')}
                    />
                  </div>

                  {/* Multi-strain editor */}
                  <div>
                    <label className="block text-xs text-dark-400 mb-2">{t('rooms.form.strainsAndPlants')}</label>
                    <div className="space-y-2">
                      {computeStrainRanges(startForm.flowerStrains).map((fs, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <StrainSelect
                            value={startForm.flowerStrains[idx].strain}
                            onChange={(val) => updateFlowerStrain(idx, 'strain', val)}
                            className="flex-1 min-w-0 px-3 py-2 rounded-lg text-sm"
                          />
                          <input
                            type="number"
                            min="0"
                            value={startForm.flowerStrains[idx].quantity}
                            onChange={e => updateFlowerStrain(idx, 'quantity', e.target.value)}
                            placeholder={t('rooms.form.plantsPlaceholder')}
                            className="w-20 px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                          />
                          <span className="text-xs text-dark-500 whitespace-nowrap w-16 text-center">
                            {fs.startNumber != null ? `${fs.startNumber}–${fs.endNumber}` : '—'}
                          </span>
                          {startForm.flowerStrains.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeFlowerStrain(idx)}
                              className="text-dark-500 hover:text-red-400 text-lg leading-none px-1"
                              title={t('rooms.form.removeStrain')}
                            >
                              &#10005;
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center justify-between mt-2">
                      <button
                        type="button"
                        onClick={addFlowerStrain}
                        className="text-sm text-primary-400 hover:text-primary-300"
                      >
                        + {t('rooms.form.addStrain')}
                      </button>
                      <span className="text-xs text-dark-400">
                        {t('rooms.form.total')}: <span className="text-white font-medium">{totalPlantsFromStrains(startForm.flowerStrains)}</span> {t('rooms.form.plantsWord')}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs text-dark-400 mb-1">{t('rooms.form.floweringDays')}</label>
                      <input
                        type="number"
                        min="1"
                        value={startForm.floweringDays}
                        onChange={e => setStartForm(f => ({ ...f, floweringDays: e.target.value }))}
                        className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-dark-400 mb-1">{t('rooms.form.startDate')}</label>
                      <input
                        type="date"
                        value={startForm.startDate}
                        onChange={e => setStartForm(f => ({ ...f, startDate: e.target.value }))}
                        className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-dark-400 mb-1">{t('rooms.form.notes')}</label>
                    <textarea
                      value={startForm.notes}
                      onChange={e => setStartForm(f => ({ ...f, notes: e.target.value }))}
                      rows={3}
                      className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm resize-none"
                      placeholder={t('rooms.form.notesPlaceholder')}
                    />
                  </div>
                  <div className="flex gap-2 pt-2">
                    <button
                      onClick={handleStartCycle}
                      disabled={saving || totalPlantsFromStrains(startForm.flowerStrains) === 0}
                      className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-500 transition disabled:opacity-50"
                    >
                      {saving ? t('rooms.starting') : t('rooms.startCycle')}
                    </button>
                    <button
                      onClick={() => setStartMode(false)}
                      className="px-4 py-2 text-dark-400 hover:bg-dark-700 rounded-lg transition"
                    >
                      {t('rooms.cancel')}
                    </button>
                  </div>
                </div>
              )}

              {/* Room map */}
              {mapMode && selectedRoom.isActive && (
                <div className="space-y-3">
                  <RoomMap
                    room={selectedRoom}
                    onSave={handleMapSave}
                    saving={saving}
                  />
                  <div className="pt-2 border-t border-dark-700">
                    <button
                      type="button"
                      onClick={() => setMapMode(false)}
                      className="px-4 py-2 text-dark-400 hover:bg-dark-700 rounded-lg transition text-sm"
                    >
                      {t('rooms.back')}
                    </button>
                  </div>
                </div>
              )}

              {/* Transfer cycle */}
              {transferMode && selectedRoom?.isActive && (() => {
                const totalOriginal = transferStrains.reduce((s, t) => s + (t.original || 0), 0);
                const totalTransfer = transferStrains.reduce((s, t) => s + (t.transfer || 0), 0);
                const totalDisposed = totalOriginal - totalTransfer;
                return (
                <div className="space-y-4">
                  <h4 className="text-sm font-medium text-dark-300 border-b border-dark-700 pb-2">
                    {t('rooms.transfer.title', { name: selectedRoom.name })}
                  </h4>
                  <div>
                    <label className="block text-xs text-dark-400 mb-1">{t('rooms.transfer.targetRoom')}</label>
                    <select
                      value={transferTarget}
                      onChange={e => setTransferTarget(e.target.value)}
                      className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                    >
                      <option value="">{t('rooms.transfer.selectRoom')}</option>
                      {inactiveRooms.map(r => (
                        <option key={r._id} value={r._id}>{r.name}</option>
                      ))}
                    </select>
                  </div>

                  {/* Strain quantity selection */}
                  {transferStrains.length > 0 && (
                    <div>
                      <label className="block text-xs text-dark-400 mb-2">{t('rooms.transfer.quantityByStrain')}</label>
                      <div className="bg-dark-800 rounded-lg overflow-hidden border border-dark-600">
                        <div className="grid grid-cols-4 gap-1 px-3 py-1.5 bg-dark-700 text-xs text-dark-400 font-medium">
                          <div>{t('rooms.transfer.strain')}</div>
                          <div className="text-center">{t('rooms.transfer.totalCol')}</div>
                          <div className="text-center">{t('rooms.transfer.transferCol')}</div>
                          <div className="text-center">{t('rooms.transfer.disposeCol')}</div>
                        </div>
                        {transferStrains.map((ts, idx) => {
                          const disposed = (ts.original || 0) - (ts.transfer || 0);
                          return (
                            <div key={idx} className="grid grid-cols-4 gap-1 px-3 py-1.5 items-center border-t border-dark-700">
                              <div className="text-white text-sm truncate" title={ts.strain}>{ts.strain || '—'}</div>
                              <div className="text-center text-dark-300 text-sm">{ts.original}</div>
                              <div className="text-center">
                                <input
                                  type="number"
                                  min={0}
                                  max={ts.original}
                                  value={ts.transfer}
                                  onChange={e => {
                                    const val = Math.max(0, Math.min(ts.original, parseInt(e.target.value, 10) || 0));
                                    setTransferStrains(prev => prev.map((s, i) => i === idx ? { ...s, transfer: val } : s));
                                  }}
                                  className="w-16 mx-auto px-2 py-1 bg-dark-700 border border-dark-600 rounded text-white text-sm text-center"
                                />
                              </div>
                              <div className={`text-center text-sm ${disposed > 0 ? 'text-red-400' : 'text-dark-500'}`}>
                                {disposed}
                              </div>
                            </div>
                          );
                        })}
                        {/* Total */}
                        <div className="grid grid-cols-4 gap-1 px-3 py-1.5 border-t border-dark-600 bg-dark-700/50 font-medium">
                          <div className="text-dark-300 text-xs">{t('rooms.transfer.totalRow')}</div>
                          <div className="text-center text-dark-300 text-sm">{totalOriginal}</div>
                          <div className="text-center text-white text-sm">{totalTransfer}</div>
                          <div className={`text-center text-sm ${totalDisposed > 0 ? 'text-red-400' : 'text-dark-500'}`}>{totalDisposed}</div>
                        </div>
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs text-dark-400 mb-1">{t('rooms.transfer.reason')}</label>
                    <textarea
                      value={transferReason}
                      onChange={e => setTransferReason(e.target.value)}
                      rows={2}
                      className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm resize-none"
                      placeholder={t('rooms.transfer.reasonPlaceholder')}
                    />
                  </div>

                  {totalDisposed > 0 && (
                    <div className="bg-red-900/20 border border-red-800/50 rounded-lg p-3 text-xs text-red-300">
                      {t('rooms.transfer.disposeWarning', { count: totalDisposed })}
                    </div>
                  )}
                  <div className="bg-yellow-900/20 border border-yellow-800/50 rounded-lg p-3 text-xs text-yellow-300">
                    {t('rooms.transfer.transferInfo')}
                  </div>
                  <div className="flex gap-2 pt-2">
                    <button
                      onClick={handleTransfer}
                      disabled={transferSaving || !transferTarget || totalTransfer === 0}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition disabled:opacity-50"
                    >
                      {transferSaving ? t('rooms.transfer.transferring') : t('rooms.transfer.transferBtn', { count: totalTransfer })}
                    </button>
                    <button
                      onClick={() => setTransferMode(false)}
                      className="px-4 py-2 text-dark-400 hover:bg-dark-700 rounded-lg transition"
                    >
                      {t('rooms.cancel')}
                    </button>
                  </div>
                </div>
                );
              })()}

              {/* View mode */}
              {!editMode && !startMode && !settingsMode && !mapMode && !transferMode && (
                <>
                  {selectedRoom.isActive ? (
                    <div className="space-y-4">
                      {/* Main info */}
                      <div className="bg-dark-700/50 rounded-lg p-4 space-y-3">
                        {selectedRoom.cycleName && (
                          <div className="flex justify-between">
                            <span className="text-dark-400">{t('rooms.info.cycle')}:</span>
                            <span className="text-white font-medium">{selectedRoom.cycleName}</span>
                          </div>
                        )}
                        {selectedRoom.strain && (
                          <div className="flex justify-between">
                            <span className="text-dark-400">{t('rooms.info.strain')}:</span>
                            <span className="text-white">{selectedRoom.strain}</span>
                          </div>
                        )}
                        <div className="flex justify-between">
                          <span className="text-dark-400">{t('rooms.info.plants')}:</span>
                          <span className="text-white">
                            {selectedRoom.plantsCount || 0}
                            {selectedRoom.squareMeters > 0 && selectedRoom.plantsCount > 0 && (
                              <span className="text-dark-400 ml-1">({(selectedRoom.plantsCount / selectedRoom.squareMeters).toFixed(1)}/{t('rooms.sqm')})</span>
                            )}
                          </span>
                        </div>
                        {selectedRoom.flowerStrains && selectedRoom.flowerStrains.length > 0 && (
                          <div className="text-sm space-y-0.5">
                            <span className="text-dark-400">{t('rooms.info.byStrain')}:</span>
                            {selectedRoom.flowerStrains.map((s, i) => (
                              <div key={i} className="flex justify-between text-xs pl-2">
                                <span className="text-white">{s.strain || '—'}: {s.quantity} {t('rooms.form.plantsWord')}</span>
                                {s.startNumber != null && (
                                  <span className="text-dark-500">#{s.startNumber}–{s.endNumber}</span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="flex justify-between">
                          <span className="text-dark-400">{t('rooms.info.floweringDay')}:</span>
                          <span className="text-white">{selectedRoom.currentDay || 1} {t('rooms.info.of')} {selectedRoom.floweringDays || 56}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-dark-400">{t('rooms.info.start')}:</span>
                          <span className="text-white">{formatDate(selectedRoom.startDate)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-dark-400">{t('rooms.info.expectedHarvest')}:</span>
                          <span className="text-primary-400">{formatDate(selectedRoom.expectedHarvestDate)}</span>
                        </div>
                      </div>

                      {/* Room parameters */}
                      {(selectedRoom.lighting?.lampCount || selectedRoom.squareMeters || selectedRoom.potSize) && (
                        <div className="bg-dark-700/30 rounded-lg p-3 space-y-1 text-xs text-dark-400">
                          {selectedRoom.squareMeters && (
                            <div className="flex justify-between">
                              <span>{t('rooms.info.greenArea')}:</span>
                              <span className="text-dark-300">{selectedRoom.squareMeters} {t('rooms.sqm')}</span>
                            </div>
                          )}
                          {selectedRoom.lighting?.lampCount && selectedRoom.lighting?.lampWattage && (
                            <div className="flex justify-between">
                              <span>{t('rooms.info.lamps')}:</span>
                              <span className="text-dark-300">
                                {selectedRoom.lighting.lampCount} × {selectedRoom.lighting.lampWattage}{t('rooms.info.watt')}
                                {selectedRoom.lighting.lampType ? ` (${selectedRoom.lighting.lampType})` : ''}
                              </span>
                            </div>
                          )}
                          {selectedRoom.potSize && (
                            <div className="flex justify-between">
                              <span>{t('rooms.info.pot')}:</span>
                              <span className="text-dark-300">{selectedRoom.potSize}{t('rooms.info.liters')}</span>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Progress */}
                      <div>
                        <div className="flex justify-between text-sm text-dark-400 mb-2">
                          <span>{t('rooms.info.floweringProgress')}</span>
                          <span className="text-white">{selectedRoom.progress || 0}%</span>
                        </div>
                        <div className="h-3 bg-dark-700 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${getProgressColor(selectedRoom.progress || 0)}`}
                            style={{ width: `${Math.min(selectedRoom.progress || 0, 100)}%` }}
                          />
                        </div>
                        {selectedRoom.daysRemaining != null && selectedRoom.daysRemaining >= 0 && (
                          <p className="text-sm text-dark-500 mt-2">
                            {t('rooms.info.daysRemaining', { days: selectedRoom.daysRemaining })}
                          </p>
                        )}
                      </div>

                      {/* Quick actions */}
                      <div className="space-y-3 border-t border-dark-700 pt-4">
                        <h4 className="text-sm font-medium text-dark-300">{t('rooms.actions.title')}</h4>

                        {/* Nets */}
                        <div>
                          <button
                            onClick={() => setNetFormOpen(!netFormOpen)}
                            className="text-sm text-primary-400 hover:text-primary-300"
                          >
                            + {t('rooms.actions.recordNet')}
                          </button>
                          {netFormOpen && (
                            <div className="mt-2 space-y-2 p-3 bg-dark-700/50 rounded-lg border border-dark-600">
                              <div>
                                <label className="block text-xs text-dark-400 mb-1">{t('rooms.actions.date')}</label>
                                <input
                                  type="date"
                                  value={netDate}
                                  onChange={e => setNetDate(e.target.value)}
                                  className="w-full px-3 py-1.5 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                                />
                              </div>
                              <div>
                                <label className="block text-xs text-dark-400 mb-1">{t('rooms.actions.note')}</label>
                                <input
                                  type="text"
                                  value={netNote}
                                  onChange={e => setNetNote(e.target.value)}
                                  onKeyDown={e => e.key === 'Enter' && handleNetAdd()}
                                  placeholder={t('rooms.actions.optional')}
                                  className="w-full px-3 py-1.5 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                                  autoFocus
                                />
                              </div>
                              <div className="flex gap-2">
                                <button
                                  onClick={handleNetAdd}
                                  className="px-3 py-1.5 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-500"
                                >
                                  {t('rooms.save')}
                                </button>
                                <button
                                  onClick={() => { setNetFormOpen(false); setNetNote(''); }}
                                  className="px-3 py-1.5 bg-dark-600 text-dark-300 rounded-lg text-sm hover:bg-dark-500"
                                >
                                  {t('rooms.cancel')}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Spray */}
                        <div>
                          <button
                            onClick={() => setSprayFormOpen(!sprayFormOpen)}
                            className="text-sm text-primary-400 hover:text-primary-300"
                          >
                            + {t('rooms.actions.addSpray')}
                          </button>
                          {sprayFormOpen && (
                            <div className="mt-2 space-y-2 p-3 bg-dark-700/50 rounded-lg border border-dark-600">
                              <input
                                type="text"
                                value={sprayProduct}
                                onChange={e => setSprayProduct(e.target.value)}
                                placeholder={t('rooms.actions.productName')}
                                className="w-full px-3 py-1.5 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                                autoFocus
                              />
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <label className="block text-xs text-dark-400 mb-1">{t('rooms.actions.date')}</label>
                                  <input
                                    type="date"
                                    value={sprayDate}
                                    onChange={e => setSprayDate(e.target.value)}
                                    className="w-full px-3 py-1.5 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                                  />
                                </div>
                                <div>
                                  <label className="block text-xs text-dark-400 mb-1">{t('rooms.actions.note')}</label>
                                  <input
                                    type="text"
                                    value={sprayNote}
                                    onChange={e => setSprayNote(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && handleSprayAdd()}
                                    placeholder={t('rooms.actions.optional')}
                                    className="w-full px-3 py-1.5 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                                  />
                                </div>
                              </div>
                              <div className="flex gap-2">
                                <button
                                  onClick={handleSprayAdd}
                                  disabled={!sprayProduct.trim()}
                                  className="px-3 py-1.5 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-500 disabled:opacity-50"
                                >
                                  {t('rooms.save')}
                                </button>
                                <button
                                  onClick={() => { setSprayFormOpen(false); setSprayProduct(''); setSprayNote(''); }}
                                  className="px-3 py-1.5 bg-dark-600 text-dark-300 rounded-lg text-sm hover:bg-dark-500"
                                >
                                  {t('rooms.cancel')}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Trim */}
                        <div>
                          <button
                            onClick={() => setTrimFormOpen(!trimFormOpen)}
                            className="text-sm text-primary-400 hover:text-primary-300"
                          >
                            + {t('rooms.actions.recordTrim')}
                          </button>
                          {trimFormOpen && (
                            <div className="mt-2 space-y-2 p-3 bg-dark-700/50 rounded-lg border border-dark-600">
                              <div>
                                <label className="block text-xs text-dark-400 mb-1">{t('rooms.actions.trimDate')}</label>
                                <input
                                  type="date"
                                  value={trimDate}
                                  onChange={e => setTrimDate(e.target.value)}
                                  className="w-full px-3 py-1.5 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                                />
                              </div>
                              <div>
                                <label className="block text-xs text-dark-400 mb-1">{t('rooms.actions.trimNotePlaceholder')}</label>
                                <input
                                  type="text"
                                  value={trimNote}
                                  onChange={e => setTrimNote(e.target.value)}
                                  onKeyDown={e => e.key === 'Enter' && handleTrimAdd()}
                                  placeholder={t('rooms.actions.trimNoteExample')}
                                  className="w-full px-3 py-1.5 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                                  autoFocus
                                />
                              </div>
                              <div className="flex gap-2">
                                <button
                                  onClick={handleTrimAdd}
                                  className="px-3 py-1.5 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-500"
                                >
                                  {t('rooms.save')}
                                </button>
                                <button
                                  onClick={() => {
                                    setTrimFormOpen(false);
                                    setTrimDate(new Date().toISOString().slice(0, 10));
                                    setTrimNote('');
                                  }}
                                  className="px-3 py-1.5 bg-dark-600 text-dark-300 rounded-lg text-sm hover:bg-dark-500"
                                >
                                  {t('rooms.cancel')}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Defoliation */}
                        <div>
                          <button
                            onClick={() => setDefolFormOpen(!defolFormOpen)}
                            className="text-sm text-primary-400 hover:text-primary-300"
                          >
                            + {t('rooms.actions.recordDefoliation')}
                          </button>
                          {defolFormOpen && (
                            <div className="mt-2 space-y-2 p-3 bg-dark-700/50 rounded-lg border border-dark-600">
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <label className="block text-xs text-dark-400 mb-1">{t('rooms.actions.date')}</label>
                                  <input
                                    type="date"
                                    value={defolDate}
                                    onChange={e => setDefolDate(e.target.value)}
                                    className="w-full px-3 py-1.5 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                                  />
                                </div>
                                <div>
                                  <label className="block text-xs text-dark-400 mb-1">{t('rooms.actions.note')}</label>
                                  <input
                                    type="text"
                                    value={defolNote}
                                    onChange={e => setDefolNote(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && handleDefoliationAdd()}
                                    placeholder={t('rooms.actions.optional')}
                                    className="w-full px-3 py-1.5 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                                    autoFocus
                                  />
                                </div>
                              </div>
                              <div className="flex gap-2">
                                <button
                                  onClick={handleDefoliationAdd}
                                  className="px-3 py-1.5 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-500"
                                >
                                  {t('rooms.save')}
                                </button>
                                <button
                                  onClick={() => { setDefolFormOpen(false); setDefolNote(''); }}
                                  className="px-3 py-1.5 bg-dark-600 text-dark-300 rounded-lg text-sm hover:bg-dark-500"
                                >
                                  {t('rooms.cancel')}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Custom action */}
                        <div>
                          <button
                            onClick={() => setCustomFormOpen(!customFormOpen)}
                            className="text-sm text-primary-400 hover:text-primary-300"
                          >
                            + {t('rooms.actions.otherAction')}
                          </button>
                          {customFormOpen && (
                            <div className="mt-2 space-y-2 p-3 bg-dark-700/50 rounded-lg border border-dark-600">
                              <div>
                                <label className="block text-xs text-dark-400 mb-1">{t('rooms.actions.actionName')}</label>
                                <input
                                  type="text"
                                  value={customTitle}
                                  onChange={e => setCustomTitle(e.target.value)}
                                  placeholder={t('rooms.actions.actionPlaceholder')}
                                  className="w-full px-3 py-1.5 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                                  autoFocus
                                />
                              </div>
                              <div>
                                <label className="block text-xs text-dark-400 mb-1">{t('rooms.actions.date')}</label>
                                <input
                                  type="date"
                                  value={customDate}
                                  onChange={e => setCustomDate(e.target.value)}
                                  className="w-full px-3 py-1.5 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                                />
                              </div>
                              <div className="flex gap-2">
                                <button
                                  onClick={handleCustomAdd}
                                  disabled={!customTitle.trim()}
                                  className="px-3 py-1.5 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-500 disabled:opacity-50"
                                >
                                  {t('rooms.save')}
                                </button>
                                <button
                                  onClick={() => { setCustomFormOpen(false); setCustomTitle(''); setCustomNote(''); }}
                                  className="px-3 py-1.5 bg-dark-600 text-dark-300 rounded-lg text-sm hover:bg-dark-500"
                                >
                                  {t('rooms.cancel')}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Notes */}
                      <div className="space-y-2 border-t border-dark-700 pt-4">
                        <h4 className="text-sm font-medium text-dark-300">{t('rooms.notes.title')}</h4>
                        {selectedRoom.notes && (
                          <p className="text-sm text-dark-300 whitespace-pre-wrap bg-dark-700/30 rounded-lg p-3 max-h-32 overflow-y-auto">
                            {selectedRoom.notes}
                          </p>
                        )}
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={noteInput}
                            onChange={e => setNoteInput(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleAddNote()}
                            placeholder={t('rooms.notes.addPlaceholder')}
                            className="flex-1 px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                          />
                          <button
                            onClick={handleAddNote}
                            disabled={noteSaving || !noteInput.trim()}
                            className="px-3 py-2 bg-dark-700 text-white rounded-lg text-sm hover:bg-dark-600 disabled:opacity-50"
                          >
                            {noteSaving ? '...' : '+'}
                          </button>
                        </div>
                      </div>

                      {/* Work history */}
                      {tasksLoading ? (
                        <div className="text-dark-500 text-sm border-t border-dark-700 pt-4">{t('rooms.history.loading')}</div>
                      ) : completedTasks.length > 0 && (
                        <div className="space-y-2 border-t border-dark-700 pt-4">
                          <h4 className="text-sm font-medium text-dark-300">{t('rooms.history.title')}</h4>
                          <div className="space-y-1 max-h-40 overflow-y-auto">
                            {completedTasks.map(task => (
                              <div key={task._id} className="flex items-center justify-between text-xs py-1.5 px-2 hover:bg-dark-700/30 rounded group">
                                <div className="flex items-center gap-2 min-w-0 flex-1">
                                  <span className="text-green-400 shrink-0">&#10003;</span>
                                  <span className="text-dark-300 truncate">{task.title}</span>
                                  {task.description && (
                                    <span className="text-dark-500 text-xs">({task.description})</span>
                                  )}
                                </div>
                                <div className="flex items-center gap-2 shrink-0 ml-2">
                                  <span className="text-dark-500">{formatDate(task.completedAt)}</span>
                                  <button
                                    onClick={() => handleDeleteTask(task._id)}
                                    className="text-dark-500 hover:text-red-400 hover:bg-red-900/20 px-1.5 py-0.5 rounded transition"
                                    title={t('rooms.history.deleteTask')}
                                  >
                                    &#10005;
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Action buttons */}
                      <div className="flex flex-wrap gap-2 pt-4 border-t border-dark-700">
                        <button
                          onClick={startEditMode}
                          className="px-4 py-2 bg-dark-700 text-white rounded-lg hover:bg-dark-600 transition"
                        >
                          {t('rooms.buttons.edit')}
                        </button>
                        <button
                          onClick={() => { setMapMode(true); setEditMode(false); setSettingsMode(false); }}
                          className="px-4 py-2 bg-dark-700 text-white rounded-lg hover:bg-dark-600 transition"
                        >
                          {t('rooms.buttons.map')}
                        </button>
                        {inactiveRooms.length > 0 && (
                          <button
                            onClick={() => {
                              setTransferMode(true);
                              setTransferTarget('');
                              setTransferReason('');
                              setTransferStrains(
                                (selectedRoom.flowerStrains || []).map(s => ({
                                  strain: s.strain || '',
                                  original: s.quantity || 0,
                                  transfer: s.quantity || 0
                                }))
                              );
                              setEditMode(false);
                              setSettingsMode(false);
                              setMapMode(false);
                            }}
                            className="px-4 py-2 bg-blue-800 text-blue-200 rounded-lg hover:bg-blue-700 transition"
                          >
                            {t('rooms.buttons.transfer')}
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {selectedRoom.plannedCycle ? (
                        <div className="bg-dark-700/50 rounded-lg p-4 text-left">
                          <div className="text-xs text-dark-400 mb-2">{t('rooms.plan.planned')}</div>
                          <div className="text-white font-medium">{selectedRoom.plannedCycle.cycleName || selectedRoom.plannedCycle.strain || t('rooms.plan.cycle')}</div>
                          {selectedRoom.plannedCycle.strain && selectedRoom.plannedCycle.cycleName && (
                            <div className="text-dark-300 text-sm">{selectedRoom.plannedCycle.strain}</div>
                          )}
                          <div className="text-dark-400 text-sm mt-2">
                            {selectedRoom.plannedCycle.plannedStartDate && `${t('rooms.plan.start')}: ${formatDate(selectedRoom.plannedCycle.plannedStartDate)} · `}
                            {selectedRoom.plannedCycle.plantsCount > 0 && `${selectedRoom.plannedCycle.plantsCount} ${t('rooms.form.plantsWord')}`}
                          </div>
                        </div>
                      ) : (
                        <p className="text-dark-400 text-sm">{t('rooms.plan.noPlan')}</p>
                      )}
                      <div className="flex flex-wrap gap-2 pt-2 border-t border-dark-700">
                        <button
                          onClick={() => openPlanMode(selectedRoom)}
                          className="px-4 py-2 bg-dark-700 text-white rounded-lg hover:bg-dark-600 transition"
                        >
                          {selectedRoom.plannedCycle ? t('rooms.plan.editPlan') : t('rooms.plan.planBtn')}
                        </button>
                        <button
                          onClick={startStartMode}
                          className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-500 transition font-medium"
                        >
                          {t('rooms.startNewCycle')}
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Plan cycle modal */}
      {planMode && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60" onClick={closePlanMode}>
          <div
            className="bg-dark-800 rounded-xl border border-dark-600 shadow-xl w-full max-w-md p-6"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-white mb-1">{t('rooms.planModal.title')} · {planMode.name}</h3>
            <p className="text-sm text-dark-400 mb-4">{t('rooms.planModal.subtitle')}</p>
            <form onSubmit={handlePlanSubmit} className="space-y-4">
              <div>
                <label className="block text-xs text-dark-400 mb-1">{t('rooms.form.cycleName')}</label>
                <input
                  type="text"
                  value={planForm.cycleName}
                  onChange={e => setPlanForm(f => ({ ...f, cycleName: e.target.value }))}
                  className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                  placeholder={t('rooms.planModal.cycleNamePlaceholder')}
                />
              </div>
              <div>
                <label className="block text-xs text-dark-400 mb-1">{t('rooms.form.strain')}</label>
                <StrainSelect
                  value={planForm.strain}
                  onChange={(val) => setPlanForm(f => ({ ...f, strain: val }))}
                  className="w-full px-3 py-2 rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-dark-400 mb-1">{t('rooms.planModal.plannedStartDate')}</label>
                <input
                  type="date"
                  value={planForm.plannedStartDate}
                  onChange={e => setPlanForm(f => ({ ...f, plannedStartDate: e.target.value }))}
                  className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-dark-400 mb-1">{t('rooms.form.plants')}</label>
                  <input
                    type="number"
                    min="0"
                    value={planForm.plantsCount}
                    onChange={e => setPlanForm(f => ({ ...f, plantsCount: e.target.value }))}
                    className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-dark-400 mb-1">{t('rooms.form.floweringDays')}</label>
                  <input
                    type="number"
                    min="1"
                    value={planForm.floweringDays}
                    onChange={e => setPlanForm(f => ({ ...f, floweringDays: e.target.value }))}
                    className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs text-dark-400 mb-1">{t('rooms.form.notes')}</label>
                <textarea
                  value={planForm.notes}
                  onChange={e => setPlanForm(f => ({ ...f, notes: e.target.value }))}
                  rows={2}
                  className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm resize-none"
                  placeholder={t('rooms.planModal.notesPlaceholder')}
                />
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-2">
                <button
                  type="submit"
                  disabled={planSaving}
                  className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-500 transition font-medium disabled:opacity-50"
                >
                  {planSaving ? t('rooms.saving') : t('rooms.planModal.savePlan')}
                </button>
                {planMode.plannedCycle?._id && (
                  <button
                    type="button"
                    onClick={handlePlanDelete}
                    disabled={planSaving}
                    className="px-4 py-2 text-red-400 hover:bg-red-900/30 rounded-lg transition text-sm"
                  >
                    {t('rooms.planModal.deletePlan')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={closePlanMode}
                  className="px-4 py-2 text-dark-400 hover:bg-dark-700 rounded-lg transition text-sm"
                >
                  {t('rooms.cancel')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
