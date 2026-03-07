import { useState, useEffect, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { treatmentService } from '../../services/treatmentService';
import { treatmentProductService } from '../../services/treatmentProductService';
import { roomService } from '../../services/roomService';
import { useAuth } from '../../context/AuthContext';
import { localizeRoomName } from '../../utils/localizeRoomName';

const PRODUCT_TYPE_STYLES = {
  insecticide: { color: 'bg-red-500', dot: 'bg-red-400', text: 'text-red-400' },
  fungicide: { color: 'bg-blue-500', dot: 'bg-blue-400', text: 'text-blue-400' },
  acaricide: { color: 'bg-orange-500', dot: 'bg-orange-400', text: 'text-orange-400' },
  bio: { color: 'bg-green-500', dot: 'bg-green-400', text: 'text-green-400' },
  fertilizer: { color: 'bg-purple-500', dot: 'bg-purple-400', text: 'text-purple-400' },
  ph_adjuster: { color: 'bg-cyan-500', dot: 'bg-cyan-400', text: 'text-cyan-400' },
  other: { color: 'bg-gray-500', dot: 'bg-gray-400', text: 'text-gray-400' }
};

const STATUS_STYLES = {
  planned: 'bg-yellow-900/40 text-yellow-400 border border-yellow-800',
  completed: 'bg-green-900/40 text-green-400 border border-green-800',
  skipped: 'bg-dark-600 text-dark-400 border border-dark-500'
};

const isSameDay = (a, b) => {
  const da = new Date(a);
  const db = new Date(b);
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
};

const toKey = (d) => {
  const date = new Date(d);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const isOverdue = (record) => {
  if (record.status !== 'planned') return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const scheduled = new Date(record.scheduledDate);
  scheduled.setHours(0, 0, 0, 0);
  return scheduled < today;
};

const getMonthGrid = (year, month) => {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);

  let startDow = firstDay.getDay();
  if (startDow === 0) startDow = 7;

  const gridStart = new Date(firstDay);
  gridStart.setDate(gridStart.getDate() - (startDow - 1));

  let endDow = lastDay.getDay();
  if (endDow === 0) endDow = 7;
  const gridEnd = new Date(lastDay);
  gridEnd.setDate(gridEnd.getDate() + (7 - endDow));

  const days = [];
  const cursor = new Date(gridStart);
  while (cursor <= gridEnd) {
    days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  while (days.length < 35) {
    const last = days[days.length - 1];
    const next = new Date(last);
    next.setDate(next.getDate() + 1);
    days.push(next);
  }

  return days;
};

const Treatments = () => {
  const { t, i18n } = useTranslation();
  const { hasPermission } = useAuth();
  const [records, setRecords] = useState([]);
  const [products, setProducts] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const locale = i18n.language === 'en' ? 'en-US' : 'ru-RU';

  const formatDate = (d) => {
    const date = new Date(d);
    return date.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
  };

  const formatDateFull = (d) => {
    const date = new Date(d);
    return date.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
  };

  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [viewMode, setViewMode] = useState('calendar');
  const [selectedDay, setSelectedDay] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  // Modal
  const [showModal, setShowModal] = useState(false);
  const [modalForm, setModalForm] = useState({
    roomId: '', productId: '', dosage: '', applicationMethod: 'spray',
    scheduledDate: '', worker: '', notes: '', status: 'planned'
  });
  const [modalSaving, setModalSaving] = useState(false);
  const [editingRecord, setEditingRecord] = useState(null);

  const monthGrid = useMemo(() => {
    return getMonthGrid(currentMonth.getFullYear(), currentMonth.getMonth());
  }, [currentMonth]);

  const dateRange = useMemo(() => {
    const from = monthGrid[0];
    const to = new Date(monthGrid[monthGrid.length - 1]);
    to.setHours(23, 59, 59, 999);
    return { from, to };
  }, [monthGrid]);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const [recs, prods, rms] = await Promise.all([
        treatmentService.getCalendar(dateRange.from.toISOString(), dateRange.to.toISOString()),
        treatmentProductService.getAll(),
        roomService.getRooms()
      ]);
      setRecords(recs);
      setProducts(prods);
      setRooms(rms);
    } catch (err) {
      setError(err.response?.data?.message || t('treatments.loadError'));
    } finally {
      setLoading(false);
    }
  }, [dateRange, t]);

  useEffect(() => { loadData(); }, [loadData]);

  const recordsByDay = useMemo(() => {
    const map = {};
    records.forEach(r => {
      const key = toKey(r.scheduledDate);
      if (!map[key]) map[key] = [];
      map[key].push(r);
    });
    return map;
  }, [records]);

  const overdueCount = useMemo(() => records.filter(r => isOverdue(r)).length, [records]);

  const navigateMonth = (dir) => {
    setCurrentMonth(prev => new Date(prev.getFullYear(), prev.getMonth() + dir, 1));
    setSelectedDay(null);
    setExpandedId(null);
  };

  const goToday = () => {
    const now = new Date();
    setCurrentMonth(new Date(now.getFullYear(), now.getMonth(), 1));
    setSelectedDay(toKey(now));
    setExpandedId(null);
  };

  const openCreateModal = (date) => {
    const d = date || new Date();
    setEditingRecord(null);
    setModalForm({
      roomId: '', productId: '', dosage: '', applicationMethod: 'spray',
      scheduledDate: toKey(d), worker: '', notes: '', status: 'planned'
    });
    setShowModal(true);
  };

  const openEditModal = (record) => {
    setEditingRecord(record);
    setModalForm({
      roomId: record.room?._id || '', productId: record.product?._id || '',
      dosage: record.dosage || '', applicationMethod: record.applicationMethod || 'spray',
      scheduledDate: toKey(record.scheduledDate), worker: record.worker?._id || '',
      notes: record.notes || '', status: record.status || 'planned'
    });
    setShowModal(true);
  };

  const handleProductChange = (productId) => {
    const product = products.find(p => p._id === productId);
    setModalForm(f => ({ ...f, productId, dosage: product?.concentration || f.dosage }));
  };

  const handleModalSubmit = async (e) => {
    e.preventDefault();
    if (!modalForm.roomId || !modalForm.scheduledDate || modalSaving) return;
    setModalSaving(true);
    try {
      const data = {
        roomId: modalForm.roomId, productId: modalForm.productId || null,
        dosage: modalForm.dosage, applicationMethod: modalForm.applicationMethod,
        scheduledDate: modalForm.scheduledDate, worker: modalForm.worker || null,
        notes: modalForm.notes, status: modalForm.status
      };
      if (editingRecord) await treatmentService.update(editingRecord._id, data);
      else await treatmentService.create(data);
      setShowModal(false);
      await loadData();
    } catch (err) {
      setError(err.response?.data?.message || t('treatments.saveError'));
    } finally {
      setModalSaving(false);
    }
  };

  const handleComplete = async (id) => {
    try { await treatmentService.complete(id); await loadData(); }
    catch (err) { setError(err.response?.data?.message || t('treatments.error')); }
  };

  const handleSkip = async (id) => {
    try { await treatmentService.skip(id); await loadData(); }
    catch (err) { setError(err.response?.data?.message || t('treatments.error')); }
  };

  const handleDeleteRecord = async (id) => {
    if (!confirm(t('treatments.deleteRecordConfirm'))) return;
    try { await treatmentService.delete(id); await loadData(); }
    catch (err) { setError(err.response?.data?.message || t('treatments.error')); }
  };

  const activeRooms = useMemo(() => rooms.filter(r => r.status !== 'empty'), [rooms]);

  const selectedDayRecords = useMemo(() => {
    if (!selectedDay) return [];
    return (recordsByDay[selectedDay] || []).sort((a, b) => {
      const aO = isOverdue(a) ? -1 : 0;
      const bO = isOverdue(b) ? -1 : 0;
      if (aO !== bO) return aO - bO;
      const order = { planned: 0, completed: 1, skipped: 2 };
      return (order[a.status] || 0) - (order[b.status] || 0);
    });
  }, [selectedDay, recordsByDay]);

  const getTreatmentCountText = (count) => {
    if (count === 0) return t('treatments.noTreatments');
    if (i18n.language === 'ru') {
      const mod10 = count % 10;
      const mod100 = count % 100;
      if (mod10 === 1 && mod100 !== 11) return t('treatments.treatmentCount_one', { count });
      if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return t('treatments.treatmentCount_few', { count });
      return t('treatments.treatmentCount_many', { count });
    }
    return t(count === 1 ? 'treatments.treatmentCount_one' : 'treatments.treatmentCount_other', { count });
  };

  // Record detail card in side panel
  const RecordDetail = ({ record }) => {
    const typeInfo = PRODUCT_TYPE_STYLES[record.productType] || PRODUCT_TYPE_STYLES.other;
    const overdue = isOverdue(record);
    const statusCls = STATUS_STYLES[record.status] || STATUS_STYLES.planned;
    const roomName = localizeRoomName(record.room?.name, t) || t('treatments.roomDefault', { number: record.room?.roomNumber || '?' });
    const isExp = expandedId === record._id;

    return (
      <div className={`rounded-lg border transition-all ${
        overdue ? 'border-red-500/50 bg-red-900/10' :
        record.status === 'completed' ? 'border-green-800/50 bg-green-900/10' :
        record.status === 'skipped' ? 'border-dark-600 bg-dark-800/50 opacity-60' :
        'border-dark-600 bg-dark-800'
      }`}>
        <div className="p-3 cursor-pointer" onClick={() => setExpandedId(isExp ? null : record._id)}>
          <div className="flex items-center gap-2.5">
            <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${typeInfo.color}`} />
            <div className="flex-1 min-w-0">
              <div className="text-white text-sm font-medium">{roomName}</div>
              <div className="text-dark-400 text-xs">
                {record.productName || t('treatments.noProduct')}
                {record.dosage && ` · ${record.dosage}`}
                {record.applicationMethod && record.applicationMethod !== 'spray' && ` · ${t(`treatments.applicationMethods.${record.applicationMethod}`)}`}
              </div>
            </div>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 whitespace-nowrap ${statusCls}`}>
              {overdue ? `⚠ ${t('treatments.overdue')}` : t(`treatments.statuses.${record.status}`)}
            </span>
          </div>
        </div>

        {isExp && (
          <div className="px-3 pb-3 border-t border-dark-700 space-y-1.5 pt-2" onClick={(e) => e.stopPropagation()}>
            {record.worker && (
              <div className="text-xs"><span className="text-dark-500">{t('treatments.workerLabel')}: </span><span className="text-dark-300">{record.worker.name}</span></div>
            )}
            {record.completedBy && (
              <div className="text-xs">
                <span className="text-dark-500">{t('treatments.completedByLabel')}: </span><span className="text-dark-300">{record.completedBy.name}</span>
                {record.completedAt && <span className="text-dark-500"> ({formatDateFull(record.completedAt)})</span>}
              </div>
            )}
            {record.notes && (
              <div className="text-xs"><span className="text-dark-500">{t('treatments.noteLabel')}: </span><span className="text-dark-300">{record.notes}</span></div>
            )}
            <div className="flex flex-wrap gap-2 pt-1">
              {record.status === 'planned' && hasPermission('treatments:create') && (
                <button type="button" onClick={() => handleComplete(record._id)}
                  className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded text-xs font-medium">{t('treatments.markComplete')}</button>
              )}
              {record.status === 'planned' && hasPermission('treatments:edit') && (
                <button type="button" onClick={() => handleSkip(record._id)}
                  className="px-3 py-1.5 bg-dark-600 hover:bg-dark-500 text-dark-300 rounded text-xs">{t('treatments.skip')}</button>
              )}
              {hasPermission('treatments:edit') && (
                <button type="button" onClick={() => openEditModal(record)}
                  className="px-3 py-1.5 bg-dark-600 hover:bg-dark-500 text-dark-300 rounded text-xs">{t('treatments.edit')}</button>
              )}
              {hasPermission('treatments:delete') && (
                <button type="button" onClick={() => handleDeleteRecord(record._id)}
                  className="px-3 py-1.5 text-red-400 hover:text-red-300 text-xs">{t('treatments.delete')}</button>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  const monthNames = t('treatments.monthNames', { returnObjects: true });
  const dayNames = t('treatments.dayNames', { returnObjects: true });
  const monthTitle = `${monthNames[currentMonth.getMonth()]} ${currentMonth.getFullYear()}`;

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
          <h1 className="text-2xl font-bold text-white">{t('treatments.title')}</h1>
          <p className="text-dark-400 mt-1 text-sm">
            {t('treatments.subtitle')}
            {overdueCount > 0 && <span className="text-red-400 ml-2">({t('treatments.overdueCount', { count: overdueCount })})</span>}
          </p>
        </div>
        <div className="flex gap-2 shrink-0 flex-wrap">
          <Link to="/treatments/products"
            className="px-3 py-2 bg-dark-700 hover:bg-dark-600 text-dark-300 border border-dark-600 rounded-lg text-sm font-medium transition">
            {t('treatments.productsDatabase')}
          </Link>
          {hasPermission('treatments:create') && (
            <button type="button" onClick={() => openCreateModal()}
              className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm font-medium transition">
              {t('treatments.newTreatment')}
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

      {/* View toggle + Month nav */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setViewMode('calendar')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${viewMode === 'calendar' ? 'bg-primary-600 text-white' : 'bg-dark-700 text-dark-400 hover:bg-dark-600'}`}>
            {t('treatments.calendar')}
          </button>
          <button type="button" onClick={() => setViewMode('list')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${viewMode === 'list' ? 'bg-primary-600 text-white' : 'bg-dark-700 text-dark-400 hover:bg-dark-600'}`}>
            {t('treatments.list')}
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => navigateMonth(-1)}
            className="px-3 py-1.5 bg-dark-700 hover:bg-dark-600 text-dark-300 rounded-lg text-sm">&larr;</button>
          <button type="button" onClick={goToday}
            className="px-3 py-1.5 bg-dark-700 hover:bg-dark-600 text-dark-300 rounded-lg text-sm">{t('treatments.today')}</button>
          <span className="text-white text-sm font-medium min-w-[160px] text-center">{monthTitle}</span>
          <button type="button" onClick={() => navigateMonth(1)}
            className="px-3 py-1.5 bg-dark-700 hover:bg-dark-600 text-dark-300 rounded-lg text-sm">&rarr;</button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3 text-xs text-dark-400">
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-yellow-400" /> {t('treatments.legendPlanned')}</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-green-400" /> {t('treatments.legendCompleted')}</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-400 animate-pulse" /> {t('treatments.legendOverdue')}</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-dark-500" /> {t('treatments.legendSkipped')}</span>
      </div>

      {/* Calendar view */}
      {viewMode === 'calendar' && (
        <div className="flex flex-col lg:flex-row gap-4">
          {/* Month grid */}
          <div className="flex-1 min-w-0">
            <div className="grid grid-cols-7 mb-1">
              {dayNames.map(name => (
                <div key={name} className="text-center text-dark-500 text-xs font-medium py-1">{name}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-px bg-dark-700 rounded-lg overflow-hidden border border-dark-700">
              {monthGrid.map((day) => {
                const key = toKey(day);
                const dayRecords = recordsByDay[key] || [];
                const isToday = isSameDay(day, new Date());
                const isCurrentMonth = day.getMonth() === currentMonth.getMonth();
                const isSelected = selectedDay === key;
                const hasOverdue = dayRecords.some(r => isOverdue(r));

                return (
                  <div
                    key={key}
                    className={`bg-dark-800 min-h-[68px] sm:min-h-[80px] p-1 sm:p-1.5 cursor-pointer transition-all relative ${
                      isSelected ? 'ring-2 ring-primary-500 z-10' : ''
                    } ${hasOverdue ? 'bg-red-900/5' : ''} ${
                      !isCurrentMonth ? 'opacity-35' : ''
                    } hover:bg-dark-750`}
                    onClick={() => { setSelectedDay(isSelected ? null : key); setExpandedId(null); }}
                  >
                    <div className={`text-xs font-medium mb-0.5 ${
                      isToday ? 'text-primary-400' : isCurrentMonth ? 'text-dark-300' : 'text-dark-600'
                    }`}>
                      {isToday ? (
                        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary-600 text-white text-[10px]">
                          {day.getDate()}
                        </span>
                      ) : day.getDate()}
                    </div>

                    {dayRecords.length > 0 && (
                      <div className="space-y-0.5">
                        {/* Desktop: mini-cards */}
                        <div className="hidden sm:block space-y-0.5">
                          {dayRecords.slice(0, 3).map(r => {
                            const overdue = isOverdue(r);
                            return (
                              <div key={r._id} className={`flex items-center gap-1 px-1 py-0.5 rounded text-[10px] leading-tight truncate ${
                                overdue ? 'bg-red-900/30 text-red-300' :
                                r.status === 'completed' ? 'bg-green-900/20 text-green-400' :
                                r.status === 'skipped' ? 'bg-dark-700 text-dark-500 line-through' :
                                'bg-yellow-900/20 text-yellow-300'
                              }`}>
                                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                  overdue ? 'bg-red-400 animate-pulse' :
                                  r.status === 'completed' ? 'bg-green-400' :
                                  r.status === 'skipped' ? 'bg-dark-500' :
                                  'bg-yellow-400'
                                }`} />
                                <span className="truncate">{localizeRoomName(r.room?.name, t) || (i18n.language === 'ru' ? 'К' : 'R') + (r.room?.roomNumber || '?')}</span>
                              </div>
                            );
                          })}
                          {dayRecords.length > 3 && (
                            <div className="text-[10px] text-dark-500 px-1">+{dayRecords.length - 3}</div>
                          )}
                        </div>
                        {/* Mobile: dots */}
                        <div className="sm:hidden flex flex-wrap gap-0.5">
                          {dayRecords.slice(0, 6).map(r => (
                            <span key={r._id} className={`w-1.5 h-1.5 rounded-full ${
                              isOverdue(r) ? 'bg-red-400 animate-pulse' :
                              r.status === 'completed' ? 'bg-green-400' :
                              r.status === 'skipped' ? 'bg-dark-500' :
                              'bg-yellow-400'
                            }`} />
                          ))}
                          {dayRecords.length > 6 && <span className="text-[8px] text-dark-500">+{dayRecords.length - 6}</span>}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Side panel for selected day */}
          <div className="lg:w-80 shrink-0">
            {selectedDay ? (
              <div className="bg-dark-800 rounded-xl border border-dark-700 overflow-hidden sticky top-4">
                <div className="px-4 py-3 border-b border-dark-700 flex items-center justify-between">
                  <div>
                    <div className="text-white font-medium text-sm">{formatDateFull(selectedDay)}</div>
                    <div className="text-dark-500 text-xs mt-0.5">
                      {getTreatmentCountText(selectedDayRecords.length)}
                    </div>
                  </div>
                  {hasPermission('treatments:create') && (
                    <button type="button" onClick={() => openCreateModal(new Date(selectedDay + 'T12:00:00'))}
                      className="px-3 py-1.5 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-xs font-medium">
                      {t('treatments.addBtn')}
                    </button>
                  )}
                </div>
                <div className="p-3 space-y-2 max-h-[60vh] overflow-y-auto">
                  {selectedDayRecords.length === 0 ? (
                    <div className="text-dark-500 text-sm text-center py-6">{t('treatments.noTreatmentsForDay')}</div>
                  ) : (
                    selectedDayRecords.map(r => <RecordDetail key={r._id} record={r} />)
                  )}
                </div>
              </div>
            ) : (
              <div className="bg-dark-800/50 rounded-xl border border-dark-700 p-6 text-center">
                <div className="text-dark-500 text-sm">{t('treatments.clickDayHint').split('\n').map((line, i) => <span key={i}>{line}<br /></span>)}</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* List view */}
      {viewMode === 'list' && (
        <div className="bg-dark-800 rounded-xl border border-dark-700 overflow-hidden">
          {(() => {
            const monthRecords = records
              .filter(r => {
                const d = new Date(r.scheduledDate);
                return d.getMonth() === currentMonth.getMonth() && d.getFullYear() === currentMonth.getFullYear();
              })
              .sort((a, b) => new Date(a.scheduledDate) - new Date(b.scheduledDate));

            if (monthRecords.length === 0) {
              return <div className="px-4 py-8 text-center text-dark-500">{t('treatments.noTreatmentsForMonth', { month: monthTitle.toLowerCase() })}</div>;
            }

            let lastDateKey = '';
            return (
              <div className="divide-y divide-dark-700">
                {monthRecords.map(r => {
                  const dateKey = toKey(r.scheduledDate);
                  const showDateHeader = dateKey !== lastDateKey;
                  lastDateKey = dateKey;

                  const typeInfo = PRODUCT_TYPE_STYLES[r.productType] || PRODUCT_TYPE_STYLES.other;
                  const overdue = isOverdue(r);
                  const statusCls = STATUS_STYLES[r.status] || STATUS_STYLES.planned;
                  const roomName = localizeRoomName(r.room?.name, t) || t('treatments.roomDefault', { number: r.room?.roomNumber || '?' });

                  return (
                    <div key={r._id}>
                      {showDateHeader && (
                        <div className="px-4 py-1.5 bg-dark-900/50 text-dark-400 text-xs font-medium border-b border-dark-700">
                          {formatDateFull(r.scheduledDate)}
                        </div>
                      )}
                      <div
                        className={`px-4 py-3 cursor-pointer hover:bg-dark-700/50 ${overdue ? 'bg-red-900/5' : ''}`}
                        onClick={() => setExpandedId(expandedId === r._id ? null : r._id)}
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                            overdue ? 'bg-red-400 animate-pulse' :
                            r.status === 'completed' ? 'bg-green-400' :
                            r.status === 'skipped' ? 'bg-dark-500' :
                            'bg-yellow-400'
                          }`} />
                          <div className="flex-1 min-w-0">
                            <span className="text-white font-medium">{roomName}</span>
                            <span className="text-dark-400 ml-2">{r.productName || ''}</span>
                            {r.dosage && <span className="text-dark-500 ml-1">({r.dosage})</span>}
                          </div>
                          <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${statusCls}`}>
                            {overdue ? `⚠ ${t('treatments.overdue')}` : t(`treatments.statuses.${r.status}`)}
                          </span>
                        </div>

                        {expandedId === r._id && (
                          <div className="mt-2 pt-2 border-t border-dark-700 ml-5 space-y-1" onClick={(e) => e.stopPropagation()}>
                            {r.applicationMethod && <div className="text-xs text-dark-400">{t('treatments.methodLabel')}: {t(`treatments.applicationMethods.${r.applicationMethod}`) || r.applicationMethod}</div>}
                            {r.worker && <div className="text-xs text-dark-400">{t('treatments.workerLabel')}: {r.worker.name}</div>}
                            {r.notes && <div className="text-xs text-dark-400">{t('treatments.noteLabel')}: {r.notes}</div>}
                            <div className="flex flex-wrap gap-2 pt-1">
                              {r.status === 'planned' && hasPermission('treatments:create') && (
                                <button type="button" onClick={() => handleComplete(r._id)}
                                  className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-xs font-medium">{t('treatments.markComplete')}</button>
                              )}
                              {r.status === 'planned' && hasPermission('treatments:edit') && (
                                <button type="button" onClick={() => handleSkip(r._id)} className="px-3 py-1 bg-dark-600 hover:bg-dark-500 text-dark-300 rounded text-xs">{t('treatments.skip')}</button>
                              )}
                              {hasPermission('treatments:edit') && (
                                <button type="button" onClick={() => openEditModal(r)} className="px-3 py-1 bg-dark-600 hover:bg-dark-500 text-dark-300 rounded text-xs">{t('treatments.edit')}</button>
                              )}
                              {hasPermission('treatments:delete') && (
                                <button type="button" onClick={() => handleDeleteRecord(r._id)} className="px-3 py-1 text-red-400 hover:text-red-300 text-xs">{t('treatments.delete')}</button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      )}

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
          <div className="absolute inset-0 bg-black/60" />
          <div className="relative bg-dark-800 rounded-xl border border-dark-700 w-full max-w-lg max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}>
            <form onSubmit={handleModalSubmit} className="p-5 space-y-4">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-white font-semibold text-lg">
                  {editingRecord ? t('treatments.editTitle') : t('treatments.createTitle')}
                </h3>
                <button type="button" onClick={() => setShowModal(false)}
                  className="text-dark-400 hover:text-dark-300 text-2xl leading-none">&times;</button>
              </div>

              <div>
                <label className="block text-dark-400 text-sm mb-1">{t('treatments.roomRequired')}</label>
                <select value={modalForm.roomId}
                  onChange={(e) => setModalForm(f => ({ ...f, roomId: e.target.value }))}
                  className="w-full bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 text-white text-sm focus:ring-2 focus:ring-primary-500" required>
                  <option value="">{t('treatments.selectRoom')}</option>
                  {(activeRooms.length > 0 ? activeRooms : rooms).map(r => (
                    <option key={r._id} value={r._id}>{localizeRoomName(r.name, t)} {r.strain ? `(${r.strain})` : ''}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-dark-400 text-sm mb-1">{t('treatments.productLabel')}</label>
                <select value={modalForm.productId}
                  onChange={(e) => handleProductChange(e.target.value)}
                  className="w-full bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 text-white text-sm focus:ring-2 focus:ring-primary-500">
                  <option value="">{t('treatments.noProductOption')}</option>
                  {products.map(p => (
                    <option key={p._id} value={p._id}>{p.name} {p.concentration ? `(${p.concentration})` : ''}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-dark-400 text-sm mb-1">{t('treatments.dosage')}</label>
                  <input type="text" value={modalForm.dosage}
                    onChange={(e) => setModalForm(f => ({ ...f, dosage: e.target.value }))}
                    placeholder={t('treatments.dosagePlaceholder')}
                    className="w-full bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 text-white text-sm placeholder-dark-500 focus:ring-2 focus:ring-primary-500 focus:border-transparent" />
                </div>
                <div>
                  <label className="block text-dark-400 text-sm mb-1">{t('treatments.method')}</label>
                  <select value={modalForm.applicationMethod}
                    onChange={(e) => setModalForm(f => ({ ...f, applicationMethod: e.target.value }))}
                    className="w-full bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 text-white text-sm focus:ring-2 focus:ring-primary-500">
                    {['spray', 'drench', 'fogger', 'granular', 'other'].map(key => (
                      <option key={key} value={key}>{t(`treatments.applicationMethods.${key}`)}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-dark-400 text-sm mb-1">{t('treatments.dateRequired')}</label>
                <input type="date" value={modalForm.scheduledDate}
                  onChange={(e) => setModalForm(f => ({ ...f, scheduledDate: e.target.value }))}
                  className="w-full bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 text-white text-sm focus:ring-2 focus:ring-primary-500" required />
              </div>

              <div>
                <label className="block text-dark-400 text-sm mb-1">{t('treatments.noteField')}</label>
                <textarea value={modalForm.notes}
                  onChange={(e) => setModalForm(f => ({ ...f, notes: e.target.value }))}
                  rows={2}
                  className="w-full bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 text-white text-sm placeholder-dark-500 focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none" />
              </div>

              {!editingRecord && (
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="status" value="planned"
                      checked={modalForm.status === 'planned'}
                      onChange={(e) => setModalForm(f => ({ ...f, status: e.target.value }))}
                      className="text-primary-500 focus:ring-primary-500 bg-dark-700 border-dark-600" />
                    <span className="text-dark-300 text-sm">{t('treatments.statusPlan')}</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="status" value="completed"
                      checked={modalForm.status === 'completed'}
                      onChange={(e) => setModalForm(f => ({ ...f, status: e.target.value }))}
                      className="text-green-500 focus:ring-green-500 bg-dark-700 border-dark-600" />
                    <span className="text-dark-300 text-sm">{t('treatments.statusRecord')}</span>
                  </label>
                </div>
              )}

              <div className="flex gap-2 justify-end pt-2">
                <button type="button" onClick={() => setShowModal(false)}
                  className="px-4 py-2 bg-dark-600 hover:bg-dark-500 text-dark-300 rounded-lg text-sm">{t('treatments.cancel')}</button>
                <button type="submit" disabled={!modalForm.roomId || !modalForm.scheduledDate || modalSaving}
                  className="px-6 py-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white rounded-lg font-medium text-sm transition flex items-center gap-2">
                  {modalSaving && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />}
                  {editingRecord ? t('treatments.save') : modalForm.status === 'completed' ? t('treatments.record') : t('treatments.plan')}
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
