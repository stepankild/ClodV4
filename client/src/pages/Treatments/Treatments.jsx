import { useState, useEffect, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { treatmentService } from '../../services/treatmentService';
import { treatmentProductService } from '../../services/treatmentProductService';
import { roomService } from '../../services/roomService';
import { useAuth } from '../../context/AuthContext';

const PRODUCT_TYPES = {
  insecticide: { label: 'Инсектицид', color: 'bg-red-500', border: 'border-red-500', text: 'text-red-400' },
  fungicide: { label: 'Фунгицид', color: 'bg-blue-500', border: 'border-blue-500', text: 'text-blue-400' },
  acaricide: { label: 'Акарицид', color: 'bg-orange-500', border: 'border-orange-500', text: 'text-orange-400' },
  bio: { label: 'Биопрепарат', color: 'bg-green-500', border: 'border-green-500', text: 'text-green-400' },
  fertilizer: { label: 'Удобрение', color: 'bg-purple-500', border: 'border-purple-500', text: 'text-purple-400' },
  ph_adjuster: { label: 'pH корр.', color: 'bg-cyan-500', border: 'border-cyan-500', text: 'text-cyan-400' },
  other: { label: 'Другое', color: 'bg-gray-500', border: 'border-gray-500', text: 'text-gray-400' }
};

const APPLICATION_METHODS = {
  spray: 'Опрыскивание',
  drench: 'Пролив',
  fogger: 'Фоггер',
  granular: 'Гранулы',
  other: 'Другое'
};

const STATUS_BADGES = {
  planned: { label: 'Запланировано', cls: 'bg-yellow-900/40 text-yellow-400 border border-yellow-800' },
  completed: { label: 'Выполнено', cls: 'bg-green-900/40 text-green-400 border border-green-800' },
  skipped: { label: 'Пропущено', cls: 'bg-dark-600 text-dark-400 border border-dark-500' }
};

const DAY_NAMES = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

// Получить понедельник недели для даты
const getMonday = (d) => {
  const date = new Date(d);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day; // 0=Sun → -6, 1=Mon → 0, etc.
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
};

const formatDate = (d) => {
  const date = new Date(d);
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
};

const formatDateFull = (d) => {
  const date = new Date(d);
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
};

const isSameDay = (a, b) => {
  const da = new Date(a);
  const db = new Date(b);
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
};

const isOverdue = (record) => {
  if (record.status !== 'planned') return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const scheduled = new Date(record.scheduledDate);
  scheduled.setHours(0, 0, 0, 0);
  return scheduled < today;
};

const Treatments = () => {
  const { hasPermission } = useAuth();
  const [records, setRecords] = useState([]);
  const [products, setProducts] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Calendar state
  const [weekStart, setWeekStart] = useState(() => getMonday(new Date()));
  const [viewMode, setViewMode] = useState('calendar'); // calendar | list
  const [expandedId, setExpandedId] = useState(null);

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [modalForm, setModalForm] = useState({
    roomId: '',
    productId: '',
    dosage: '',
    applicationMethod: 'spray',
    scheduledDate: '',
    worker: '',
    notes: '',
    status: 'planned'
  });
  const [modalSaving, setModalSaving] = useState(false);
  const [editingRecord, setEditingRecord] = useState(null);

  // Compute week range
  const weekEnd = useMemo(() => {
    const end = new Date(weekStart);
    end.setDate(end.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    return end;
  }, [weekStart]);

  const weekDays = useMemo(() => {
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      days.push(d);
    }
    return days;
  }, [weekStart]);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const from = new Date(weekStart);
      from.setDate(from.getDate() - 7); // load extra week for context
      const to = new Date(weekEnd);
      to.setDate(to.getDate() + 7);

      const [recs, prods, rms] = await Promise.all([
        treatmentService.getCalendar(from.toISOString(), to.toISOString()),
        treatmentProductService.getAll(),
        roomService.getRooms()
      ]);
      setRecords(recs);
      setProducts(prods);
      setRooms(rms);
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, [weekStart, weekEnd]);

  useEffect(() => { loadData(); }, [loadData]);

  // Group records by day
  const recordsByDay = useMemo(() => {
    const map = {};
    weekDays.forEach(d => {
      const key = d.toISOString().slice(0, 10);
      map[key] = [];
    });
    records.forEach(r => {
      const key = new Date(r.scheduledDate).toISOString().slice(0, 10);
      if (map[key]) {
        map[key].push(r);
      }
    });
    return map;
  }, [records, weekDays]);

  // Overdue count (planned + past date within the calendar range)
  const overdueCount = useMemo(() => {
    return records.filter(r => isOverdue(r)).length;
  }, [records]);

  const navigateWeek = (direction) => {
    setWeekStart(prev => {
      const next = new Date(prev);
      next.setDate(next.getDate() + direction * 7);
      return next;
    });
    setExpandedId(null);
  };

  const goToday = () => {
    setWeekStart(getMonday(new Date()));
    setExpandedId(null);
  };

  // Modal handlers
  const openCreateModal = (date) => {
    const d = date || new Date();
    setEditingRecord(null);
    setModalForm({
      roomId: rooms.length > 0 ? '' : '',
      productId: '',
      dosage: '',
      applicationMethod: 'spray',
      scheduledDate: new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10),
      worker: '',
      notes: '',
      status: 'planned'
    });
    setShowModal(true);
  };

  const openEditModal = (record) => {
    setEditingRecord(record);
    const sd = new Date(record.scheduledDate);
    setModalForm({
      roomId: record.room?._id || '',
      productId: record.product?._id || '',
      dosage: record.dosage || '',
      applicationMethod: record.applicationMethod || 'spray',
      scheduledDate: new Date(sd.getTime() - sd.getTimezoneOffset() * 60000).toISOString().slice(0, 10),
      worker: record.worker?._id || '',
      notes: record.notes || '',
      status: record.status || 'planned'
    });
    setShowModal(true);
  };

  const handleProductChange = (productId) => {
    const product = products.find(p => p._id === productId);
    setModalForm(f => ({
      ...f,
      productId,
      dosage: product?.concentration || f.dosage
    }));
  };

  const handleModalSubmit = async (e) => {
    e.preventDefault();
    if (!modalForm.roomId || !modalForm.scheduledDate || modalSaving) return;
    setModalSaving(true);
    try {
      const data = {
        roomId: modalForm.roomId,
        productId: modalForm.productId || null,
        dosage: modalForm.dosage,
        applicationMethod: modalForm.applicationMethod,
        scheduledDate: modalForm.scheduledDate,
        worker: modalForm.worker || null,
        notes: modalForm.notes,
        status: modalForm.status
      };

      if (editingRecord) {
        await treatmentService.update(editingRecord._id, data);
      } else {
        await treatmentService.create(data);
      }
      setShowModal(false);
      await loadData();
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка сохранения');
    } finally {
      setModalSaving(false);
    }
  };

  const handleComplete = async (id) => {
    try {
      await treatmentService.complete(id);
      await loadData();
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка');
    }
  };

  const handleSkip = async (id) => {
    try {
      await treatmentService.skip(id);
      await loadData();
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка');
    }
  };

  const handleDeleteRecord = async (id) => {
    if (!confirm('Удалить запись обработки?')) return;
    try {
      await treatmentService.delete(id);
      await loadData();
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка');
    }
  };

  const activeRooms = useMemo(() => rooms.filter(r => r.status !== 'empty'), [rooms]);

  // Record card component
  const RecordCard = ({ record }) => {
    const typeInfo = PRODUCT_TYPES[record.productType] || PRODUCT_TYPES.other;
    const overdue = isOverdue(record);
    const isExpanded = expandedId === record._id;
    const statusInfo = STATUS_BADGES[record.status] || STATUS_BADGES.planned;
    const roomName = record.room?.name || `Комната ${record.room?.roomNumber || '?'}`;

    return (
      <div
        className={`rounded-lg border transition-all cursor-pointer ${
          overdue
            ? 'border-red-500/50 bg-red-900/10'
            : record.status === 'completed'
            ? 'border-green-800/50 bg-green-900/10'
            : record.status === 'skipped'
            ? 'border-dark-600 bg-dark-800/50 opacity-60'
            : 'border-dark-600 bg-dark-800'
        }`}
        onClick={() => setExpandedId(isExpanded ? null : record._id)}
      >
        <div className="p-2.5">
          <div className="flex items-start gap-2">
            <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${typeInfo.color}`} />
            <div className="flex-1 min-w-0">
              <div className="text-white text-sm font-medium truncate">{roomName}</div>
              <div className="text-dark-400 text-xs truncate">
                {record.productName || 'Без препарата'}
                {record.dosage && ` · ${record.dosage}`}
              </div>
            </div>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ${statusInfo.cls}`}>
              {overdue ? 'Просрочено' : statusInfo.label}
            </span>
          </div>

          {/* Expanded details */}
          {isExpanded && (
            <div className="mt-2 pt-2 border-t border-dark-700 space-y-1.5" onClick={(e) => e.stopPropagation()}>
              {record.applicationMethod && (
                <div className="text-xs">
                  <span className="text-dark-500">Способ: </span>
                  <span className="text-dark-300">{APPLICATION_METHODS[record.applicationMethod] || record.applicationMethod}</span>
                </div>
              )}
              {record.worker && (
                <div className="text-xs">
                  <span className="text-dark-500">Работник: </span>
                  <span className="text-dark-300">{record.worker.name}</span>
                </div>
              )}
              {record.completedBy && (
                <div className="text-xs">
                  <span className="text-dark-500">Выполнил: </span>
                  <span className="text-dark-300">{record.completedBy.name}</span>
                  {record.completedAt && <span className="text-dark-500"> ({formatDateFull(record.completedAt)})</span>}
                </div>
              )}
              {record.notes && (
                <div className="text-xs">
                  <span className="text-dark-500">Примечание: </span>
                  <span className="text-dark-300">{record.notes}</span>
                </div>
              )}

              {/* Actions */}
              <div className="flex flex-wrap gap-2 pt-1">
                {record.status === 'planned' && hasPermission('treatments:create') && (
                  <button
                    type="button"
                    onClick={() => handleComplete(record._id)}
                    className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-xs font-medium"
                  >
                    Выполнено
                  </button>
                )}
                {record.status === 'planned' && hasPermission('treatments:edit') && (
                  <button
                    type="button"
                    onClick={() => handleSkip(record._id)}
                    className="px-3 py-1 bg-dark-600 hover:bg-dark-500 text-dark-300 rounded text-xs"
                  >
                    Пропустить
                  </button>
                )}
                {hasPermission('treatments:edit') && (
                  <button
                    type="button"
                    onClick={() => openEditModal(record)}
                    className="px-3 py-1 bg-dark-600 hover:bg-dark-500 text-dark-300 rounded text-xs"
                  >
                    Изменить
                  </button>
                )}
                {hasPermission('treatments:delete') && (
                  <button
                    type="button"
                    onClick={() => handleDeleteRecord(record._id)}
                    className="px-3 py-1 text-red-400 hover:text-red-300 text-xs"
                  >
                    Удалить
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  if (loading && records.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500" />
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-4 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Обработки</h1>
          <p className="text-dark-400 mt-1 text-sm">
            Планирование и учёт обработок
            {overdueCount > 0 && (
              <span className="text-red-400 ml-2">({overdueCount} просрочено)</span>
            )}
          </p>
        </div>
        <div className="flex gap-2 shrink-0 flex-wrap">
          <Link
            to="/treatments/products"
            className="px-3 py-2 bg-dark-700 hover:bg-dark-600 text-dark-300 border border-dark-600 rounded-lg text-sm font-medium transition"
          >
            База препаратов
          </Link>
          {hasPermission('treatments:create') && (
            <button
              type="button"
              onClick={() => openCreateModal()}
              className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm font-medium transition"
            >
              + Новая обработка
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-800 text-red-400 px-4 py-3 rounded-lg mb-4">
          {error}
          <button type="button" onClick={() => setError('')} className="ml-3 text-red-500 hover:text-red-300">×</button>
        </div>
      )}

      {/* View toggle + Week nav */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setViewMode('calendar')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
              viewMode === 'calendar'
                ? 'bg-primary-600 text-white'
                : 'bg-dark-700 text-dark-400 hover:bg-dark-600'
            }`}
          >
            Календарь
          </button>
          <button
            type="button"
            onClick={() => setViewMode('list')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
              viewMode === 'list'
                ? 'bg-primary-600 text-white'
                : 'bg-dark-700 text-dark-400 hover:bg-dark-600'
            }`}
          >
            Список
          </button>
        </div>

        {viewMode === 'calendar' && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigateWeek(-1)}
              className="px-3 py-1.5 bg-dark-700 hover:bg-dark-600 text-dark-300 rounded-lg text-sm"
            >
              &larr;
            </button>
            <button
              type="button"
              onClick={goToday}
              className="px-3 py-1.5 bg-dark-700 hover:bg-dark-600 text-dark-300 rounded-lg text-sm"
            >
              Сегодня
            </button>
            <span className="text-white text-sm font-medium min-w-[140px] text-center">
              {formatDate(weekStart)} — {formatDate(weekEnd)}
            </span>
            <button
              type="button"
              onClick={() => navigateWeek(1)}
              className="px-3 py-1.5 bg-dark-700 hover:bg-dark-600 text-dark-300 rounded-lg text-sm"
            >
              &rarr;
            </button>
          </div>
        )}
      </div>

      {/* Calendar view */}
      {viewMode === 'calendar' && (
        <>
          {/* Desktop: 7 columns */}
          <div className="hidden md:grid grid-cols-7 gap-2">
            {weekDays.map((day, idx) => {
              const key = day.toISOString().slice(0, 10);
              const dayRecords = recordsByDay[key] || [];
              const isToday = isSameDay(day, new Date());

              return (
                <div key={key} className="min-h-[200px]">
                  <div
                    className={`text-center py-1.5 rounded-t-lg text-sm font-medium ${
                      isToday
                        ? 'bg-primary-600 text-white'
                        : 'bg-dark-700 text-dark-300'
                    }`}
                  >
                    <div>{DAY_NAMES[idx]}</div>
                    <div className="text-xs opacity-70">{formatDate(day)}</div>
                  </div>
                  <div className="bg-dark-800 border border-dark-700 border-t-0 rounded-b-lg p-1.5 space-y-1.5 min-h-[160px]">
                    {dayRecords.map(r => (
                      <RecordCard key={r._id} record={r} />
                    ))}
                    {hasPermission('treatments:create') && (
                      <button
                        type="button"
                        onClick={() => openCreateModal(day)}
                        className="w-full py-1 text-dark-500 hover:text-dark-300 hover:bg-dark-700 rounded text-xs transition text-center"
                      >
                        +
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Mobile: 1 column list by day */}
          <div className="md:hidden space-y-3">
            {weekDays.map((day, idx) => {
              const key = day.toISOString().slice(0, 10);
              const dayRecords = recordsByDay[key] || [];
              const isToday = isSameDay(day, new Date());

              return (
                <div key={key}>
                  <div className={`flex items-center justify-between py-2 px-3 rounded-lg ${
                    isToday ? 'bg-primary-600/20 border border-primary-600/40' : 'bg-dark-700'
                  }`}>
                    <span className={`text-sm font-medium ${isToday ? 'text-primary-400' : 'text-dark-300'}`}>
                      {DAY_NAMES[idx]}, {formatDate(day)}
                    </span>
                    {dayRecords.length > 0 && (
                      <span className="text-dark-500 text-xs">{dayRecords.length}</span>
                    )}
                  </div>
                  <div className="mt-1.5 space-y-1.5 pl-2">
                    {dayRecords.map(r => (
                      <RecordCard key={r._id} record={r} />
                    ))}
                    {dayRecords.length === 0 && (
                      <div className="text-dark-600 text-xs py-2 text-center">—</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* List view */}
      {viewMode === 'list' && (
        <div className="bg-dark-800 rounded-xl border border-dark-700 overflow-hidden">
          {records.length === 0 ? (
            <div className="px-4 py-8 text-center text-dark-500">
              Нет обработок за этот период
            </div>
          ) : (
            <div className="divide-y divide-dark-700">
              {records
                .filter(r => {
                  const d = new Date(r.scheduledDate);
                  return d >= weekStart && d <= weekEnd;
                })
                .sort((a, b) => new Date(a.scheduledDate) - new Date(b.scheduledDate))
                .map(r => {
                  const typeInfo = PRODUCT_TYPES[r.productType] || PRODUCT_TYPES.other;
                  const overdue = isOverdue(r);
                  const statusInfo = STATUS_BADGES[r.status] || STATUS_BADGES.planned;
                  const roomName = r.room?.name || `Комната ${r.room?.roomNumber || '?'}`;

                  return (
                    <div
                      key={r._id}
                      className={`px-4 py-3 cursor-pointer hover:bg-dark-700/50 ${overdue ? 'bg-red-900/5' : ''}`}
                      onClick={() => setExpandedId(expandedId === r._id ? null : r._id)}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${typeInfo.color}`} />
                        <div className="text-dark-500 text-sm w-20 shrink-0">{formatDate(r.scheduledDate)}</div>
                        <div className="flex-1 min-w-0">
                          <span className="text-white font-medium">{roomName}</span>
                          <span className="text-dark-400 ml-2">{r.productName || ''}</span>
                          {r.dosage && <span className="text-dark-500 ml-1">({r.dosage})</span>}
                        </div>
                        <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${statusInfo.cls}`}>
                          {overdue ? 'Просрочено' : statusInfo.label}
                        </span>
                      </div>

                      {expandedId === r._id && (
                        <div className="mt-2 pt-2 border-t border-dark-700 ml-5 space-y-1" onClick={(e) => e.stopPropagation()}>
                          {r.applicationMethod && (
                            <div className="text-xs text-dark-400">
                              Способ: {APPLICATION_METHODS[r.applicationMethod] || r.applicationMethod}
                            </div>
                          )}
                          {r.worker && <div className="text-xs text-dark-400">Работник: {r.worker.name}</div>}
                          {r.notes && <div className="text-xs text-dark-400">Примечание: {r.notes}</div>}
                          <div className="flex flex-wrap gap-2 pt-1">
                            {r.status === 'planned' && hasPermission('treatments:create') && (
                              <button
                                type="button"
                                onClick={() => handleComplete(r._id)}
                                className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-xs font-medium"
                              >
                                Выполнено
                              </button>
                            )}
                            {r.status === 'planned' && hasPermission('treatments:edit') && (
                              <button type="button" onClick={() => handleSkip(r._id)} className="px-3 py-1 bg-dark-600 hover:bg-dark-500 text-dark-300 rounded text-xs">Пропустить</button>
                            )}
                            {hasPermission('treatments:edit') && (
                              <button type="button" onClick={() => openEditModal(r)} className="px-3 py-1 bg-dark-600 hover:bg-dark-500 text-dark-300 rounded text-xs">Изменить</button>
                            )}
                            {hasPermission('treatments:delete') && (
                              <button type="button" onClick={() => handleDeleteRecord(r._id)} className="px-3 py-1 text-red-400 hover:text-red-300 text-xs">Удалить</button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      )}

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
          <div className="absolute inset-0 bg-black/60" />
          <div
            className="relative bg-dark-800 rounded-xl border border-dark-700 w-full max-w-lg max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <form onSubmit={handleModalSubmit} className="p-5 space-y-4">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-white font-semibold text-lg">
                  {editingRecord ? 'Редактировать обработку' : 'Новая обработка'}
                </h3>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="text-dark-400 hover:text-dark-300 text-2xl leading-none"
                >
                  &times;
                </button>
              </div>

              <div>
                <label className="block text-dark-400 text-sm mb-1">Комната *</label>
                <select
                  value={modalForm.roomId}
                  onChange={(e) => setModalForm(f => ({ ...f, roomId: e.target.value }))}
                  className="w-full bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 text-white text-sm focus:ring-2 focus:ring-primary-500"
                  required
                >
                  <option value="">Выберите комнату</option>
                  {(activeRooms.length > 0 ? activeRooms : rooms).map(r => (
                    <option key={r._id} value={r._id}>
                      {r.name} {r.strain ? `(${r.strain})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-dark-400 text-sm mb-1">Препарат</label>
                <select
                  value={modalForm.productId}
                  onChange={(e) => handleProductChange(e.target.value)}
                  className="w-full bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 text-white text-sm focus:ring-2 focus:ring-primary-500"
                >
                  <option value="">Без препарата / Другое</option>
                  {products.map(p => (
                    <option key={p._id} value={p._id}>
                      {p.name} {p.concentration ? `(${p.concentration})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-dark-400 text-sm mb-1">Дозировка</label>
                  <input
                    type="text"
                    value={modalForm.dosage}
                    onChange={(e) => setModalForm(f => ({ ...f, dosage: e.target.value }))}
                    placeholder="2 мл/л"
                    className="w-full bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 text-white text-sm placeholder-dark-500 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-dark-400 text-sm mb-1">Способ</label>
                  <select
                    value={modalForm.applicationMethod}
                    onChange={(e) => setModalForm(f => ({ ...f, applicationMethod: e.target.value }))}
                    className="w-full bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 text-white text-sm focus:ring-2 focus:ring-primary-500"
                  >
                    {Object.entries(APPLICATION_METHODS).map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-dark-400 text-sm mb-1">Дата *</label>
                <input
                  type="date"
                  value={modalForm.scheduledDate}
                  onChange={(e) => setModalForm(f => ({ ...f, scheduledDate: e.target.value }))}
                  className="w-full bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 text-white text-sm focus:ring-2 focus:ring-primary-500"
                  required
                />
              </div>

              <div>
                <label className="block text-dark-400 text-sm mb-1">Примечание</label>
                <textarea
                  value={modalForm.notes}
                  onChange={(e) => setModalForm(f => ({ ...f, notes: e.target.value }))}
                  rows={2}
                  className="w-full bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 text-white text-sm placeholder-dark-500 focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
                />
              </div>

              {/* Status selection for create */}
              {!editingRecord && (
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="status"
                      value="planned"
                      checked={modalForm.status === 'planned'}
                      onChange={(e) => setModalForm(f => ({ ...f, status: e.target.value }))}
                      className="text-primary-500 focus:ring-primary-500 bg-dark-700 border-dark-600"
                    />
                    <span className="text-dark-300 text-sm">Запланировать</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="status"
                      value="completed"
                      checked={modalForm.status === 'completed'}
                      onChange={(e) => setModalForm(f => ({ ...f, status: e.target.value }))}
                      className="text-green-500 focus:ring-green-500 bg-dark-700 border-dark-600"
                    />
                    <span className="text-dark-300 text-sm">Записать выполненную</span>
                  </label>
                </div>
              )}

              <div className="flex gap-2 justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 bg-dark-600 hover:bg-dark-500 text-dark-300 rounded-lg text-sm"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={!modalForm.roomId || !modalForm.scheduledDate || modalSaving}
                  className="px-6 py-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white rounded-lg font-medium text-sm transition flex items-center gap-2"
                >
                  {modalSaving && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />}
                  {editingRecord ? 'Сохранить' : modalForm.status === 'completed' ? 'Записать' : 'Запланировать'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Treatments;
