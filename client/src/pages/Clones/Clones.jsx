import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { roomService } from '../../services/roomService';
import { cloneCutService } from '../../services/cloneCutService';
import { vegBatchService } from '../../services/vegBatchService';

const WEEKS_BEFORE = 4;
const DAYS_OFFSET = WEEKS_BEFORE * 7;

const formatDate = (date) => {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const getStrainsFromCut = (cut) => {
  if (!cut) return [];
  if (Array.isArray(cut.strains) && cut.strains.length > 0) {
    return cut.strains.map((s) => ({ strain: s.strain || '', quantity: Number(s.quantity) || 0 }));
  }
  if (cut.strain || cut.quantity > 0) {
    return [{ strain: cut.strain || '', quantity: Number(cut.quantity) || 0 }];
  }
  return [];
};

const formatStrainsShort = (strains) => {
  if (!Array.isArray(strains) || strains.length === 0) return '—';
  return strains.map((s) => (s.strain ? `${s.strain} (${s.quantity})` : s.quantity)).filter(Boolean).join(', ') || '—';
};

/** Есть ли хотя бы один сорт с количеством > 0 */
const rowHasStrainData = (row) => {
  const list = row?.strains || [];
  return list.some((s) => Number(s?.quantity) > 0);
};

const orderCutHasStrainData = (cut) => getStrainsFromCut(cut).some((s) => Number(s?.quantity) > 0);

const getCutDateForRoom = (room) => {
  if (room.plannedCycle?.plannedStartDate) {
    const d = new Date(room.plannedCycle.plannedStartDate);
    d.setDate(d.getDate() - DAYS_OFFSET);
    return d;
  }
  if (room.isActive && room.expectedHarvestDate) {
    const d = new Date(room.expectedHarvestDate);
    d.setDate(d.getDate() - DAYS_OFFSET);
    return d;
  }
  return null;
};

const Clones = () => {
  const { hasPermission } = useAuth();
  const canCreateClones = hasPermission && hasPermission('clones:create');
  const canCreateVeg = hasPermission && hasPermission('vegetation:create');

  const [rooms, setRooms] = useState([]);
  const [cloneCuts, setCloneCuts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingId, setSavingId] = useState(null);
  const [editRow, setEditRow] = useState(null);
  const [editForm, setEditForm] = useState({ strains: [{ strain: '', quantity: '' }], isDone: false });
  const [sendToVegModal, setSendToVegModal] = useState(null);
  const [vegForm, setVegForm] = useState({ name: '', strains: [], transplantedToVegAt: new Date().toISOString().slice(0, 10), vegDaysTarget: '21' });
  const [vegBatches, setVegBatches] = useState([]);
  const [editingBatchNameId, setEditingBatchNameId] = useState(null);
  const [editingBatchName, setEditingBatchName] = useState('');
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [modalStrains, setModalStrains] = useState([]);
  const editModalWasOpen = useRef(false);
  const [addOrderModal, setAddOrderModal] = useState(false);
  const [orderForm, setOrderForm] = useState({ cutDate: new Date().toISOString().slice(0, 10), strains: [{ strain: '', quantity: '' }], notes: '' });
  const [orderEditModal, setOrderEditModal] = useState(null);
  const [orderEditForm, setOrderEditForm] = useState({ cutDate: '', isDone: false, notes: '' });
  const [orderModalStrains, setOrderModalStrains] = useState([]);
  const orderModalStrainKey = useRef(0);
  const [savingOrderId, setSavingOrderId] = useState(null);
  const [createBatchModalOpen, setCreateBatchModalOpen] = useState(false);
  const [createBatchForm, setCreateBatchForm] = useState({
    roomId: '',
    cutDate: new Date().toISOString().slice(0, 10),
    strains: [{ strain: '', quantity: '' }],
    notes: '',
    isDone: false
  });
  const [savingCreateBatch, setSavingCreateBatch] = useState(false);
  const [archivedCuts, setArchivedCuts] = useState([]);
  const [restoringId, setRestoringId] = useState(null);

  useEffect(() => {
    load();
  }, []);

  // При открытии модалки «Заполнить / изменить» гарантированно заполняем список сортов (минимум 2 строки)
  const nextStrainKey = useRef(0);
  useEffect(() => {
    if (editModalOpen && editRow) {
      if (!editModalWasOpen.current) {
        let list = Array.isArray(editRow.strains) && editRow.strains.length > 0
          ? editRow.strains.map((s) => ({ strain: String(s.strain ?? ''), quantity: String(s.quantity ?? ''), _key: nextStrainKey.current++ }))
          : (editRow.strain || editRow.quantity ? [{ strain: String(editRow.strain ?? ''), quantity: String(editRow.quantity ?? ''), _key: nextStrainKey.current++ }] : []);
        while (list.length < 2) list.push({ strain: '', quantity: '', _key: nextStrainKey.current++ });
        setModalStrains(list);
        editModalWasOpen.current = true;
      }
    } else {
      editModalWasOpen.current = false;
    }
  }, [editModalOpen, editRow]);

  const load = async () => {
    try {
      setLoading(true);
      setError('');
      const roomsData = await roomService.getRoomsSummary();
      setRooms(Array.isArray(roomsData) ? roomsData : []);
      let cutsData = [];
      let allVegBatches = [];
      let deletedCuts = [];
      try {
        cutsData = await cloneCutService.getAll();
      } catch (cutsErr) {
        console.error('Clone cuts load error:', cutsErr);
        const msg = cutsErr.response?.data?.message || cutsErr.message;
        const status = cutsErr.response?.status;
        const is404 = status === 404;
        const is501 = status === 501;
        const isNetwork =
          cutsErr.code === 'ECONNREFUSED' ||
          cutsErr.code === 'ERR_NETWORK' ||
          (typeof cutsErr.message === 'string' && (cutsErr.message.includes('Network') || cutsErr.message.includes('network')));
        const needBackendRestart = is404 || is501 || isNetwork;
        setError(
          needBackendRestart
            ? 'Не удалось загрузить данные нарезки. Убедитесь, что бэкенд запущен и перезапущен после обновления.'
            : msg || 'Ошибка загрузки данных нарезки'
        );
      }
      try {
        allVegBatches = await vegBatchService.getAll();
      } catch (_) {}
      let deletedVegBatches = [];
      try {
        deletedVegBatches = await vegBatchService.getDeleted();
      } catch (_) {}
      try {
        deletedCuts = await cloneCutService.getDeleted();
      } catch (_) {}
      setCloneCuts(Array.isArray(cutsData) ? cutsData : []);
      // Объединяем активные и удалённые vegBatches для подсчёта суммарного количества клонов
      const allBatches = [
        ...(Array.isArray(allVegBatches) ? allVegBatches : []),
        ...(Array.isArray(deletedVegBatches) ? deletedVegBatches : [])
      ];
      setVegBatches(allBatches);
      setArchivedCuts(Array.isArray(deletedCuts) ? deletedCuts : []);
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Ошибка загрузки комнат');
      console.error('Clones load error:', err);
      setRooms([]);
      setCloneCuts([]);
      setVegBatches([]);
      setArchivedCuts([]);
    } finally {
      setLoading(false);
    }
  };

  const rows = (Array.isArray(rooms) ? rooms : [])
    .filter((r) => r != null)
    .map((room) => {
      const cut = cloneCuts.find((c) => c.room?._id === room._id || c.room === room._id);
      const cutDate = (cut?.cutDate ? new Date(cut.cutDate) : null) || getCutDateForRoom(room);
      if (!cutDate && !cut) return null;
      const cutId = cut?._id;
      const strains = getStrainsFromCut(cut);
      const quantity = strains.reduce((sum, s) => sum + s.quantity, 0);
      const strain = (strains.map((s) => s.strain).filter(Boolean).join(', ') || cut?.strain) ?? '';
      const hasTransplanted = cutId && (Array.isArray(vegBatches) ? vegBatches : []).some(
        (b) => String(b.sourceCloneCut?._id || b.sourceCloneCut || '') === String(cutId)
      );
      return {
        room,
        cutDate: cutDate || (cut?.cutDate ? new Date(cut.cutDate) : new Date()),
        strain,
        quantity,
        strains,
        isDone: cut?.isDone ?? false,
        cutId,
        hasTransplanted
      };
    })
    .filter(Boolean);

  const logBatches = (Array.isArray(vegBatches) ? vegBatches : [])
    .filter((b) => b.sourceCloneCut != null)
    .sort((a, b) => new Date(b.transplantedToVegAt) - new Date(a.transplantedToVegAt));

  const orderCuts = (Array.isArray(cloneCuts) ? cloneCuts : []).filter((c) => !c.room);

  const openEdit = (row) => {
    setEditRow(row);
    let list = Array.isArray(row.strains) && row.strains.length > 0
      ? row.strains.map((s) => ({ strain: String(s.strain ?? ''), quantity: String(s.quantity ?? '') }))
      : (row.strain || row.quantity ? [{ strain: String(row.strain ?? ''), quantity: String(row.quantity ?? '') }] : []);
    while (list.length < 2) list.push({ strain: '', quantity: '' });
    setModalStrains(list);
    setEditForm({ isDone: row.isDone, cutDate: row.cutDate ? new Date(row.cutDate).toISOString().slice(0, 10) : '' });
    setEditModalOpen(true);
  };

  const addEditStrainRow = () => {
    setModalStrains((prev) => [...(prev || []), { strain: '', quantity: '', _key: nextStrainKey.current++ }]);
  };

  const removeEditStrainRow = (index) => {
    setModalStrains((prev) => prev.filter((_, i) => i !== index));
  };

  const updateEditStrainRow = (index, field, value) => {
    setModalStrains((prev) =>
      prev.map((s, i) => (i === index ? { ...s, [field]: value } : s))
    );
  };

  const closeEdit = () => {
    setEditRow(null);
    setEditModalOpen(false);
  };

  const handleSave = async () => {
    if (!editRow) return;
    const { room, cutId } = editRow;
    const strains = (modalStrains || [])
      .map((s) => ({ strain: String(s.strain || '').trim(), quantity: Number(s.quantity) || 0 }))
      .filter((s) => s.strain !== '' || s.quantity > 0);
    if (editForm.isDone && (strains.length === 0 || strains.every((s) => s.quantity === 0))) {
      setError('При отметке «Нарезано» укажите хотя бы один сорт и количество нарезанного.');
      return;
    }
    try {
      setSavingId(room._id);
      const payload = {
        roomId: room._id,
        cutDate: editForm.cutDate || editRow.cutDate?.toISOString?.()?.slice(0, 10) || '',
        strains: strains.length ? strains : [{ strain: '', quantity: 0 }],
        isDone: editForm.isDone
      };
      if (cutId) {
        await cloneCutService.update(cutId, payload);
      } else {
        await cloneCutService.upsert(payload);
      }
      closeEdit();
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка сохранения');
      console.error(err);
    } finally {
      setSavingId(null);
    }
  };

  const openSendToVeg = (row) => {
    setSendToVegModal(row);
    const list = (row.strains || []).map((s) => ({ strain: s.strain || '', total: s.quantity || 0, sendQty: String(s.quantity || 0) }));
    setVegForm({
      name: `${row.room.name} · ${row.strain || 'клоны'}`.trim(),
      strains: list.length ? list : [{ strain: '', total: 0, sendQty: '' }],
      transplantedToVegAt: new Date().toISOString().slice(0, 10),
      vegDaysTarget: '21'
    });
  };

  const openSendToVegFromOrder = (cut) => {
    const strains = getStrainsFromCut(cut);
    const row = {
      room: { name: 'Бэтч на заказ', _id: null },
      cutDate: cut.cutDate,
      cutId: cut._id,
      strain: strains.map((s) => s.strain).filter(Boolean).join(', ') || 'клоны',
      strains
    };
    openSendToVeg(row);
  };

  const updateVegFormStrain = (index, field, value) => {
    setVegForm((f) => ({
      ...f,
      strains: f.strains.map((s, i) => i === index ? { ...s, [field]: value } : s)
    }));
  };

  const saveBatchName = async (batchId) => {
    if (editingBatchNameId !== batchId) return;
    const value = (editingBatchName || '').trim();
    try {
      await vegBatchService.update(batchId, { name: value });
      setEditingBatchNameId(null);
      setEditingBatchName('');
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка сохранения названия');
    }
  };

  const handleSendToVeg = async (e) => {
    e.preventDefault();
    if (!sendToVegModal) return;
    const strains = (vegForm.strains || [])
      .map((s) => ({ strain: s.strain || '', quantity: Number(s.sendQty) || 0 }))
      .filter((s) => s.quantity > 0);
    if (strains.length === 0) {
      setError('Укажите количество хотя бы по одному сорту');
      return;
    }
    try {
      setSavingId(sendToVegModal.cutId || sendToVegModal.room?._id);
      await vegBatchService.create({
        name: (vegForm.name || '').trim(),
        sourceCloneCut: sendToVegModal.cutId || undefined,
        strains,
        cutDate: sendToVegModal.cutDate.toISOString().slice(0, 10),
        transplantedToVegAt: vegForm.transplantedToVegAt,
        vegDaysTarget: Number(vegForm.vegDaysTarget) || 21,
        notes: ''
      });
      setSendToVegModal(null);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка отправки в вегетацию');
      console.error(err);
    } finally {
      setSavingId(null);
    }
  };

  const openAddOrderModal = () => {
    setOrderForm({ cutDate: new Date().toISOString().slice(0, 10), strains: [{ strain: '', quantity: '' }], notes: '' });
    setAddOrderModal(true);
  };

  const openCreateBatchModal = () => {
    const allRooms = rooms || [];
    const firstRoomId = allRooms.length ? allRooms[0]._id : '';
    const firstRoom = firstRoomId ? allRooms.find((r) => r._id === firstRoomId) : null;
    const suggestedDate = firstRoom && getCutDateForRoom(firstRoom)
      ? getCutDateForRoom(firstRoom).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10);
    setCreateBatchForm({
      roomId: firstRoomId,
      cutDate: suggestedDate,
      strains: [{ strain: '', quantity: '' }],
      notes: '',
      isDone: false
    });
    setCreateBatchModalOpen(true);
  };

  const addCreateBatchStrainRow = () => {
    setCreateBatchForm((f) => ({ ...f, strains: [...(f.strains || []), { strain: '', quantity: '' }] }));
  };
  const removeCreateBatchStrainRow = (idx) => {
    setCreateBatchForm((f) => ({ ...f, strains: (f.strains || []).filter((_, i) => i !== idx) }));
  };
  const updateCreateBatchStrainRow = (idx, field, value) => {
    setCreateBatchForm((f) => ({
      ...f,
      strains: (f.strains || []).map((s, i) => (i === idx ? { ...s, [field]: value } : s))
    }));
  };

  const handleCreateBatchSubmit = async (e) => {
    e.preventDefault();
    const strains = (createBatchForm.strains || [])
      .map((s) => ({ strain: String(s.strain || '').trim(), quantity: Number(s.quantity) || 0 }))
      .filter((s) => s.strain !== '' || s.quantity > 0);
    if (strains.length === 0) {
      setError('Укажите хотя бы один сорт и количество');
      return;
    }
    setSavingCreateBatch(true);
    setError('');
    try {
      if (createBatchForm.roomId) {
        await cloneCutService.upsert({
          roomId: createBatchForm.roomId,
          cutDate: createBatchForm.cutDate,
          strains,
          notes: (createBatchForm.notes || '').trim(),
          isDone: Boolean(createBatchForm.isDone)
        });
      } else {
        await cloneCutService.createOrder({
          cutDate: createBatchForm.cutDate,
          strains,
          notes: (createBatchForm.notes || '').trim(),
          isDone: Boolean(createBatchForm.isDone)
        });
      }
      setCreateBatchModalOpen(false);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка создания бэтча');
    } finally {
      setSavingCreateBatch(false);
    }
  };

  const addOrderFormStrainRow = () => {
    setOrderForm((f) => ({ ...f, strains: [...(f.strains || []), { strain: '', quantity: '' }] }));
  };

  const removeOrderFormStrainRow = (index) => {
    setOrderForm((f) => ({ ...f, strains: (f.strains || []).filter((_, i) => i !== index) }));
  };

  const updateOrderFormStrainRow = (index, field, value) => {
    setOrderForm((f) => ({
      ...f,
      strains: (f.strains || []).map((s, i) => (i === index ? { ...s, [field]: value } : s))
    }));
  };

  const handleAddOrderSubmit = async (e) => {
    e.preventDefault();
    const strains = (orderForm.strains || [])
      .map((s) => ({ strain: String(s.strain || '').trim(), quantity: Number(s.quantity) || 0 }))
      .filter((s) => s.strain !== '' || s.quantity > 0);
    if (strains.length === 0) {
      setError('Укажите хотя бы один сорт и количество');
      return;
    }
    try {
      setSavingOrderId('add');
      await cloneCutService.createOrder({
        cutDate: orderForm.cutDate,
        strains,
        notes: (orderForm.notes || '').trim()
      });
      setAddOrderModal(false);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка создания бэтча');
    } finally {
      setSavingOrderId(null);
    }
  };

  const openEditOrder = (cut) => {
    const list = getStrainsFromCut(cut);
    const withKeys = (list.length ? list : [{ strain: '', quantity: 0 }]).map((s) => ({
      strain: String(s.strain ?? ''),
      quantity: String(s.quantity ?? ''),
      _key: orderModalStrainKey.current++
    }));
    setOrderModalStrains(withKeys.length >= 2 ? withKeys : [...withKeys, { strain: '', quantity: '', _key: orderModalStrainKey.current++ }]);
    setOrderEditForm({
      cutDate: cut.cutDate ? new Date(cut.cutDate).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
      isDone: Boolean(cut.isDone),
      notes: (cut.notes || '').trim()
    });
    setOrderEditModal(cut);
  };

  const addOrderEditStrainRow = () => {
    setOrderModalStrains((prev) => [...(prev || []), { strain: '', quantity: '', _key: orderModalStrainKey.current++ }]);
  };

  const removeOrderEditStrainRow = (index) => {
    setOrderModalStrains((prev) => prev.filter((_, i) => i !== index));
  };

  const updateOrderEditStrainRow = (index, field, value) => {
    setOrderModalStrains((prev) =>
      prev.map((s, i) => (i === index ? { ...s, [field]: value } : s))
    );
  };

  const handleSaveOrderEdit = async () => {
    if (!orderEditModal) return;
    const strains = (orderModalStrains || [])
      .map((s) => ({ strain: String(s.strain || '').trim(), quantity: Number(s.quantity) || 0 }))
      .filter((s) => s.strain !== '' || s.quantity > 0);
    if (orderEditForm.isDone && (strains.length === 0 || strains.every((s) => s.quantity === 0))) {
      setError('При отметке «Нарезано» укажите хотя бы один сорт и количество нарезанного.');
      return;
    }
    try {
      setSavingOrderId(orderEditModal._id);
      await cloneCutService.update(orderEditModal._id, {
        cutDate: orderEditForm.cutDate,
        strains: strains.length ? strains : [{ strain: '', quantity: 0 }],
        isDone: orderEditForm.isDone,
        notes: (orderEditForm.notes || '').trim()
      });
      setOrderEditModal(null);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка сохранения');
    } finally {
      setSavingOrderId(null);
    }
  };

  const toggleOrderDone = async (cut) => {
    if (!cut.isDone && !orderCutHasStrainData(cut)) {
      setError('');
      openEditOrder(cut);
      setOrderEditForm((f) => ({ ...f, isDone: true }));
      return;
    }
    try {
      setSavingOrderId(cut._id);
      const strains = getStrainsFromCut(cut);
      await cloneCutService.update(cut._id, {
        cutDate: cut.cutDate,
        strains: strains.length ? strains : [{ strain: cut.strain, quantity: cut.quantity }],
        isDone: !cut.isDone,
        notes: (cut.notes || '').trim()
      });
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка');
    } finally {
      setSavingOrderId(null);
    }
  };

  const deleteOrderCut = async (cut) => {
    if (!confirm('Удалить этот бэтч на заказ?')) return;
    try {
      setSavingOrderId(cut._id);
      await cloneCutService.delete(cut._id);
      setOrderEditModal(null);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка удаления');
    } finally {
      setSavingOrderId(null);
    }
  };

  const handleDispose = async (cutId, quantity, roomId) => {
    if (!cutId) return;
    if (!confirm(`Списать оставшиеся ${quantity} клонов?`)) return;
    try {
      setSavingId(roomId || cutId);
      await cloneCutService.disposeRemaining(cutId);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка списания');
    } finally {
      setSavingId(null);
    }
  };

  const restoreArchivedCut = async (cut) => {
    try {
      setRestoringId(cut._id);
      await cloneCutService.restore(cut._id);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка восстановления');
    } finally {
      setRestoringId(null);
    }
  };

  const toggleDone = async (row) => {
    const { room, cutDate, cutId, isDone } = row;
    if (!isDone && !rowHasStrainData(row)) {
      setError('');
      openEdit(row);
      setEditForm((f) => ({ ...f, isDone: true }));
      return;
    }
    try {
      setSavingId(room._id);
      const payload = {
        roomId: room._id,
        cutDate: cutDate.toISOString().slice(0, 10),
        strains: row.strains && row.strains.length ? row.strains : [{ strain: row.strain, quantity: row.quantity }],
        isDone: !isDone
      };
      if (cutId) {
        await cloneCutService.update(cutId, payload);
      } else {
        await cloneCutService.upsert(payload);
      }
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка');
      console.error(err);
    } finally {
      setSavingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500" />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">План нарезки клонов</h1>
          <p className="text-dark-400 mt-1">
            Клоны режутся за {WEEKS_BEFORE} недели до даты цветения. Укажите сорт и количество, отметьте, если уже нарезаны.
          </p>
        </div>
        {canCreateClones && (
          <button
            type="button"
            onClick={openCreateBatchModal}
            className="px-5 py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-500 font-medium shadow-lg"
          >
            Создать бэтч
          </button>
        )}
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-800 text-red-400 px-4 py-3 rounded-lg mb-6 flex flex-wrap items-center gap-3">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => { setError(''); load(); }}
            className="px-3 py-1.5 bg-red-800/50 hover:bg-red-700/50 rounded-lg text-sm font-medium"
          >
            Повторить
          </button>
        </div>
      )}

      <div className="bg-dark-800 rounded-xl border border-dark-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-dark-900">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-dark-400 uppercase tracking-wider">Комната</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-dark-400 uppercase tracking-wider">Дата нарезки</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-dark-400 uppercase tracking-wider">Клон / сорт</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-dark-400 uppercase tracking-wider">Кол-во</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-dark-400 uppercase tracking-wider">Статус</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-dark-400 uppercase tracking-wider">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dark-700">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-dark-500">
                    Нет комнат с запланированной датой цветения или активным циклом. Задайте планируемый цикл в обзоре фермы.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr
                    key={row.room._id}
                    className={`hover:bg-dark-700/50 ${row.isDone ? 'bg-green-900/10' : 'bg-red-900/5'}`}
                  >
                    <td className="px-4 py-3 font-medium text-white">{row.room.name}</td>
                    <td className="px-4 py-3 text-dark-300">{formatDate(row.cutDate)}</td>
                    <td className="px-4 py-3 text-dark-300">{formatStrainsShort(row.strains)}</td>
                    <td className="px-4 py-3 text-dark-300">{row.quantity > 0 ? row.quantity : '—'}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex px-2 py-1 text-xs font-medium rounded ${
                          row.hasTransplanted
                            ? 'bg-primary-900/50 text-primary-400'
                            : row.isDone
                              ? 'bg-green-900/50 text-green-400'
                              : 'bg-red-900/50 text-red-400'
                        }`}
                      >
                        {row.hasTransplanted ? 'Пересажено' : row.isDone ? 'Нарезано' : 'Не нарезано'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2 flex-wrap">
                          {canCreateClones ? (
                            <>
                              <button
                                type="button"
                                onClick={() => openSendToVeg(row)}
                                disabled={savingId === row.room._id}
                                className="px-2 py-1 bg-green-700/50 text-green-400 hover:bg-green-700/70 rounded text-xs font-medium"
                              >
                                В вегетацию
                              </button>
                              <button
                                type="button"
                                onClick={() => toggleDone(row)}
                                disabled={savingId === row.room._id}
                                className={`px-2 py-1 rounded text-xs font-medium ${
                                  row.isDone
                                    ? 'bg-red-900/30 text-red-400 hover:bg-red-900/50'
                                    : 'bg-green-900/30 text-green-400 hover:bg-green-900/50'
                                }`}
                              >
                                {row.isDone ? 'Снять отметку' : 'Отметить нарезано'}
                              </button>
                              <button
                                type="button"
                                onClick={() => openEdit(row)}
                                className="px-2 py-1 text-primary-400 hover:bg-dark-700 rounded text-xs"
                              >
                                Заполнить / изменить
                              </button>
                              {row.cutId && row.quantity > 0 && (
                                <button
                                  type="button"
                                  onClick={() => handleDispose(row.cutId, row.quantity, row.room._id)}
                                  disabled={savingId === row.room._id}
                                  className="px-2 py-1 bg-orange-900/30 text-orange-400 hover:bg-orange-900/50 rounded text-xs font-medium"
                                >
                                  Списать остатки
                                </button>
                              )}
                            </>
                          ) : (
                            <span className="text-dark-500 text-xs">Только просмотр</span>
                          )}
                        </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Бэтчи на заказ (вне комнаты) */}
      <div className="mt-8 bg-dark-800 rounded-xl border border-dark-700 overflow-hidden">
        <h2 className="text-lg font-semibold text-white px-4 py-3 border-b border-dark-700">Бэтчи на заказ (вне комнаты)</h2>
        <p className="text-dark-400 text-sm px-4 py-2">
          Клоны, которые режут на заказ — не идут в вегетацию и цветение. Только учёт нарезки.
        </p>
        {canCreateClones && (
          <div className="px-4 pb-3">
            <button
              type="button"
              onClick={openAddOrderModal}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-500 transition font-medium"
            >
              Добавить бэтч на заказ
            </button>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-dark-900">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-dark-400 uppercase tracking-wider">Дата нарезки</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-dark-400 uppercase tracking-wider">Сорт / кол-во</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-dark-400 uppercase tracking-wider">Заметки</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-dark-400 uppercase tracking-wider">Статус</th>
                {canCreateClones && (
                  <th className="px-4 py-3 text-right text-xs font-semibold text-dark-400 uppercase tracking-wider">Действия</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-dark-700">
              {orderCuts.length === 0 ? (
                <tr>
                  <td colSpan={canCreateClones ? 5 : 4} className="px-4 py-6 text-center text-dark-500">
                    Нет бэтчей на заказ. Добавьте, если клоны режутся кому-то на заказ и не пойдут в вегу/цвет.
                  </td>
                </tr>
              ) : (
                orderCuts.map((cut) => {
                  const strains = getStrainsFromCut(cut);
                  const quantity = strains.reduce((s, x) => s + x.quantity, 0);
                  return (
                    <tr key={cut._id} className={`hover:bg-dark-700/50 ${cut.isDone ? 'bg-green-900/10' : ''}`}>
                      <td className="px-4 py-3 text-dark-300">{formatDate(cut.cutDate)}</td>
                      <td className="px-4 py-3 text-dark-300">{formatStrainsShort(strains)}</td>
                      <td className="px-4 py-3 text-dark-500 text-xs max-w-[200px] truncate" title={cut.notes}>{cut.notes || '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-1 text-xs font-medium rounded ${cut.isDone ? 'bg-green-900/50 text-green-400' : 'bg-red-900/50 text-red-400'}`}>
                          {cut.isDone ? 'Нарезано' : 'Не нарезано'}
                        </span>
                      </td>
                      {canCreateClones && (
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2 flex-wrap">
                            {canCreateVeg && (
                              <button
                                type="button"
                                onClick={() => openSendToVegFromOrder(cut)}
                                disabled={savingId === cut._id}
                                className="px-2 py-1 bg-green-700/50 text-green-400 hover:bg-green-700/70 rounded text-xs font-medium"
                              >
                                В вегетацию
                              </button>
                            )}
                            <button type="button" onClick={() => openEditOrder(cut)} className="px-2 py-1 text-primary-400 hover:bg-dark-700 rounded text-xs">Изменить</button>
                            <button type="button" onClick={() => toggleOrderDone(cut)} disabled={savingOrderId === cut._id} className={`px-2 py-1 rounded text-xs ${cut.isDone ? 'bg-red-900/30 text-red-400' : 'bg-green-900/30 text-green-400'}`}>
                              {cut.isDone ? 'Снять отметку' : 'Отметить нарезано'}
                            </button>
                            <button type="button" onClick={() => deleteOrderCut(cut)} disabled={savingOrderId === cut._id} className="px-2 py-1 text-red-400 hover:bg-red-900/30 rounded text-xs">Удалить</button>
                            {quantity > 0 && (
                              <button type="button" onClick={() => handleDispose(cut._id, quantity, null)} disabled={savingOrderId === cut._id} className="px-2 py-1 bg-orange-900/30 text-orange-400 hover:bg-orange-900/50 rounded text-xs font-medium">Списать</button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Модалка: заполнить / изменить нарезку (несколько сортов) */}
      {editModalOpen && editRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={closeEdit}>
          <div
            key={editRow.room?._id}
            className="bg-dark-800 rounded-xl border border-dark-600 shadow-xl w-full max-w-lg p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-white mb-1">Нарезка клонов · {editRow.room.name}</h3>
            <div className="flex items-center gap-2 mb-4">
              <span className="text-dark-400 text-sm">Дата нарезки:</span>
              <input
                type="date"
                value={editForm.cutDate || ''}
                onChange={(e) => setEditForm((f) => ({ ...f, cutDate: e.target.value }))}
                className="px-2 py-1 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
              />
            </div>
            {editForm.isDone && !rowHasStrainData(editRow) && (
              <p className="text-amber-400 text-sm mb-3 bg-amber-900/20 border border-amber-700/50 rounded-lg px-3 py-2">
                Укажите, сколько какого сорта нарезано (хотя бы один сорт и количество), затем нажмите «Сохранить».
              </p>
            )}
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-dark-400 mb-2">Сорта и количество (сейчас строк: {(modalStrains || []).length})</label>
                <div className="space-y-2">
                  {(modalStrains || []).map((s, idx) => (
                    <div key={s._key != null ? s._key : idx} className="flex items-center gap-2">
                      <span className="text-dark-500 text-xs w-12 shrink-0">{idx + 1}.</span>
                      <input
                        type="text"
                        value={s.strain}
                        onChange={(e) => updateEditStrainRow(idx, 'strain', e.target.value)}
                        placeholder="Сорт"
                        className="flex-1 min-w-0 px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                      />
                      <input
                        type="number"
                        min="0"
                        value={s.quantity}
                        onChange={(e) => updateEditStrainRow(idx, 'quantity', e.target.value)}
                        placeholder="Кол-во"
                        className="w-20 px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                      />
                      {(modalStrains || []).length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeEditStrainRow(idx)}
                          className="p-2 text-red-400 hover:text-red-300 hover:bg-red-900/30 rounded-lg shrink-0"
                          title="Удалить строку"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); addEditStrainRow(); }}
                    className="flex items-center justify-center gap-2 w-full py-3 bg-primary-600/30 border-2 border-primary-500 text-primary-300 hover:bg-primary-600/50 hover:text-white rounded-lg text-sm font-semibold"
                  >
                    <span className="text-2xl leading-none">+</span>
                    <span>Добавить сорт (ещё одна строка)</span>
                  </button>
                </div>
              </div>
              <label className="flex items-center gap-2 text-dark-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editForm.isDone}
                  onChange={(e) => setEditForm((f) => ({ ...f, isDone: e.target.checked }))}
                  className="rounded"
                />
                <span>Нарезано</span>
              </label>
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={closeEdit} className="px-4 py-2 text-dark-400 hover:bg-dark-700 rounded-lg">
                  Отмена
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={savingId === editRow.room._id}
                  className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-500 disabled:opacity-50 font-medium"
                >
                  {savingId === editRow.room._id ? 'Сохранение...' : 'Сохранить'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Модалка: отправить в вегетацию */}
      {sendToVegModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={() => setSendToVegModal(null)}>
          <div
            className="bg-dark-800 rounded-xl border border-dark-600 shadow-xl w-full max-w-md p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-white mb-1">Отправить в вегетацию</h3>
            <p className="text-dark-400 text-sm mb-4">
              {sendToVegModal.room.name} · укажите, сколько какого сорта отправляете в вег
            </p>
            <form onSubmit={handleSendToVeg} className="space-y-4">
              <div>
                <label className="block text-xs text-dark-400 mb-1">Название бэтча</label>
                <input
                  type="text"
                  value={vegForm.name}
                  onChange={(e) => setVegForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Например: Комната 2 — Горилла"
                  className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-dark-400 mb-2">Количество по сортам (отправляемое в вег)</label>
                <div className="space-y-2">
                  {(vegForm.strains || []).map((s, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <span className="text-white text-sm w-28 truncate" title={s.strain}>{s.strain || '—'}</span>
                      <span className="text-dark-500 text-xs">всего: {s.total}</span>
                      <input
                        type="number"
                        min="0"
                        max={s.total}
                        value={s.sendQty}
                        onChange={(e) => updateVegFormStrain(idx, 'sendQty', e.target.value)}
                        placeholder="в вег"
                        className="flex-1 min-w-0 px-2 py-1.5 bg-dark-700 border border-dark-600 rounded text-white text-sm"
                      />
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs text-dark-400 mb-1">Дата пересадки в вегетацию</label>
                <input
                  type="date"
                  value={vegForm.transplantedToVegAt}
                  onChange={(e) => setVegForm((f) => ({ ...f, transplantedToVegAt: e.target.value }))}
                  className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-dark-400 mb-1">Цель вегетации (дней)</label>
                <input
                  type="number"
                  min="1"
                  value={vegForm.vegDaysTarget}
                  onChange={(e) => setVegForm((f) => ({ ...f, vegDaysTarget: e.target.value }))}
                  className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setSendToVegModal(null)} className="px-4 py-2 text-dark-400 hover:bg-dark-700 rounded-lg">
                  Отмена
                </button>
                <button type="submit" disabled={savingId === (sendToVegModal.cutId || sendToVegModal.room?._id)} className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-500 disabled:opacity-50 font-medium">
                  {savingId === (sendToVegModal.cutId || sendToVegModal.room?._id) ? 'Сохранение...' : 'Создать бэтч в вегетации'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Модалка: создать бэтч (с комнатой или без) */}
      {createBatchModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={() => setCreateBatchModalOpen(false)}>
          <div className="bg-dark-800 rounded-xl border border-dark-600 shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-white mb-2">Создать бэтч клонов</h3>
            <p className="text-dark-400 text-sm mb-4">Укажите комнату (или «Без комнаты» для бэтча на заказ), дату нарезки, сорта и количество.</p>
            <form onSubmit={handleCreateBatchSubmit} className="space-y-4">
              <div>
                <label className="block text-xs text-dark-400 mb-1">Комната</label>
                <select
                  value={createBatchForm.roomId}
                  onChange={(e) => {
                    const roomId = e.target.value;
                    const room = (rooms || []).find((r) => r._id === roomId);
                    const cutDate = room && getCutDateForRoom(room)
                      ? getCutDateForRoom(room).toISOString().slice(0, 10)
                      : (roomId ? createBatchForm.cutDate : new Date().toISOString().slice(0, 10));
                    setCreateBatchForm((f) => ({ ...f, roomId, cutDate }));
                  }}
                  className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                >
                  <option value="">— Без комнаты (на заказ) —</option>
                  {(rooms || []).map((room) => {
                    const suggestedDate = getCutDateForRoom(room);
                    return (
                      <option key={room._id} value={room._id}>
                        {room.name}{suggestedDate ? ` · нарезка ${formatDate(suggestedDate)}` : ''}
                      </option>
                    );
                  })}
                </select>
              </div>
              <div>
                <label className="block text-xs text-dark-400 mb-1">Дата нарезки</label>
                <input
                  type="date"
                  value={createBatchForm.cutDate}
                  onChange={(e) => setCreateBatchForm((f) => ({ ...f, cutDate: e.target.value }))}
                  required
                  className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-dark-400 mb-2">Сорта и количество</label>
                <div className="space-y-2">
                  {(createBatchForm.strains || []).map((s, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        type="text"
                        value={s.strain}
                        onChange={(e) => updateCreateBatchStrainRow(idx, 'strain', e.target.value)}
                        placeholder="Сорт"
                        className="flex-1 min-w-0 px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                      />
                      <input
                        type="number"
                        min="0"
                        value={s.quantity}
                        onChange={(e) => updateCreateBatchStrainRow(idx, 'quantity', e.target.value)}
                        placeholder="Кол-во"
                        className="w-20 px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                      />
                      {(createBatchForm.strains || []).length > 1 && (
                        <button type="button" onClick={() => removeCreateBatchStrainRow(idx)} className="p-2 text-red-400 hover:text-red-300 rounded">×</button>
                      )}
                    </div>
                  ))}
                  <button type="button" onClick={addCreateBatchStrainRow} className="text-primary-400 hover:text-primary-300 text-sm">+ Добавить сорт</button>
                </div>
              </div>
              <div>
                <label className="block text-xs text-dark-400 mb-1">Заметки</label>
                <textarea
                  value={createBatchForm.notes}
                  onChange={(e) => setCreateBatchForm((f) => ({ ...f, notes: e.target.value }))}
                  rows={2}
                  className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm resize-none"
                />
              </div>
              <label className="flex items-center gap-2 text-dark-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={createBatchForm.isDone}
                  onChange={(e) => setCreateBatchForm((f) => ({ ...f, isDone: e.target.checked }))}
                  className="rounded"
                />
                <span>Уже нарезано</span>
              </label>
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setCreateBatchModalOpen(false)} className="px-4 py-2 text-dark-400 hover:bg-dark-700 rounded-lg">Отмена</button>
                <button type="submit" disabled={savingCreateBatch} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-500 disabled:opacity-50 font-medium">
                  {savingCreateBatch ? 'Создание...' : 'Создать бэтч'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Модалка: добавить бэтч на заказ */}
      {addOrderModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={() => setAddOrderModal(false)}>
          <div className="bg-dark-800 rounded-xl border border-dark-600 shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-white mb-2">Добавить бэтч на заказ</h3>
            <p className="text-dark-400 text-sm mb-4">Клоны режутся кому-то на заказ — не идут в вегетацию и цветение.</p>
            <form onSubmit={handleAddOrderSubmit} className="space-y-4">
              <div>
                <label className="block text-xs text-dark-400 mb-1">Дата нарезки</label>
                <input
                  type="date"
                  value={orderForm.cutDate}
                  onChange={(e) => setOrderForm((f) => ({ ...f, cutDate: e.target.value }))}
                  className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-dark-400 mb-2">Сорта и количество</label>
                <div className="space-y-2">
                  {(orderForm.strains || []).map((s, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input type="text" value={s.strain} onChange={(e) => updateOrderFormStrainRow(idx, 'strain', e.target.value)} placeholder="Сорт" className="flex-1 min-w-0 px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm" />
                      <input type="number" min="0" value={s.quantity} onChange={(e) => updateOrderFormStrainRow(idx, 'quantity', e.target.value)} placeholder="Кол-во" className="w-20 px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm" />
                      {(orderForm.strains || []).length > 1 && (
                        <button type="button" onClick={() => removeOrderFormStrainRow(idx)} className="p-2 text-red-400 hover:text-red-300">×</button>
                      )}
                    </div>
                  ))}
                  <button type="button" onClick={addOrderFormStrainRow} className="text-primary-400 hover:text-primary-300 text-sm">+ Добавить сорт</button>
                </div>
              </div>
              <div>
                <label className="block text-xs text-dark-400 mb-1">Заметки</label>
                <textarea value={orderForm.notes} onChange={(e) => setOrderForm((f) => ({ ...f, notes: e.target.value }))} rows={2} className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm resize-none" />
              </div>
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setAddOrderModal(false)} className="px-4 py-2 text-dark-400 hover:bg-dark-700 rounded-lg">Отмена</button>
                <button type="submit" disabled={!!savingOrderId} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-500 disabled:opacity-50">{savingOrderId ? 'Сохранение...' : 'Добавить'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Модалка: редактировать бэтч на заказ */}
      {orderEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={() => setOrderEditModal(null)}>
          <div className="bg-dark-800 rounded-xl border border-dark-600 shadow-xl w-full max-w-lg p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-white mb-4">Редактировать бэтч на заказ</h3>
            {orderEditForm.isDone && !(orderModalStrains || []).some((s) => Number(s.quantity) > 0) && (
              <p className="text-amber-400 text-sm mb-3 bg-amber-900/20 border border-amber-700/50 rounded-lg px-3 py-2">
                Укажите, сколько какого сорта нарезано (хотя бы один сорт и количество), затем нажмите «Сохранить».
              </p>
            )}
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-dark-400 mb-1">Дата нарезки</label>
                <input type="date" value={orderEditForm.cutDate} onChange={(e) => setOrderEditForm((f) => ({ ...f, cutDate: e.target.value }))} className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm" />
              </div>
              <div>
                <label className="block text-xs text-dark-400 mb-2">Сорта и количество</label>
                <div className="space-y-2">
                  {(orderModalStrains || []).map((s, idx) => (
                    <div key={s._key != null ? s._key : idx} className="flex items-center gap-2">
                      <input type="text" value={s.strain} onChange={(e) => updateOrderEditStrainRow(idx, 'strain', e.target.value)} placeholder="Сорт" className="flex-1 min-w-0 px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm" />
                      <input type="number" min="0" value={s.quantity} onChange={(e) => updateOrderEditStrainRow(idx, 'quantity', e.target.value)} placeholder="Кол-во" className="w-20 px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm" />
                      {(orderModalStrains || []).length > 1 && (
                        <button type="button" onClick={() => removeOrderEditStrainRow(idx)} className="p-2 text-red-400 hover:text-red-300">×</button>
                      )}
                    </div>
                  ))}
                  <button type="button" onClick={addOrderEditStrainRow} className="text-primary-400 hover:text-primary-300 text-sm">+ Добавить сорт</button>
                </div>
              </div>
              <div>
                <label className="block text-xs text-dark-400 mb-1">Заметки</label>
                <textarea value={orderEditForm.notes} onChange={(e) => setOrderEditForm((f) => ({ ...f, notes: e.target.value }))} rows={2} className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm resize-none" />
              </div>
              <label className="flex items-center gap-2 text-dark-300 cursor-pointer">
                <input type="checkbox" checked={orderEditForm.isDone} onChange={(e) => setOrderEditForm((f) => ({ ...f, isDone: e.target.checked }))} className="rounded" />
                <span>Нарезано</span>
              </label>
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setOrderEditModal(null)} className="px-4 py-2 text-dark-400 hover:bg-dark-700 rounded-lg">Отмена</button>
                <button type="button" onClick={handleSaveOrderEdit} disabled={!!savingOrderId} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-500 disabled:opacity-50">Сохранить</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {logBatches.length > 0 && (
        <div className="mt-8 bg-dark-800 rounded-xl border border-dark-700 overflow-hidden">
          <h2 className="text-lg font-semibold text-white px-4 py-3 border-b border-dark-700">Лог бэтчей: нарезка → вегетация</h2>
          <p className="text-dark-400 text-sm px-4 py-2">Когда какой бэтч был нарезан и пересажен в вег. Название можно редактировать.</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-dark-900">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-dark-400 uppercase tracking-wider">Название бэтча</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-dark-400 uppercase tracking-wider">Источник</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-dark-400 uppercase tracking-wider">Нарезка</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-dark-400 uppercase tracking-wider">Пересажен в вег</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-dark-400 uppercase tracking-wider">Кол-во</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dark-700">
                {logBatches.map((b) => {
                  const sourceRoom = b.sourceCloneCut?.room?.name || b.sourceCloneCut?.room?.roomNumber || '—';
                  const isEditing = editingBatchNameId === b._id;
                  return (
                    <tr key={b._id} className="hover:bg-dark-700/50">
                      <td className="px-4 py-3">
                        {canCreateVeg && isEditing ? (
                          <input
                            type="text"
                            value={editingBatchName}
                            onChange={(e) => setEditingBatchName(e.target.value)}
                            onBlur={() => saveBatchName(b._id)}
                            onKeyDown={(e) => { if (e.key === 'Enter') saveBatchName(b._id); }}
                            autoFocus
                            className="w-full max-w-[200px] px-2 py-1 bg-dark-700 border border-dark-600 rounded text-white text-sm"
                          />
                        ) : canCreateVeg ? (
                          <button
                            type="button"
                            onClick={() => { setEditingBatchNameId(b._id); setEditingBatchName(b.name || ''); }}
                            className="text-left text-white hover:bg-dark-700 rounded px-1 py-0.5 -mx-1"
                          >
                            {b.name || '— Без названия'}
                          </button>
                        ) : (
                          <span className="text-white">{b.name || '— Без названия'}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-dark-300">{sourceRoom}</td>
                      <td className="px-4 py-3 text-dark-300">{formatDate(b.cutDate)}</td>
                      <td className="px-4 py-3 text-dark-300">{formatDate(b.transplantedToVegAt)}</td>
                      <td className="px-4 py-3 text-dark-300">{(b.initialQuantity || b.quantity) > 0 ? (b.initialQuantity || b.quantity) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {archivedCuts.length > 0 && (
        <div className="mt-8 bg-dark-800 rounded-xl border border-dark-700 overflow-hidden opacity-70">
          <h2 className="text-lg font-semibold text-dark-300 px-4 py-3 border-b border-dark-700">Архив нарезок</h2>
          <p className="text-dark-500 text-sm px-4 py-2">Бэтчи клонов, полностью отправленные в вегетацию или удалённые. Можно восстановить.</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-dark-900">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-dark-500 uppercase tracking-wider">Комната</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-dark-500 uppercase tracking-wider">Дата нарезки</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-dark-500 uppercase tracking-wider">Сорт / кол-во</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-dark-500 uppercase tracking-wider">Удалено</th>
                  {canCreateClones && (
                    <th className="px-4 py-3 text-right text-xs font-semibold text-dark-500 uppercase tracking-wider">Действия</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-dark-700">
                {archivedCuts.map((cut) => {
                  const strains = getStrainsFromCut(cut);
                  const currentQty = strains.reduce((s, x) => s + x.quantity, 0);
                  // Суммарное кол-во: остаток + все отправленные в вег из этого бэтча
                  const sentToVeg = (Array.isArray(vegBatches) ? vegBatches : [])
                    .filter((b) => String(b.sourceCloneCut?._id || b.sourceCloneCut || '') === String(cut._id))
                    .reduce((s, b) => s + (b.initialQuantity || b.quantity || 0), 0);
                  const totalQty = currentQty + sentToVeg;
                  const roomName = cut.room?.name || cut.room?.roomNumber || (cut.room ? '—' : 'На заказ');
                  return (
                    <tr key={cut._id} className="hover:bg-dark-700/30">
                      <td className="px-4 py-3 text-dark-400">{roomName}</td>
                      <td className="px-4 py-3 text-dark-400">{formatDate(cut.cutDate)}</td>
                      <td className="px-4 py-3 text-dark-400">
                        {totalQty > 0 ? totalQty : currentQty > 0 ? currentQty : '—'}
                        {sentToVeg > 0 && currentQty > 0 && (
                          <span className="text-dark-500 text-xs ml-1">(ост. {currentQty})</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-dark-500 text-xs">{formatDate(cut.deletedAt)}</td>
                      {canCreateClones && (
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => restoreArchivedCut(cut)}
                            disabled={restoringId === cut._id}
                            className="px-2 py-1 bg-primary-600/30 text-primary-400 hover:bg-primary-600/50 rounded text-xs font-medium disabled:opacity-50"
                          >
                            {restoringId === cut._id ? 'Восстановление...' : 'Восстановить'}
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default Clones;
