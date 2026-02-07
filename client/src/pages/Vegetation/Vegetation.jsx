import { useState, useEffect, useRef } from 'react';
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

const getBatchGoodCount = (b) => {
  const total = getBatchTotal(b);
  const died = Number(b.diedCount) || 0;
  const notGrown = Number(b.notGrownCount) || 0;
  return Math.max(0, total - died - notGrown);
};

const getBatchGoodPercent = (b) => {
  const total = getBatchTotal(b);
  if (total <= 0) return 0;
  return Math.round((getBatchGoodCount(b) / total) * 100);
};

const getBatchRemainder = (b) => Math.max(0, getBatchGoodCount(b) - (Number(b.sentToFlowerCount) || 0));

const Vegetation = () => {
  const { hasPermission } = useAuth();
  const canCreateVeg = hasPermission && hasPermission('vegetation:create');

  const [batches, setBatches] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [cloneCuts, setCloneCuts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [addModal, setAddModal] = useState(false);
  const [sendToFlowerModal, setSendToFlowerModal] = useState(null);
  const [sendRoomId, setSendRoomId] = useState('');
  const [sendDate, setSendDate] = useState(new Date().toISOString().slice(0, 10));
  const [sendCount, setSendCount] = useState('');
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
  const [editingNameId, setEditingNameId] = useState(null);
  const [editingName, setEditingName] = useState('');
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
    lightChangeDate: '',
    lightPowerPercent: '',
    sentToFlowerCount: ''
  });
  const editFormStrainKey = useRef(0);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    try {
      setLoading(true);
      setError('');
      const [inVeg, roomsData, cutsData] = await Promise.all([
        vegBatchService.getInVeg(),
        roomService.getRoomsSummary().catch(() => []),
        cloneCutService.getAll().catch(() => [])
      ]);
      setBatches(Array.isArray(inVeg) ? inVeg : []);
      setRooms(Array.isArray(roomsData) ? roomsData : []);
      setCloneCuts(Array.isArray(cutsData) ? cutsData : []);
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Ошибка загрузки');
      setBatches([]);
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
    setSendCount(String(getBatchGoodCount(batch)));
  };

  const handleSendToFlower = async (e) => {
    e.preventDefault();
    if (!sendToFlowerModal || !sendRoomId) return;
    const room = rooms.find((r) => r._id === sendRoomId);
    if (room?.isActive) {
      setError('В эту комнату нельзя добавить клоны: в ней уже идёт цикл цветения. Сначала завершите текущий цикл (соберите урожай), затем можно будет добавить новые клоны.');
      return;
    }
    setSaving(true);
    try {
      const count = Math.max(0, parseInt(sendCount, 10) || 0);
      if (room && !room.isActive) {
        await roomService.startCycle(sendRoomId, {
          cycleName: sendToFlowerModal.name || sendToFlowerModal.strain || '',
          strain: sendToFlowerModal.strain || '',
          plantsCount: count,
          floweringDays: 56,
          startDate: sendDate
        });
      }
      await vegBatchService.update(sendToFlowerModal._id, {
        flowerRoom: sendRoomId,
        transplantedToFlowerAt: sendDate,
        sentToFlowerCount: count
      });
      setSendToFlowerModal(null);
      setError('');
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
      lightChangeDate: batch.lightChangeDate ? new Date(batch.lightChangeDate).toISOString().slice(0, 10) : '',
      lightPowerPercent: batch.lightPowerPercent != null && batch.lightPowerPercent !== '' ? String(batch.lightPowerPercent) : '',
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
        lightChangeDate: editForm.lightChangeDate || null,
        lightPowerPercent: editForm.lightPowerPercent !== '' ? Number(editForm.lightPowerPercent) : null,
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
    <div>
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

      <div className="bg-dark-800 rounded-xl border border-dark-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-dark-900">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-dark-400 uppercase tracking-wider">Сорт / нарезка</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-dark-400 uppercase tracking-wider">Кол-во</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-dark-400 uppercase tracking-wider">Погибло</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-dark-400 uppercase tracking-wider">Не выросло</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-dark-400 uppercase tracking-wider">% хороших</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-dark-400 uppercase tracking-wider">Свет</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-dark-400 uppercase tracking-wider">Остаток</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-dark-400 uppercase tracking-wider">В вегу</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-dark-400 uppercase tracking-wider">Прогресс</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-dark-400 uppercase tracking-wider">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dark-700">
              {batches.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-dark-500">
                    Нет бэтчей на вегетации. Добавьте бэтч из нарезанных клонов.
                  </td>
                </tr>
              ) : (
                batches.map((b) => {
                  const daysInVeg = getDaysInVeg(b.transplantedToVegAt);
                  const target = b.vegDaysTarget || 21;
                  const progress = Math.min(100, Math.round((daysInVeg / target) * 100));
                  const isEditingName = editingNameId === b._id;
                  return (
                    <tr key={b._id} className="hover:bg-dark-700/50">
                      <td className="px-4 py-3">
                        {canCreateVeg && isEditingName ? (
                          <input
                            type="text"
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            onBlur={() => saveBatchName(b._id)}
                            onKeyDown={(e) => { if (e.key === 'Enter') saveBatchName(b._id); }}
                            autoFocus
                            className="w-full max-w-[160px] px-2 py-1 bg-dark-700 border border-dark-600 rounded text-white text-sm"
                          />
                        ) : canCreateVeg ? (
                          <button
                            type="button"
                            onClick={() => { setEditingNameId(b._id); setEditingName(b.name || ''); }}
                            className="text-left text-white hover:bg-dark-700 rounded px-1 py-0.5 -mx-1 text-sm"
                          >
                            {b.name || '— Название'}
                          </button>
                        ) : (
                          <span className="text-white text-sm">{b.name || '— Название'}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-white">{formatStrainsShort(getStrainsFromBatch(b))}</div>
                        <div className="text-xs text-dark-500">Нарезка: {formatDate(b.cutDate)}</div>
                      </td>
                      <td className="px-4 py-3 text-dark-300">{getBatchTotal(b)}</td>
                      <td className="px-4 py-3 text-dark-300">{b.diedCount || 0}</td>
                      <td className="px-4 py-3 text-dark-300">{b.notGrownCount || 0}</td>
                      <td className="px-4 py-3">
                        <span className={getBatchGoodPercent(b) >= 80 ? 'text-green-400' : getBatchGoodPercent(b) >= 50 ? 'text-amber-400' : 'text-red-400'}>
                          {getBatchGoodPercent(b)}%
                        </span>
                      </td>
                      <td className="px-4 py-3 text-dark-300 text-xs">
                        {b.lightChangeDate ? (
                          <>
                            {formatDate(b.lightChangeDate)}
                            {b.lightPowerPercent != null && ` · ${b.lightPowerPercent}%`}
                          </>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3 text-dark-300">{getBatchRemainder(b)}</td>
                      <td className="px-4 py-3 text-dark-300">{formatDate(b.transplantedToVegAt)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 bg-dark-700 rounded-full overflow-hidden min-w-[80px]">
                            <div
                              className={`h-full rounded-full transition-all ${progress >= 100 ? 'bg-green-500' : 'bg-primary-500'}`}
                              style={{ width: `${progress}%` }}
                            />
                          </div>
                          <span className="text-xs text-dark-400 whitespace-nowrap">
                            {daysInVeg} дн. / {target} дн.
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {canCreateVeg ? (
                          <>
                            <button
                              type="button"
                              onClick={() => openEditBatch(b)}
                              className="px-2 py-1 text-primary-400 hover:bg-dark-700 rounded text-xs mr-2"
                            >
                              Редактировать
                            </button>
                            <button
                              type="button"
                              onClick={() => openSendToFlower(b)}
                              className="px-2 py-1 bg-primary-600/80 text-white rounded text-xs hover:bg-primary-500 mr-2"
                            >
                              В цветение
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(b._id)}
                              className="px-2 py-1 text-red-400 hover:bg-red-900/30 rounded text-xs"
                            >
                              Удалить
                            </button>
                          </>
                        ) : (
                          <span className="text-dark-500 text-xs">Только просмотр</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
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
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-dark-400 mb-1">Свет: дата смены</label>
                  <input type="date" value={editForm.lightChangeDate} onChange={(e) => setEditForm((f) => ({ ...f, lightChangeDate: e.target.value }))} className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-dark-400 mb-1">Свет: % мощности</label>
                  <input type="number" min="0" max="100" value={editForm.lightPowerPercent} onChange={(e) => setEditForm((f) => ({ ...f, lightPowerPercent: e.target.value }))} placeholder="0–100" className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm" />
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
            className="bg-dark-800 rounded-xl border border-dark-600 shadow-xl w-full max-w-md p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-white mb-1">Отправить в цветение</h3>
            <p className="text-dark-400 text-sm mb-4">
              {formatStrainsShort(getStrainsFromBatch(sendToFlowerModal))} · хороших: {getBatchGoodCount(sendToFlowerModal)} шт. Остаток после заезда: {getBatchRemainder(sendToFlowerModal)}.
            </p>
            <form onSubmit={handleSendToFlower} className="space-y-4">
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
                    В эту комнату нельзя добавить клоны: в ней уже идёт цикл цветения. Сначала завершите текущий цикл (соберите урожай), затем можно будет добавить новые клоны.
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
                <button type="submit" disabled={saving || !sendRoomId} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-500 disabled:opacity-50">
                  {saving ? 'Сохранение...' : 'Привязать'}
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
