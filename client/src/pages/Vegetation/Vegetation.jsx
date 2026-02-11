import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { vegBatchService } from '../../services/vegBatchService';
import { roomService } from '../../services/roomService';
import { cloneCutService } from '../../services/cloneCutService';

const formatDate = (date) => {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const getDaysInVeg = (transplantedToVegAt) => {
  if (!transplantedToVegAt) return 0;
  const start = new Date(transplantedToVegAt);
  const now = new Date();
  return Math.max(0, Math.floor((now - start) / (1000 * 60 * 60 * 24)));
};

const getStrainsFromBatch = (b) => {
  if (!b) return [];
  if (Array.isArray(b.strains) && b.strains.length > 0) {
    return b.strains.map((s) => ({ strain: s.strain || '', quantity: Number(s.quantity) || 0 }));
  }
  if (b.strain || b.quantity > 0) return [{ strain: b.strain || '', quantity: Number(b.quantity) || 0 }];
  return [];
};

const formatStrainsShort = (strains) => {
  if (!Array.isArray(strains) || strains.length === 0) return '—';
  return strains.map((s) => (s.strain ? `${s.strain} (${s.quantity})` : s.quantity)).filter(Boolean).join(', ') || '—';
};

const getBatchTotal = (b) => {
  const fromStrains = getStrainsFromBatch(b).reduce((s, x) => s + x.quantity, 0);
  return fromStrains || Number(b.quantity) || 0;
};

const getBatchInitialTotal = (b) => (b.initialQuantity != null && b.initialQuantity !== '') ? Number(b.initialQuantity) : getBatchTotal(b);

const getBatchGoodCount = (b) => {
  const total = getBatchTotal(b);
  const died = Number(b.diedCount) || 0;
  const notGrown = Number(b.notGrownCount) || 0;
  const disposed = Number(b.disposedCount) || 0;
  return Math.max(0, total - died - notGrown - disposed);
};

const getBatchGoodPercent = (b) => {
  const total = getBatchInitialTotal(b);
  if (total <= 0) return 0;
  return Math.round((getBatchGoodCount(b) / total) * 100);
};

const getBatchRemainder = (b) => getBatchGoodCount(b);

const getBatchLightChanges = (b) => {
  let list = [];
  if (Array.isArray(b.lightChanges) && b.lightChanges.length > 0) list = b.lightChanges;
  else if (b.lightChangeDate) list = [{ date: b.lightChangeDate, powerPercent: b.lightPowerPercent != null ? b.lightPowerPercent : null }];
  return list.slice().sort((a, b) => new Date(b.date) - new Date(a.date));
};

const getLatestLightChange = (b) => {
  const changes = getBatchLightChanges(b);
  return changes.length > 0 ? changes[0] : null;
};

const TABLES_TOTAL = 21;
const PLANTS_PER_TABLE = 54;
const VEG_CAPACITY = TABLES_TOTAL * PLANTS_PER_TABLE;

const Vegetation = () => {
  const { hasPermission } = useAuth();
  const canCreateVeg = hasPermission && hasPermission('vegetation:create');

  const [batches, setBatches] = useState([]);
  const [deletedBatches, setDeletedBatches] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [cloneCuts, setCloneCuts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [addModal, setAddModal] = useState(false);
  const [sendToFlowerModal, setSendToFlowerModal] = useState(null);
  const [sendRoomId, setSendRoomId] = useState('');
  const [sendDate, setSendDate] = useState(new Date().toISOString().slice(0, 10));
  const [sendCount, setSendCount] = useState('');
  const [sendStrains, setSendStrains] = useState([]);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '',
    strains: [{ strain: '', quantity: '' }],
    cutDate: new Date().toISOString().slice(0, 10),
    transplantedToVegAt: new Date().toISOString().slice(0, 10),
    vegDaysTarget: '21',
    sourceCloneCut: '',
    notes: ''
  });
  const [expandedRows, setExpandedRows] = useState({});
  const [editingLoss, setEditingLoss] = useState(null);
  const [editBatch, setEditBatch] = useState(null);
  const [editForm, setEditForm] = useState({
    name: '',
    strains: [{ strain: '', quantity: '' }],
    cutDate: '',
    transplantedToVegAt: '',
    vegDaysTarget: '21',
    sourceCloneCut: '',
    notes: '',
    diedCount: '',
    notGrownCount: '',
    lightChanges: [],
    sentToFlowerCount: ''
  });
  const editFormStrainKey = useRef(0);
  const editFormLightKey = useRef(0);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    try {
      setLoading(true);
      setError('');
      const [inVeg, deletedData, roomsData, cutsData] = await Promise.all([
        vegBatchService.getInVeg(),
        vegBatchService.getDeleted().catch(() => []),
        roomService.getRoomsSummary().catch(() => []),
        cloneCutService.getAll().catch(() => [])
      ]);
      setBatches(Array.isArray(inVeg) ? inVeg : []);
      setDeletedBatches(Array.isArray(deletedData) ? deletedData : []);
      setRooms(Array.isArray(roomsData) ? roomsData : []);
      setCloneCuts(Array.isArray(cutsData) ? cutsData : []);
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Ошибка загрузки');
      setBatches([]);
      setDeletedBatches([]);
      setRooms([]);
      setCloneCuts([]);
    } finally {
      setLoading(false);
    }
  };

  const openAddModal = () => {
    setForm({
      name: '',
      strains: [{ strain: '', quantity: '' }],
      cutDate: new Date().toISOString().slice(0, 10),
      transplantedToVegAt: new Date().toISOString().slice(0, 10),
      vegDaysTarget: '21',
      sourceCloneCut: '',
      notes: ''
    });
    setAddModal(true);
  };

  const addFormStrainRow = () => {
    setForm((f) => ({ ...f, strains: [...(f.strains || []), { strain: '', quantity: '' }] }));
  };

  const removeFormStrainRow = (index) => {
    setForm((f) => ({ ...f, strains: (f.strains || []).filter((_, i) => i !== index) }));
  };

  const updateFormStrainRow = (index, field, value) => {
    setForm((f) => ({
      ...f,
      strains: (f.strains || []).map((s, i) => i === index ? { ...s, [field]: value } : s)
    }));
  };

  const handleAddSubmit = async (e) => {
    e.preventDefault();
    const strains = (form.strains || [])
      .map((s) => ({ strain: String(s.strain || '').trim(), quantity: Number(s.quantity) || 0 }))
      .filter((s) => s.strain !== '' || s.quantity > 0);
    if (strains.length === 0) {
      setError('Укажите хотя бы один сорт и количество');
      return;
    }
    setSaving(true);
    try {
      await vegBatchService.create({
        name: (form.name || '').trim(),
        strains,
        cutDate: form.cutDate,
        transplantedToVegAt: form.transplantedToVegAt,
        vegDaysTarget: Number(form.vegDaysTarget) || 21,
        sourceCloneCut: form.sourceCloneCut || undefined,
        notes: form.notes.trim()
      });
      setAddModal(false);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  };

  const openSendToFlower = (batch) => {
    setSendToFlowerModal(batch);
    setSendRoomId('');
    setSendDate(new Date().toISOString().slice(0, 10));
    const strains = getStrainsFromBatch(batch);
    const goodTotal = getBatchGoodCount(batch);
    if (strains.length > 0) {
      setSendStrains(strains.map((s) => ({ strain: s.strain, total: s.quantity, sendQty: String(s.quantity) })));
      const sum = strains.reduce((a, s) => a + s.quantity, 0);
      setSendCount(sum <= goodTotal ? String(sum) : String(goodTotal));
    } else {
      setSendStrains([]);
      setSendCount(String(goodTotal));
    }
  };

  const handleSendToFlower = async (e) => {
    e.preventDefault();
    if (!sendToFlowerModal) return;
    if (!sendRoomId) {
      setError('Выберите комнату цветения.');
      return;
    }
    const room = rooms.find((r) => r._id === sendRoomId);
    if (room && room.isActive) {
      setError('В эту комнату нельзя добавить клоны: в ней уже идёт цикл цветения. Сначала завершите текущий цикл (соберите урожай), затем можно будет добавить новые клоны.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      let count;
      let flowerStrainsPayload = [];
      if (sendStrains.length > 0) {
        flowerStrainsPayload = sendStrains
          .map((s) => ({ strain: s.strain || '', quantity: Math.max(0, parseInt(s.sendQty, 10) || 0) }))
          .filter((s) => s.quantity > 0);
        count = flowerStrainsPayload.reduce((sum, s) => sum + s.quantity, 0);
      } else {
        count = Math.max(0, parseInt(sendCount, 10) || 0);
        const strainStr = sendToFlowerModal.strain || (getStrainsFromBatch(sendToFlowerModal).map((s) => s.strain).filter(Boolean).join(', ')) || '';
        if (count > 0 && strainStr) flowerStrainsPayload = [{ strain: strainStr, quantity: count }];
      }
      if (count <= 0) {
        setError('Укажите количество отправляемых в цвет.');
        setSaving(false);
        return;
      }
      const goodMax = getBatchGoodCount(sendToFlowerModal);
      if (count > goodMax) {
        setError(`Максимум хороших: ${goodMax}. Уменьшите количество.`);
        setSaving(false);
        return;
      }
      // Сначала обновляем бэтч (привязка к комнате) — сервер проверит, что комната ещё не активна
      await vegBatchService.update(sendToFlowerModal._id, {
        flowerRoom: sendRoomId,
        transplantedToFlowerAt: sendDate,
        sentToFlowerCount: count,
        sentToFlowerStrains: flowerStrainsPayload.length ? flowerStrainsPayload : undefined
      });
      if (room && !room.isActive) {
        await roomService.startCycle(sendRoomId, {
          cycleName: sendToFlowerModal.name || sendToFlowerModal.strain || '',
          strain: sendToFlowerModal.strain || (flowerStrainsPayload.map((s) => s.strain).filter(Boolean).join(', ')) || '',
          plantsCount: count,
          floweringDays: 56,
          startDate: sendDate,
          flowerStrains: flowerStrainsPayload.length ? flowerStrainsPayload : undefined
        });
      }
      setSendToFlowerModal(null);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Удалить бэтч из вегетации?')) return;
    try {
      await vegBatchService.delete(id);
      setEditBatch(null);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка удаления');
    }
  };

  const handleDisposeRemaining = async (batch) => {
    const remainder = getBatchRemainder(batch);
    if (remainder <= 0) return;
    if (!confirm(`Утилизировать оставшиеся ${remainder} кустов? Бэтч попадёт в корзину (можно восстановить).`)) return;
    try {
      setSaving(true);
      await vegBatchService.disposeRemaining(batch._id);
      setSendToFlowerModal(null);
      setEditBatch(null);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка');
    } finally {
      setSaving(false);
    }
  };

  const handleRestoreBatch = async (id) => {
    try {
      setSaving(true);
      await vegBatchService.restore(id);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка восстановления');
    } finally {
      setSaving(false);
    }
  };

  const toggleRow = (id) => {
    setExpandedRows((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const startEditLoss = (batch, field) => {
    if (!canCreateVeg) return;
    setEditingLoss({
      batchId: batch._id,
      field,
      value: String(field === 'died' ? (batch.diedCount ?? 0) : (batch.notGrownCount ?? 0))
    });
  };

  const saveLoss = async () => {
    if (!editingLoss) return;
    const num = Math.max(0, parseInt(editingLoss.value, 10) || 0);
    try {
      await vegBatchService.update(editingLoss.batchId, editingLoss.field === 'died' ? { diedCount: num } : { notGrownCount: num });
      setEditingLoss(null);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка сохранения');
    }
  };

  const openEditBatch = (batch) => {
    const strains = getStrainsFromBatch(batch);
    const list = strains.length ? strains.map((s) => ({ strain: String(s.strain ?? ''), quantity: String(s.quantity ?? ''), _key: editFormStrainKey.current++ })) : [{ strain: '', quantity: '', _key: editFormStrainKey.current++ }];
    setEditBatch(batch);
    setEditForm({
      name: batch.name || '',
      strains: list,
      cutDate: batch.cutDate ? new Date(batch.cutDate).toISOString().slice(0, 10) : '',
      transplantedToVegAt: batch.transplantedToVegAt ? new Date(batch.transplantedToVegAt).toISOString().slice(0, 10) : '',
      vegDaysTarget: String(batch.vegDaysTarget ?? 21),
      sourceCloneCut: batch.sourceCloneCut?._id || batch.sourceCloneCut || '',
      notes: batch.notes || '',
      diedCount: batch.diedCount != null ? String(batch.diedCount) : '0',
      notGrownCount: batch.notGrownCount != null ? String(batch.notGrownCount) : '0',
      lightChanges: (() => {
        const list = (getBatchLightChanges(batch)).map((c) => ({
          date: c.date ? new Date(c.date).toISOString().slice(0, 10) : '',
          powerPercent: c.powerPercent != null && c.powerPercent !== '' ? String(c.powerPercent) : '',
          _key: editFormLightKey.current++
        }));
        return list.length ? list : [{ date: '', powerPercent: '', _key: editFormLightKey.current++ }];
      })(),
      sentToFlowerCount: batch.sentToFlowerCount != null ? String(batch.sentToFlowerCount) : '0'
    });
  };

  const closeEditBatch = () => setEditBatch(null);

  const addEditStrainRow = () => {
    setEditForm((f) => ({ ...f, strains: [...(f.strains || []), { strain: '', quantity: '', _key: editFormStrainKey.current++ }] }));
  };

  const removeEditStrainRow = (idx) => {
    setEditForm((f) => ({ ...f, strains: (f.strains || []).filter((_, i) => i !== idx) }));
  };

  const updateEditStrainRow = (idx, field, value) => {
    setEditForm((f) => ({ ...f, strains: (f.strains || []).map((s, i) => (i === idx ? { ...s, [field]: value } : s)) }));
  };

  const addEditLightRow = () => {
    setEditForm((f) => ({ ...f, lightChanges: [...(f.lightChanges || []), { date: '', powerPercent: '', _key: editFormLightKey.current++ }] }));
  };

  const removeEditLightRow = (idx) => {
    setEditForm((f) => ({ ...f, lightChanges: (f.lightChanges || []).filter((_, i) => i !== idx) }));
  };

  const updateEditLightRow = (idx, field, value) => {
    setEditForm((f) => ({ ...f, lightChanges: (f.lightChanges || []).map((c, i) => (i === idx ? { ...c, [field]: value } : c)) }));
  };

  const handleEditSave = async (e) => {
    e.preventDefault();
    if (!editBatch) return;
    const strains = (editForm.strains || [])
      .map((s) => ({ strain: String(s.strain || '').trim(), quantity: Number(s.quantity) || 0 }))
      .filter((s) => s.strain !== '' || s.quantity > 0);
    if (strains.length === 0) {
      setError('Укажите хотя бы один сорт и количество');
      return;
    }
    setSaving(true);
    try {
      await vegBatchService.update(editBatch._id, {
        name: editForm.name.trim(),
        strains,
        cutDate: editForm.cutDate || undefined,
        transplantedToVegAt: editForm.transplantedToVegAt || undefined,
        vegDaysTarget: Number(editForm.vegDaysTarget) || 21,
        sourceCloneCut: editForm.sourceCloneCut || undefined,
        notes: editForm.notes.trim(),
        diedCount: Number(editForm.diedCount) || 0,
        notGrownCount: Number(editForm.notGrownCount) || 0,
        lightChanges: (editForm.lightChanges || [])
          .filter((c) => c && c.date)
          .map((c) => ({ date: c.date, powerPercent: c.powerPercent !== '' ? Number(c.powerPercent) : null })),
        sentToFlowerCount: Number(editForm.sentToFlowerCount) || 0
      });
      closeEditBatch();
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка сохранения');
    } finally {
      setSaving(false);
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
    <div className="overflow-x-hidden max-w-full">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Вегетация</h1>
        <p className="text-dark-400 mt-1">
          Бэтчи клонов на вегетации. Отметьте, когда нарезали и когда пересадили в вег — затем привяжите бэтч к комнате цветения.
        </p>
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

      {canCreateVeg && (
        <div className="mb-4 flex justify-end">
          <button
            type="button"
            onClick={openAddModal}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-500 transition font-medium"
          >
            Добавить бэтч
          </button>
        </div>
      )}

      {/* Занятость столов и инфо по бэтчам */}
      <div className="mb-6 bg-dark-800 rounded-xl border border-dark-700 p-5">
        <h2 className="text-lg font-semibold text-white mb-3">Занятость вегетации</h2>
        <p className="text-dark-400 text-sm mb-2">
          Всего столов: {TABLES_TOTAL}, на каждом до {PLANTS_PER_TABLE} кустов (вместимость {VEG_CAPACITY} кустов).
        </p>
        {(() => {
          const totalPlants = batches.reduce((s, b) => s + getBatchGoodCount(b), 0);
          const tablesUsed = Math.ceil(totalPlants / PLANTS_PER_TABLE);
          const occupancyPercent = Math.min(100, Math.round((totalPlants / VEG_CAPACITY) * 100));
          const tablesPercent = Math.min(100, Math.round((tablesUsed / TABLES_TOTAL) * 100));
          return (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-4 text-sm">
                <span className="text-dark-300">Бэтчей в вегетации: <strong className="text-white">{batches.length}</strong></span>
                <span className="text-dark-300">Кустов (хороших): <strong className="text-white">{totalPlants}</strong></span>
                <span className="text-dark-300">Столов занято: <strong className="text-primary-400">{tablesUsed}</strong> из {TABLES_TOTAL}</span>
              </div>
              <div>
                <div className="flex justify-between text-xs text-dark-400 mb-1">
                  <span>Столы</span>
                  <span>{tablesUsed} / {TABLES_TOTAL} · {totalPlants} кустов</span>
                </div>
                <div className="h-3 bg-dark-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary-500 rounded-full transition-all"
                    style={{ width: `${tablesPercent}%` }}
                  />
                </div>
              </div>
            </div>
          );
        })()}
      </div>

      <div className="bg-dark-800 rounded-xl border border-dark-700 overflow-hidden max-w-full">
        <div className="overflow-x-auto min-w-0">
          <table className="w-full text-sm" style={{ tableLayout: 'fixed', minWidth: 680 }}>
            <colgroup>
              <col style={{ width: '3%' }} />
              <col style={{ width: '22%' }} />
              <col style={{ width: '13%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '28%' }} />
            </colgroup>
            <thead className="bg-dark-900">
              <tr>
                <th className="px-1 py-2.5" />
                <th className="px-3 py-2.5 text-left font-medium text-dark-400 text-xs uppercase tracking-wide">Название</th>
                <th className="px-3 py-2.5 text-left font-medium text-dark-400 text-xs uppercase tracking-wide">Кол-во</th>
                <th className="px-3 py-2.5 text-left font-medium text-dark-400 text-xs uppercase tracking-wide">%</th>
                <th className="px-3 py-2.5 text-left font-medium text-dark-400 text-xs uppercase tracking-wide">Свет</th>
                <th className="px-3 py-2.5 text-left font-medium text-dark-400 text-xs uppercase tracking-wide">В вегу с</th>
                <th className="px-3 py-2.5 text-left font-medium text-dark-400 text-xs uppercase tracking-wide">Прогресс</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dark-700">
              {batches.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-dark-500 text-sm">
                    Нет бэтчей на вегетации. Добавьте бэтч из нарезанных клонов.
                  </td>
                </tr>
              ) : (
                batches.map((b) => {
                  const daysInVeg = getDaysInVeg(b.transplantedToVegAt);
                  const target = b.vegDaysTarget || 21;
                  const progress = Math.min(100, Math.round((daysInVeg / target) * 100));
                  const isExpanded = expandedRows[b._id];
                  return (
                    <React.Fragment key={b._id}>
                      <tr
                        className={`hover:bg-dark-700/40 cursor-pointer ${isExpanded ? 'bg-dark-700/20' : ''}`}
                        onClick={() => toggleRow(b._id)}
                      >
                        <td className="px-1 py-2 align-top text-center">
                          <span
                            className={`inline-block text-dark-500 transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`}
                            style={{ fontSize: '10px' }}
                          >&#9654;</span>
                        </td>
                        <td className="px-3 py-2 align-top min-w-0">
                          <span className="text-white text-sm truncate block">{b.name || '—'}</span>
                          <div className="text-dark-500 text-xs mt-0.5 truncate" title={formatStrainsShort(getStrainsFromBatch(b))}>
                            {formatStrainsShort(getStrainsFromBatch(b))}
                          </div>
                        </td>
                        <td className="px-3 py-2 align-top">
                          <span className="text-dark-300">{getBatchInitialTotal(b)}</span>
                          <span className="text-dark-500 mx-1">/</span>
                          <span className="text-primary-400/90">{getBatchGoodCount(b)}</span>
                        </td>
                        <td className="px-3 py-2 align-top">
                          <span className={getBatchGoodPercent(b) >= 80 ? 'text-green-400' : getBatchGoodPercent(b) >= 50 ? 'text-amber-400' : 'text-red-400'}>
                            {getBatchGoodPercent(b)}%
                          </span>
                        </td>
                        <td className="px-3 py-2 align-top text-dark-300 text-xs">
                          {(() => {
                            const latest = getLatestLightChange(b);
                            const changes = getBatchLightChanges(b);
                            if (!latest) return '—';
                            if (changes.length === 1) return <>{formatDate(latest.date)}{latest.powerPercent != null && ` · ${latest.powerPercent}%`}</>;
                            return <span title={changes.map((c) => `${formatDate(c.date)} ${c.powerPercent != null ? c.powerPercent + '%' : ''}`).join(', ')}>{changes.length} смен · {formatDate(latest.date)}{latest.powerPercent != null && ` ${latest.powerPercent}%`}</span>;
                          })()}
                        </td>
                        <td className="px-3 py-2 align-top">
                          <div className="text-dark-300 text-xs whitespace-nowrap">{formatDate(b.transplantedToVegAt)}</div>
                          <div className="text-dark-500 text-xs mt-0.5">ост. {getBatchRemainder(b)}</div>
                        </td>
                        <td className="px-3 py-2 align-top">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 min-w-0 h-2 bg-dark-700 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all ${progress >= 100 ? 'bg-green-500' : 'bg-primary-500'}`}
                                style={{ width: `${progress}%` }}
                              />
                            </div>
                            <span className="text-dark-400 text-xs shrink-0">{daysInVeg}/{target}</span>
                            {canCreateVeg && (
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); openSendToFlower(b); }}
                                className="px-2 py-1 bg-primary-600/80 text-white rounded text-xs hover:bg-primary-500 shrink-0"
                              >
                                В цвет
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-dark-800/60">
                          <td colSpan={7} className="px-4 py-3 border-b border-dark-600">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-3 text-sm">
                              <div>
                                <div className="text-dark-500 text-xs uppercase tracking-wide mb-1">Потери</div>
                                <div className="flex items-center gap-2">
                                  <span className="text-dark-400 text-xs">Погибло:</span>
                                  {canCreateVeg && editingLoss?.batchId === b._id && editingLoss?.field === 'died' ? (
                                    <input
                                      type="number"
                                      min="0"
                                      value={editingLoss.value}
                                      onChange={(e) => setEditingLoss((prev) => prev ? { ...prev, value: e.target.value } : null)}
                                      onBlur={saveLoss}
                                      onKeyDown={(e) => { if (e.key === 'Enter') saveLoss(); }}
                                      autoFocus
                                      onClick={(e) => e.stopPropagation()}
                                      className="w-14 px-2 py-1 bg-dark-700 border border-dark-600 rounded text-white text-sm"
                                    />
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={(e) => { e.stopPropagation(); startEditLoss(b, 'died'); }}
                                      className="text-dark-300 hover:text-white hover:bg-dark-700 rounded px-1 py-0.5 text-sm"
                                      title="Нажмите, чтобы изменить"
                                    >
                                      {b.diedCount || 0}
                                    </button>
                                  )}
                                </div>
                                <div className="flex items-center gap-2 mt-1">
                                  <span className="text-dark-400 text-xs">Не выросло:</span>
                                  {canCreateVeg && editingLoss?.batchId === b._id && editingLoss?.field === 'notGrown' ? (
                                    <input
                                      type="number"
                                      min="0"
                                      value={editingLoss.value}
                                      onChange={(e) => setEditingLoss((prev) => prev ? { ...prev, value: e.target.value } : null)}
                                      onBlur={saveLoss}
                                      onKeyDown={(e) => { if (e.key === 'Enter') saveLoss(); }}
                                      autoFocus
                                      onClick={(e) => e.stopPropagation()}
                                      className="w-14 px-2 py-1 bg-dark-700 border border-dark-600 rounded text-white text-sm"
                                    />
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={(e) => { e.stopPropagation(); startEditLoss(b, 'notGrown'); }}
                                      className="text-dark-300 hover:text-white hover:bg-dark-700 rounded px-1 py-0.5 text-sm"
                                      title="Нажмите, чтобы изменить"
                                    >
                                      {b.notGrownCount || 0}
                                    </button>
                                  )}
                                </div>
                              </div>
                              <div>
                                <div className="text-dark-500 text-xs uppercase tracking-wide mb-1">Даты</div>
                                <div className="text-dark-300 text-xs">Нарезка: <span className="text-white">{formatDate(b.cutDate)}</span></div>
                                <div className="text-dark-300 text-xs mt-1">В вегу: <span className="text-white">{formatDate(b.transplantedToVegAt)}</span></div>
                                <div className="text-dark-300 text-xs mt-1">Цель: <span className="text-white">{b.vegDaysTarget || 21} дн.</span></div>
                              </div>
                              <div>
                                <div className="text-dark-500 text-xs uppercase tracking-wide mb-1">Смены света</div>
                                {getBatchLightChanges(b).length === 0 ? (
                                  <span className="text-dark-500 text-xs">—</span>
                                ) : (
                                  <div className="space-y-0.5">
                                    {getBatchLightChanges(b).map((c, i) => (
                                      <div key={i} className="text-dark-300 text-xs">
                                        {formatDate(c.date)}{c.powerPercent != null && ` — ${c.powerPercent}%`}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                              <div>
                                <div className="text-dark-500 text-xs uppercase tracking-wide mb-1">Количество</div>
                                <div className="text-dark-300 text-xs">Всего: <span className="text-white">{getBatchInitialTotal(b)}</span></div>
                                <div className="text-dark-300 text-xs mt-1">Хороших: <span className="text-primary-400">{getBatchGoodCount(b)}</span></div>
                                <div className="text-dark-300 text-xs mt-1">В цвет: <span className="text-white">{b.sentToFlowerCount || 0}</span></div>
                                {(b.disposedCount || 0) > 0 && (
                                  <div className="text-dark-300 text-xs mt-1">Утилизировано: <span className="text-amber-400">{b.disposedCount}</span></div>
                                )}
                                <div className="text-dark-300 text-xs mt-1">Остаток в бэтче: <span className="text-white font-medium">{getBatchRemainder(b)}</span></div>
                              </div>
                              {b.notes && (
                                <div className="col-span-2 md:col-span-4">
                                  <div className="text-dark-500 text-xs uppercase tracking-wide mb-1">Заметки</div>
                                  <p className="text-dark-300 text-xs whitespace-pre-wrap bg-dark-700/30 rounded-lg p-2.5">{b.notes}</p>
                                </div>
                              )}
                              {getStrainsFromBatch(b).length > 1 && (
                                <div className="col-span-2 md:col-span-4">
                                  <div className="text-dark-500 text-xs uppercase tracking-wide mb-1">Сорта</div>
                                  <div className="flex flex-wrap gap-2">
                                    {getStrainsFromBatch(b).map((s, i) => (
                                      <span key={i} className="px-2 py-1 bg-dark-700 rounded text-dark-300 text-xs">
                                        {s.strain || '?'} <span className="text-white">{s.quantity}</span>
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                            {canCreateVeg && (
                              <div className="flex gap-2 mt-3 pt-3 border-t border-dark-700">
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); openEditBatch(b); }}
                                  className="px-3 py-1.5 text-primary-400 hover:bg-dark-700 rounded text-xs"
                                >
                                  Изменить
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); openSendToFlower(b); }}
                                  className="px-3 py-1.5 bg-primary-600/80 text-white rounded text-xs hover:bg-primary-500"
                                >
                                  В цвет
                                </button>
                                {getBatchRemainder(b) > 0 && (
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); handleDisposeRemaining(b); }}
                                    className="px-3 py-1.5 text-amber-400 hover:bg-amber-900/30 rounded text-xs"
                                    title="Оставшиеся кусты никуда не поедут, будут утилизированы"
                                  >
                                    Удалить оставшиеся (утилизация)
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); handleDelete(b._id); }}
                                  className="px-3 py-1.5 text-red-400 hover:bg-red-900/30 rounded text-xs ml-auto"
                                >
                                  Удалить
                                </button>
                              </div>
                            )}
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

      {/* Списанные кусты (корзина) — лог удалённых бэтчей */}
      <div className="mt-10 bg-dark-800 rounded-xl border border-dark-700 p-5">
        <h2 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
          <span className="text-amber-400">Списанные кусты (корзина)</span>
          {deletedBatches.length > 0 && (
            <span className="text-dark-400 text-sm font-normal">— {deletedBatches.length} бэтч(ей), можно восстановить</span>
          )}
        </h2>
        {deletedBatches.length === 0 ? (
          <p className="text-dark-500 text-sm">Нет списанных бэтчей. Сюда попадают бэтчи после «Удалить оставшиеся (утилизация)».</p>
        ) : (
          <div className="space-y-2">
            {deletedBatches.map((b) => (
              <div
                key={b._id}
                className="flex flex-wrap items-center justify-between gap-3 py-2 px-3 bg-dark-700/50 rounded-lg border border-dark-600"
              >
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <span className="text-white font-medium">{b.name || 'Бэтч без названия'}</span>
                  <span className="text-dark-400">
                    {formatStrainsShort(getStrainsFromBatch(b))} · всего {getBatchInitialTotal(b) || b.initialQuantity || getBatchTotal(b)}
                  </span>
                  {(b.disposedCount > 0 || b.sentToFlowerCount > 0) && (
                    <span className="text-dark-500 text-xs">
                      в цвет: {b.sentToFlowerCount || 0}
                      {b.disposedCount > 0 && ` · утилизировано: ${b.disposedCount}`}
                    </span>
                  )}
                  <span className="text-dark-500 text-xs">удалён {formatDate(b.deletedAt)}</span>
                </div>
                {canCreateVeg && (
                  <button
                    type="button"
                    onClick={() => handleRestoreBatch(b._id)}
                    disabled={saving}
                    className="px-3 py-1.5 text-primary-400 hover:bg-primary-900/30 rounded text-xs disabled:opacity-50"
                  >
                    Восстановить
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Модалка: добавить бэтч */}
      {addModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={() => setAddModal(false)}>
          <div
            className="bg-dark-800 rounded-xl border border-dark-600 shadow-xl w-full max-w-md p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-white mb-2">Добавить бэтч в вегетацию</h3>
            <p className="text-dark-400 text-sm mb-4 p-3 bg-dark-700/50 border border-dark-600 rounded-lg">
              Бэтч здесь создаётся только если растите <strong className="text-dark-300">с семечек</strong> или <strong className="text-dark-300">привозные кусты</strong>. Если клоны из своей нарезки — добавляйте нарезку в разделе <strong className="text-primary-400">Клоны</strong>, затем бэтч появится в вегетации.
            </p>
            <form onSubmit={handleAddSubmit} className="space-y-4">
              <div>
                <label className="block text-xs text-dark-400 mb-1">Название бэтча</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Например: Комната 2 — Горилла"
                  className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-dark-400 mb-2">Сорта и количество</label>
                <div className="space-y-2">
                  {(form.strains || []).map((s, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        type="text"
                        value={s.strain}
                        onChange={(e) => updateFormStrainRow(idx, 'strain', e.target.value)}
                        placeholder="Сорт"
                        className="flex-1 min-w-0 px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                      />
                      <input
                        type="number"
                        min="0"
                        value={s.quantity}
                        onChange={(e) => updateFormStrainRow(idx, 'quantity', e.target.value)}
                        placeholder="Кол-во"
                        className="w-20 px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                      />
                      {(form.strains || []).length > 1 && (
                        <button type="button" onClick={() => removeFormStrainRow(idx)} className="text-red-400 hover:text-red-300 p-1">×</button>
                      )}
                    </div>
                  ))}
                  <button type="button" onClick={addFormStrainRow} className="text-primary-400 hover:text-primary-300 text-sm">+ Добавить сорт</button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-dark-400 mb-1">Дата нарезки</label>
                  <input
                    type="date"
                    value={form.cutDate}
                    onChange={(e) => setForm((f) => ({ ...f, cutDate: e.target.value }))}
                    className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-dark-400 mb-1">В вегу с</label>
                  <input
                    type="date"
                    value={form.transplantedToVegAt}
                    onChange={(e) => setForm((f) => ({ ...f, transplantedToVegAt: e.target.value }))}
                    className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs text-dark-400 mb-1">Цель вегетации (дней)</label>
                <input
                  type="number"
                  min="1"
                  value={form.vegDaysTarget}
                  onChange={(e) => setForm((f) => ({ ...f, vegDaysTarget: e.target.value }))}
                  className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-dark-400 mb-1">Из нарезки (опционально)</label>
                <select
                  value={form.sourceCloneCut}
                  onChange={(e) => setForm((f) => ({ ...f, sourceCloneCut: e.target.value }))}
                  className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                >
                  <option value="">— Не привязано</option>
                  {cloneCuts.filter((c) => c.isDone).map((c) => (
                    <option key={c._id} value={c._id}>
                      {c.room?.name || 'Комната'} · {formatDate(c.cutDate)} · {formatStrainsShort(Array.isArray(c.strains) && c.strains.length ? c.strains : (c.strain ? [{ strain: c.strain, quantity: c.quantity }] : []))} ({c.quantity || 0})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-dark-400 mb-1">Заметки</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  rows={2}
                  className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm resize-none"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setAddModal(false)} className="px-4 py-2 text-dark-400 hover:bg-dark-700 rounded-lg">
                  Отмена
                </button>
                <button type="submit" disabled={saving} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-500 disabled:opacity-50">
                  {saving ? 'Сохранение...' : 'Добавить'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Модалка: редактировать бэтч */}
      {editBatch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={closeEditBatch}>
          <div
            className="bg-dark-800 rounded-xl border border-dark-600 shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-white mb-4">Редактировать бэтч</h3>
            <form onSubmit={handleEditSave} className="space-y-4">
              <div>
                <label className="block text-xs text-dark-400 mb-1">Название</label>
                <input
                  type="text"
                  value={editForm.name}
                  onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-dark-400 mb-2">Сорта и количество</label>
                <div className="space-y-2">
                  {(editForm.strains || []).map((s, idx) => (
                    <div key={s._key != null ? s._key : idx} className="flex items-center gap-2">
                      <input type="text" value={s.strain} onChange={(e) => updateEditStrainRow(idx, 'strain', e.target.value)} placeholder="Сорт" className="flex-1 min-w-0 px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm" />
                      <input type="number" min="0" value={s.quantity} onChange={(e) => updateEditStrainRow(idx, 'quantity', e.target.value)} placeholder="Кол-во" className="w-20 px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm" />
                      {(editForm.strains || []).length > 1 && <button type="button" onClick={() => removeEditStrainRow(idx)} className="p-2 text-red-400 hover:text-red-300">×</button>}
                    </div>
                  ))}
                  <button type="button" onClick={addEditStrainRow} className="text-primary-400 hover:text-primary-300 text-sm">+ Добавить сорт</button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-dark-400 mb-1">Дата нарезки</label>
                  <input type="date" value={editForm.cutDate} onChange={(e) => setEditForm((f) => ({ ...f, cutDate: e.target.value }))} className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-dark-400 mb-1">В вегу с</label>
                  <input type="date" value={editForm.transplantedToVegAt} onChange={(e) => setEditForm((f) => ({ ...f, transplantedToVegAt: e.target.value }))} className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-xs text-dark-400 mb-1">Цель вегетации (дней)</label>
                <input type="number" min="1" value={editForm.vegDaysTarget} onChange={(e) => setEditForm((f) => ({ ...f, vegDaysTarget: e.target.value }))} className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-dark-400 mb-1">Погибло</label>
                  <input type="number" min="0" value={editForm.diedCount} onChange={(e) => setEditForm((f) => ({ ...f, diedCount: e.target.value }))} className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-dark-400 mb-1">Не выросло</label>
                  <input type="number" min="0" value={editForm.notGrownCount} onChange={(e) => setEditForm((f) => ({ ...f, notGrownCount: e.target.value }))} className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-xs text-dark-400 mb-2">Смены света (дата и % мощности)</label>
                <div className="space-y-2">
                  {(editForm.lightChanges || []).map((c, idx) => (
                    <div key={c._key != null ? c._key : idx} className="flex items-center gap-2">
                      <input type="date" value={c.date} onChange={(e) => updateEditLightRow(idx, 'date', e.target.value)} className="flex-1 min-w-0 px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm" />
                      <input type="number" min="0" max="100" value={c.powerPercent} onChange={(e) => updateEditLightRow(idx, 'powerPercent', e.target.value)} placeholder="%" className="w-16 px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm" />
                      {(editForm.lightChanges || []).length > 1 && <button type="button" onClick={() => removeEditLightRow(idx)} className="p-2 text-red-400 hover:text-red-300">×</button>}
                    </div>
                  ))}
                  <button type="button" onClick={addEditLightRow} className="text-primary-400 hover:text-primary-300 text-sm">+ Добавить смену света</button>
                </div>
              </div>
              <div>
                <label className="block text-xs text-dark-400 mb-1">Уже отправлено в цвет (шт.)</label>
                <input type="number" min="0" value={editForm.sentToFlowerCount} onChange={(e) => setEditForm((f) => ({ ...f, sentToFlowerCount: e.target.value }))} className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm" />
                <p className="text-xs text-dark-500 mt-1">Остаток = хорошие − отправлено</p>
              </div>
              <div>
                <label className="block text-xs text-dark-400 mb-1">Из нарезки</label>
                <select value={editForm.sourceCloneCut} onChange={(e) => setEditForm((f) => ({ ...f, sourceCloneCut: e.target.value }))} className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm">
                  <option value="">— Не привязано</option>
                  {cloneCuts.filter((c) => c.isDone).map((c) => (
                    <option key={c._id} value={c._id}>{c.room?.name || 'Комната'} · {formatDate(c.cutDate)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-dark-400 mb-1">Заметки</label>
                <textarea value={editForm.notes} onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))} rows={2} className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm resize-none" />
              </div>
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={closeEditBatch} className="px-4 py-2 text-dark-400 hover:bg-dark-700 rounded-lg">Отмена</button>
                <button type="submit" disabled={saving} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-500 disabled:opacity-50">{saving ? 'Сохранение...' : 'Сохранить'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Модалка: отправить в цветение */}
      {sendToFlowerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={() => setSendToFlowerModal(null)}>
          <div
            className="bg-dark-800 rounded-xl border border-dark-600 shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-white mb-1">Отправить в цветение</h3>
            <p className="text-dark-400 text-sm mb-4">
              Хороших в бэтче: {getBatchGoodCount(sendToFlowerModal)} шт. После отправки в бэтче останется меньше на выбранное количество.
            </p>
            <form onSubmit={handleSendToFlower} className="space-y-4">
              {error && (
                <div className="bg-red-900/30 border border-red-800 text-red-400 px-3 py-2 rounded-lg text-sm">
                  {error}
                </div>
              )}
              {sendStrains.length > 0 ? (
                <div>
                  <label className="block text-xs text-dark-400 mb-2">Сколько какого сорта отправляете в цвет (в комнату будет видно сорт и кол-во)</label>
                  <div className="space-y-2">
                    {sendStrains.map((s, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <span className="text-white text-sm w-32 truncate" title={s.strain}>{s.strain || '—'}</span>
                        <span className="text-dark-500 text-xs">в бэтче: {s.total}</span>
                        <input
                          type="number"
                          min="0"
                          max={s.total}
                          value={s.sendQty}
                          onChange={(e) => setSendStrains((prev) => prev.map((x, i) => i === idx ? { ...x, sendQty: e.target.value } : x))}
                          placeholder="в цвет"
                          className="flex-1 min-w-0 px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                        />
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-dark-500 mt-1">Сумма не больше {getBatchGoodCount(sendToFlowerModal)}</p>
                </div>
              ) : (
                <div>
                  <label className="block text-xs text-dark-400 mb-1">Сколько отправляете в цвет</label>
                  <input
                    type="number"
                    min="0"
                    max={getBatchGoodCount(sendToFlowerModal)}
                    value={sendCount}
                    onChange={(e) => setSendCount(e.target.value)}
                    className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                  />
                  <p className="text-xs text-dark-500 mt-1">Макс. хороших: {getBatchGoodCount(sendToFlowerModal)}</p>
                </div>
              )}
              <div>
                <label className="block text-xs text-dark-400 mb-1">Комната цветения</label>
                <select
                  value={sendRoomId}
                  onChange={(e) => setSendRoomId(e.target.value)}
                  required
                  className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                >
                  <option value="">— Выберите комнату</option>
                  {rooms.map((r) => (
                    <option key={r._id} value={r._id} disabled={r.isActive}>
                      {r.name} {r.isActive ? '(активна — сначала завершите цикл)' : '(свободна)'}
                    </option>
                  ))}
                </select>
                {sendRoomId && rooms.find((r) => r._id === sendRoomId)?.isActive && (
                  <p className="mt-2 text-amber-400 text-sm">
                    В эту комнату нельзя добавить: в ней уже идёт цикл. Завершите цикл (соберите урожай), затем можно добавить новые клоны.
                  </p>
                )}
              </div>
              <div>
                <label className="block text-xs text-dark-400 mb-1">Дата пересадки в цвет</label>
                <input
                  type="date"
                  value={sendDate}
                  onChange={(e) => setSendDate(e.target.value)}
                  className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setSendToFlowerModal(null)} className="px-4 py-2 text-dark-400 hover:bg-dark-700 rounded-lg">
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={saving || !sendRoomId || (!!sendRoomId && !!rooms.find((r) => r._id === sendRoomId)?.isActive)}
                  className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-500 disabled:opacity-50"
                >
                  {saving ? 'Отправка...' : 'Отправить в цвет'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Vegetation;
