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
      setCloneCuts(Array.isArray(cutsData) ? cutsData : []);
      setVegBatches(Array.isArray(allVegBatches) ? allVegBatches : []);
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Ошибка загрузки комнат');
      console.error('Clones load error:', err);
      setRooms([]);
      setCloneCuts([]);
      setVegBatches([]);
    } finally {
      setLoading(false);
    }
  };

  const rows = (Array.isArray(rooms) ? rooms : [])
    .filter((r) => r != null)
    .map((room) => {
      const cutDate = getCutDateForRoom(room);
      if (!cutDate) return null;
      const cut = cloneCuts.find((c) => c.room?._id === room._id || c.room === room._id);
      const cutId = cut?._id;
      const strains = getStrainsFromCut(cut);
      const quantity = strains.reduce((sum, s) => sum + s.quantity, 0);
      const strain = (strains.map((s) => s.strain).filter(Boolean).join(', ') || cut?.strain) ?? '';
      const hasTransplanted = cutId && (Array.isArray(vegBatches) ? vegBatches : []).some(
        (b) => (b.sourceCloneCut?._id || b.sourceCloneCut) === cutId
      );
      return {
        room,
        cutDate,
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

  const openEdit = (row) => {
    setEditRow(row);
    let list = Array.isArray(row.strains) && row.strains.length > 0
      ? row.strains.map((s) => ({ strain: String(s.strain ?? ''), quantity: String(s.quantity ?? '') }))
      : (row.strain || row.quantity ? [{ strain: String(row.strain ?? ''), quantity: String(row.quantity ?? '') }] : []);
    while (list.length < 2) list.push({ strain: '', quantity: '' });
    setModalStrains(list);
    setEditForm({ isDone: row.isDone });
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
    const { room, cutDate, cutId } = editRow;
    const strains = (modalStrains || [])
      .map((s) => ({ strain: String(s.strain || '').trim(), quantity: Number(s.quantity) || 0 }))
      .filter((s) => s.strain !== '' || s.quantity > 0);
    try {
      setSavingId(room._id);
      const payload = {
        roomId: room._id,
        cutDate: cutDate.toISOString().slice(0, 10),
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
      setSavingId(sendToVegModal.room._id);
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

  const toggleDone = async (row) => {
    const { room, cutDate, cutId, isDone } = row;
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
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">План нарезки клонов</h1>
        <p className="text-dark-400 mt-1">
          Клоны режутся за {WEEKS_BEFORE} недели до даты цветения. Укажите сорт и количество, отметьте, если уже нарезаны.
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

      {/* Модалка: заполнить / изменить нарезку (несколько сортов) */}
      {editModalOpen && editRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={closeEdit}>
          <div
            key={editRow.room?._id}
            className="bg-dark-800 rounded-xl border border-dark-600 shadow-xl w-full max-w-lg p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-white mb-1">Нарезка клонов · {editRow.room.name}</h3>
            <p className="text-dark-400 text-sm mb-4">Дата нарезки: {formatDate(editRow.cutDate)}. Сортов без ограничения — добавляйте строки кнопкой «+».</p>
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
                <button type="submit" disabled={savingId === sendToVegModal.room._id} className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-500 disabled:opacity-50 font-medium">
                  {savingId === sendToVegModal.room._id ? 'Сохранение...' : 'Создать бэтч в вегетации'}
                </button>
              </div>
            </form>
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
                      <td className="px-4 py-3 text-dark-300">{b.quantity > 0 ? b.quantity : '—'}</td>
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
