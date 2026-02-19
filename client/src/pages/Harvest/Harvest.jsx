import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { roomService } from '../../services/roomService';
import { harvestService } from '../../services/harvestService';
import { useScale } from '../../hooks/useScale';
import { useBarcode } from '../../hooks/useBarcode';
import HarvestRoomMap from '../../components/RoomMap/HarvestRoomMap';
import HarvestHistory from './HarvestHistory';

const formatDate = (date) => {
  if (!date) return '—';
  return new Date(date).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
};

const Harvest = () => {
  const { hasPermission } = useAuth();
  const canDoHarvest = hasPermission && hasPermission('harvest:record');
  const { weight: scaleWeight, unit: scaleUnit, stable: scaleStable, scaleConnected, socketConnected, debug: scaleDebug } = useScale();
  const { lastBarcode, scanTime } = useBarcode();

  const [searchParams] = useSearchParams();
  const roomIdFromUrl = searchParams.get('roomId') || '';
  const [rooms, setRooms] = useState([]);
  const [selectedRoomId, setSelectedRoomId] = useState('');
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [error, setError] = useState('');
  const [plantNumber, setPlantNumber] = useState('');
  const [manualWeight, setManualWeight] = useState('');
  const [recordLoading, setRecordLoading] = useState(false);
  const [errorNoteEdit, setErrorNoteEdit] = useState({ plantNumber: null, value: '' });
  const [errorNoteSaving, setErrorNoteSaving] = useState(false);
  const [completeSuccess, setCompleteSuccess] = useState(false);
  const [scanFlash, setScanFlash] = useState(false);
  const [duplicateError, setDuplicateError] = useState(null); // { plantNumber } — блокирующая ошибка дубля
  const [successMsg, setSuccessMsg] = useState(null); // { plantNumber, weight, sessionId, countdown }
  const [showDebug, setShowDebug] = useState(false);
  const undoTimerRef = useRef(null);
  const undoCountdownRef = useRef(null);
  const autoRecordRef = useRef(false);

  const safeRooms = Array.isArray(rooms) ? rooms : [];
  const activeRooms = safeRooms.filter(r => r && r.isActive);

  useEffect(() => {
    loadRooms();
    return () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
      if (undoCountdownRef.current) clearInterval(undoCountdownRef.current);
    };
  }, []);

  const loadRooms = async () => {
    try {
      setLoading(true);
      setError('');
      const data = await roomService.getRooms();
      const list = Array.isArray(data) ? data : [];
      setRooms(list);
    } catch (err) {
      setError('Ошибка загрузки комнат');
      console.error(err);
      setRooms([]);
    } finally {
      setLoading(false);
    }
  };

  const loadOrCreateSession = useCallback(async (roomId) => {
    if (!roomId) return;
    try {
      setSessionLoading(true);
      setError('');
      let s = null;
      try {
        s = await harvestService.getSessionByRoom(roomId);
      } catch (e) {
        if (e.response && Number(e.response.status) === 404) {
          s = await harvestService.createSession(roomId);
        } else {
          throw e;
        }
      }
      if (!s) s = await harvestService.createSession(roomId);
      setSession(s);
    } catch (err) {
      const msg = err.response?.data?.message || err.message || 'Ошибка сессии сбора';
      setError(msg);
      setSession(null);
      console.error('Harvest session error:', err.response?.data || err);
    } finally {
      setSessionLoading(false);
    }
  }, []);

  // Выбор комнаты по клику на карточку
  const handleSelectRoom = (roomId) => {
    setSelectedRoomId(roomId);
    setSession(null);
    setError('');
    setCompleteSuccess(false);
    loadOrCreateSession(roomId);
  };

  // Вернуться к выбору комнат
  const handleBackToRooms = () => {
    setSelectedRoomId('');
    setSession(null);
    setError('');
    setManualWeight('');
    setPlantNumber('');
  };

  // URL param auto-select
  useEffect(() => {
    if (roomIdFromUrl && safeRooms.length && !selectedRoomId) {
      const room = safeRooms.find(r => r._id === roomIdFromUrl);
      if (room?.isActive) {
        handleSelectRoom(roomIdFromUrl);
      }
    }
  }, [roomIdFromUrl, rooms]);

  // Обработка скана штрихкода
  useEffect(() => {
    if (!lastBarcode || !scanTime || !session || session.status !== 'in_progress') return;

    const num = parseInt(lastBarcode, 10);
    if (isNaN(num) || num <= 0) return;

    // Получить записанные кусты
    const harvestedPlants = new Set((session.plants || []).map(p => p.plantNumber));

    if (harvestedPlants.has(num)) {
      // Куст уже записан — блокирующая ошибка (нужно нажать ОК)
      setDuplicateError({ plantNumber: num });
      return;
    }

    // Заполнить номер
    setPlantNumber(String(num));
    setError('');

    // Авто-запись: если вес стабильный и > 0
    if (scaleConnected && scaleWeight != null && scaleWeight > 0) {
      // Небольшая задержка чтобы state обновился
      autoRecordRef.current = true;
    }

    // Визуальный feedback
    setScanFlash(true);
    setTimeout(() => setScanFlash(false), 1500);
  }, [scanTime]); // eslint-disable-line react-hooks/exhaustive-deps

  // Авто-запись после скана (когда plantNumber обновился)
  useEffect(() => {
    if (autoRecordRef.current && plantNumber) {
      autoRecordRef.current = false;
      handleRecordPlant(null, plantNumber);
    }
  }, [plantNumber]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRecordPlant = async (e, overridePlantNumber) => {
    if (e && e.preventDefault) e.preventDefault();
    if (duplicateError) return; // Блокировка пока не закрыта ошибка дубля
    const num = (overridePlantNumber || plantNumber).toString().trim();
    // Если вес не введён вручную — берём с весов автоматически
    const weight = manualWeight
      ? parseInt(manualWeight, 10)
      : (scaleConnected && scaleWeight != null ? scaleWeight : NaN);
    if (!session || !num || isNaN(weight) || weight <= 0) return;
    if (session.status !== 'in_progress') return;

    // Проверка дубля на клиенте перед отправкой
    const harvestedPlants = new Set((session.plants || []).map(p => p.plantNumber));
    if (harvestedPlants.has(parseInt(num, 10))) {
      setDuplicateError({ plantNumber: parseInt(num, 10) });
      return;
    }

    try {
      setRecordLoading(true);
      setError('');
      const res = await harvestService.addPlant(session._id, num, weight);
      const updated = res?.session ?? res;
      setSession(updated);
      setPlantNumber('');
      setManualWeight('');
      // Уведомление об успешной записи с возможностью отмены 7 сек
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
      if (undoCountdownRef.current) clearInterval(undoCountdownRef.current);
      const msgData = { plantNumber: num, weight, sessionId: session._id, countdown: 7 };
      setSuccessMsg(msgData);
      undoCountdownRef.current = setInterval(() => {
        setSuccessMsg(prev => {
          if (!prev) return null;
          const next = prev.countdown - 1;
          if (next <= 0) return null;
          return { ...prev, countdown: next };
        });
      }, 1000);
      undoTimerRef.current = setTimeout(() => {
        setSuccessMsg(null);
        if (undoCountdownRef.current) clearInterval(undoCountdownRef.current);
      }, 7000);
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка записи куста');
      console.error(err);
    } finally {
      setRecordLoading(false);
    }
  };

  const handleUndoPlant = async () => {
    if (!successMsg) return;
    const { sessionId, plantNumber: num } = successMsg;
    // Остановить таймеры
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    if (undoCountdownRef.current) clearInterval(undoCountdownRef.current);
    setSuccessMsg(null);
    try {
      const updated = await harvestService.removePlant(sessionId, num);
      setSession(updated);
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка отмены записи');
      console.error(err);
    }
  };

  const handleSaveErrorNote = async (plantNum) => {
    if (!session) return;
    const value = errorNoteEdit.plantNumber === plantNum ? errorNoteEdit.value : (session.plants?.find(p => p.plantNumber === plantNum)?.errorNote || '');
    try {
      setErrorNoteSaving(true);
      const updated = await harvestService.setPlantErrorNote(session._id, plantNum, value);
      setSession(updated);
      setErrorNoteEdit({ plantNumber: null, value: '' });
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка сохранения пометки');
      console.error(err);
    } finally {
      setErrorNoteSaving(false);
    }
  };

  const handleCompleteSession = async () => {
    if (!session) return;
    const isTest = selectedRoom?.isTestRoom;
    const confirmMsg = isTest
      ? 'Завершить тестовый сбор? Данные НЕ попадут в архив. Комната будет сброшена для нового теста.'
      : 'Завершить сбор? Комната автоматически попадёт в архив и освободится для нового цикла. Записывать кусты будет нельзя.';
    if (!confirm(confirmMsg)) return;
    try {
      setSessionLoading(true);
      setError('');
      await harvestService.completeSession(session._id);
      setSession(null);
      setSelectedRoomId('');
      setCompleteSuccess(true);
      setTimeout(() => setCompleteSuccess(false), 5000);
      await loadRooms();
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка завершения');
      console.error(err);
    } finally {
      setSessionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500" />
      </div>
    );
  }

  // ── Режим выбора комнаты (нет selectedRoomId) ──
  if (!selectedRoomId && !sessionLoading) {
    return (
      <div>
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">Сбор урожая</h1>
          <p className="text-dark-400 mt-1">Выберите комнату для начала сбора</p>
        </div>

        {error && (
          <div className="bg-red-900/30 border border-red-800 text-red-400 px-4 py-3 rounded-lg mb-6">
            {error}
          </div>
        )}
        {completeSuccess && (
          <div className="bg-green-900/30 border border-green-700 text-green-400 px-4 py-3 rounded-lg mb-6">
            Сбор завершён. Комната автоматически архивирована и освобождена для нового цикла.
          </div>
        )}

        {activeRooms.length === 0 ? (
          <div className="bg-amber-900/20 border border-amber-700 text-amber-400 px-4 py-3 rounded-lg">
            Нет активных комнат. Запустите цикл в комнате на странице «Активные комнаты», затем возвращайтесь сюда для сбора урожая.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {activeRooms.map((r) => {
              const progress = r.progress ?? 0;
              const day = r.currentDay ?? 0;
              const total = r.floweringDays ?? 0;
              const daysLeft = r.daysRemaining ?? null;
              const progressColor = progress >= 95 ? 'bg-red-500' : progress >= 80 ? 'bg-yellow-500' : 'bg-primary-500';
              const borderColor = progress >= 95
                ? 'border-red-700/50 hover:border-red-500/70'
                : progress >= 80
                  ? 'border-yellow-700/50 hover:border-yellow-500/70'
                  : 'border-dark-600 hover:border-primary-600/50';
              return (
                <button
                  key={r._id}
                  type="button"
                  onClick={() => handleSelectRoom(r._id)}
                  className={`text-left bg-dark-800 rounded-xl p-4 border-2 ${borderColor} transition-all hover:bg-dark-750 group`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-white font-bold text-lg truncate">
                      {r.name}
                      {r.isTestRoom && (
                        <span className="ml-2 text-xs bg-amber-600/30 text-amber-400 px-2 py-0.5 rounded-full font-normal">ТЕСТ</span>
                      )}
                    </span>
                    <svg className="w-5 h-5 text-dark-500 group-hover:text-primary-400 transition shrink-0 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                  <div className="text-sm text-primary-400 truncate mb-2">
                    {r.flowerStrains?.length > 0
                      ? r.flowerStrains.map(fs => fs.strain).filter(Boolean).join(', ') || 'без сорта'
                      : r.strain || 'без сорта'}
                  </div>
                  <div className="flex items-center gap-3 text-sm text-dark-400 mb-3">
                    <span>{r.plantsCount || 0} кустов</span>
                    {daysLeft != null && daysLeft >= 0 && (
                      <span className={daysLeft <= 3 ? 'text-red-400' : ''}>
                        {daysLeft === 0 ? 'Урожай сегодня!' : `${daysLeft} дн. до урожая`}
                      </span>
                    )}
                  </div>
                  {/* Progress bar */}
                  <div className="h-2 bg-dark-700 rounded-full overflow-hidden mb-1.5">
                    <div
                      className={`h-full ${progressColor} rounded-full transition-all`}
                      style={{ width: `${Math.min(progress, 100)}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-dark-500">День {day} из {total}</span>
                    <span className={`font-medium ${progress >= 95 ? 'text-red-400' : progress >= 80 ? 'text-yellow-400' : 'text-primary-400'}`}>
                      {progress}%
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Harvest history */}
        <HarvestHistory />
      </div>
    );
  }

  // ── Режим сессии сбора ──
  const totalWet = session?.plants?.reduce((s, p) => s + p.wetWeight, 0) ?? 0;
  const expected = session?.plantsCount ?? 0;
  const recorded = session?.plants?.length ?? 0;
  const progressPct = expected > 0 ? Math.round((recorded / expected) * 100) : 0;
  const avgWeight = recorded > 0 ? Math.round(totalWet / recorded) : 0;

  const strainStats = (() => {
    if (!session?.plants?.length) return [];
    const map = {};
    for (const p of session.plants) {
      const s = p.strain || '—';
      if (!map[s]) map[s] = { strain: s, count: 0, totalWet: 0 };
      map[s].count++;
      map[s].totalWet += p.wetWeight || 0;
    }
    return Object.values(map).sort((a, b) => b.totalWet - a.totalWet);
  })();

  const STRAIN_COLORS = ['bg-primary-500', 'bg-green-500', 'bg-yellow-500', 'bg-pink-500', 'bg-blue-500', 'bg-orange-500'];
  const strainColorMap = (() => {
    const map = {};
    const strains = [...new Set((session?.plants || []).map(p => p.strain || '—'))];
    strains.forEach((s, i) => { map[s] = STRAIN_COLORS[i % STRAIN_COLORS.length]; });
    return map;
  })();

  const selectedRoom = safeRooms.find(r => r._id === selectedRoomId);
  const sessionPlants = session?.plants || [];
  const harvestedPlants = new Set(sessionPlants.map(p => p.plantNumber));
  const harvestedWeights = new Map(sessionPlants.map(p => [p.plantNumber, p.wetWeight]));
  const hasRoomMap = selectedRoom?.roomLayout?.customRows?.length > 0 &&
    selectedRoom?.roomLayout?.plantPositions?.length > 0;

  return (
    <div>
      {/* Шапка с кнопкой назад */}
      <div className="mb-6">
        <button
          type="button"
          onClick={handleBackToRooms}
          className="flex items-center gap-2 text-dark-400 hover:text-primary-400 transition text-sm mb-3"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          К выбору комнаты
        </button>
        <h1 className="text-2xl font-bold text-white">
          Сбор урожая — {selectedRoom?.name || 'Комната'}
          {selectedRoom?.isTestRoom && (
            <span className="ml-3 text-base bg-amber-600/30 text-amber-400 px-3 py-1 rounded-full font-normal">
              Тестовый режим
            </span>
          )}
        </h1>
        {selectedRoom?.isTestRoom ? (
          <p className="text-amber-400 mt-1">Тестовая комната — данные не попадут в архив и статистику.</p>
        ) : (
          <p className="text-dark-400 mt-1">Введите номер куста и вес, затем нажмите «Записать».</p>
        )}
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-800 text-red-400 px-4 py-3 rounded-lg mb-6">
          {error}
        </div>
      )}

      {/* Блокирующая ошибка дубля — нужно нажать ОК */}
      {duplicateError && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-dark-800 border-2 border-red-600 rounded-2xl p-6 max-w-sm w-full shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-full bg-red-600/20 flex items-center justify-center shrink-0">
                <svg className="w-7 h-7 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <div>
                <h3 className="text-white font-bold text-lg">Куст уже записан!</h3>
                <p className="text-red-400 text-sm mt-1">Куст <span className="font-bold text-white">#{duplicateError.plantNumber}</span> уже есть в этой сессии сбора.</p>
              </div>
            </div>
            <button
              onClick={() => { setDuplicateError(null); setPlantNumber(''); }}
              className="w-full px-4 py-3 bg-red-600 hover:bg-red-500 text-white rounded-xl font-bold text-lg transition"
            >
              ОК
            </button>
          </div>
        </div>
      )}

      {/* Уведомление об успешной записи — по центру с отменой */}
      {successMsg && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-dark-800 border-2 border-green-600 rounded-2xl p-6 max-w-sm w-full shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-full bg-green-600/20 flex items-center justify-center shrink-0">
                <svg className="w-7 h-7 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <h3 className="text-white font-bold text-lg">Куст записан!</h3>
                <p className="text-green-400 text-sm mt-1">
                  Куст <span className="font-bold text-white">#{successMsg.plantNumber}</span> — <span className="font-bold text-white">{successMsg.weight} г</span>
                </p>
              </div>
            </div>
            {/* Прогресс-бар обратного отсчёта */}
            <div className="w-full bg-dark-700 rounded-full h-1.5 mb-4 overflow-hidden">
              <div
                className="bg-green-500 h-full rounded-full transition-all duration-1000 ease-linear"
                style={{ width: `${((successMsg.countdown || 0) / 7) * 100}%` }}
              />
            </div>
            <button
              onClick={handleUndoPlant}
              className="w-full px-4 py-3 bg-dark-700 hover:bg-red-600 border border-dark-600 hover:border-red-500 text-dark-300 hover:text-white rounded-xl font-bold text-lg transition"
            >
              Отменить ({successMsg.countdown || 0})
            </button>
          </div>
        </div>
      )}

      {/* Дебаг-панель оборудования */}
      {showDebug && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-dark-800 border border-dark-600 rounded-2xl p-6 max-w-md w-full shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-white font-bold text-lg">Диагностика оборудования</h3>
              <button onClick={() => setShowDebug(false)} className="text-dark-400 hover:text-white p-1">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-3">
              {/* Сокет */}
              <div className="flex items-center justify-between py-2 px-3 bg-dark-700 rounded-lg">
                <span className="text-dark-300 text-sm">Сервер (WebSocket)</span>
                <span className={`flex items-center gap-2 text-sm font-medium ${socketConnected ? 'text-green-400' : 'text-red-400'}`}>
                  <span className={`w-2 h-2 rounded-full ${socketConnected ? 'bg-green-400' : 'bg-red-400'}`} />
                  {socketConnected ? 'Подключен' : 'Отключен'}
                </span>
              </div>

              {/* Pi */}
              <div className="flex items-center justify-between py-2 px-3 bg-dark-700 rounded-lg">
                <span className="text-dark-300 text-sm">Raspberry Pi</span>
                <span className={`flex items-center gap-2 text-sm font-medium ${scaleDebug ? 'text-green-400' : 'text-red-400'}`}>
                  <span className={`w-2 h-2 rounded-full ${scaleDebug ? 'bg-green-400' : 'bg-red-400'}`} />
                  {scaleDebug ? 'Онлайн' : 'Нет данных'}
                </span>
              </div>

              {/* Весы */}
              <div className="flex items-center justify-between py-2 px-3 bg-dark-700 rounded-lg">
                <span className="text-dark-300 text-sm">Весы (USB)</span>
                <span className={`flex items-center gap-2 text-sm font-medium ${scaleConnected ? 'text-green-400' : 'text-red-400'}`}>
                  <span className={`w-2 h-2 rounded-full ${scaleConnected ? 'bg-green-400' : 'bg-red-400'}`} />
                  {scaleConnected ? 'Подключены' : 'Отключены'}
                </span>
              </div>

              {/* Сканер */}
              <div className="flex items-center justify-between py-2 px-3 bg-dark-700 rounded-lg">
                <span className="text-dark-300 text-sm">Сканер штрихкодов</span>
                <span className={`flex items-center gap-2 text-sm font-medium ${scaleDebug?.barcodeConnected ? 'text-green-400' : 'text-red-400'}`}>
                  <span className={`w-2 h-2 rounded-full ${scaleDebug?.barcodeConnected ? 'bg-green-400' : 'bg-red-400'}`} />
                  {scaleDebug?.barcodeConnected ? 'Подключен' : 'Отключен'}
                </span>
              </div>

              {/* Детали от Pi */}
              {scaleDebug && (
                <div className="mt-3 pt-3 border-t border-dark-600 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-dark-400">Порт весов</span>
                    <span className="text-dark-200 font-mono">{scaleDebug.serialPort || '—'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-dark-400">Аптайм Pi</span>
                    <span className="text-dark-200 font-mono">
                      {scaleDebug.uptime != null
                        ? scaleDebug.uptime >= 3600
                          ? `${Math.floor(scaleDebug.uptime / 3600)}ч ${Math.floor((scaleDebug.uptime % 3600) / 60)}м`
                          : scaleDebug.uptime >= 60
                            ? `${Math.floor(scaleDebug.uptime / 60)}м ${scaleDebug.uptime % 60}с`
                            : `${scaleDebug.uptime}с`
                        : '—'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-dark-400">Последний вес</span>
                    <span className="text-dark-200 font-mono">{scaleDebug.lastWeight ?? '—'} г</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-dark-400">Ошибки чтения</span>
                    <span className={`font-mono ${scaleDebug.errorCount > 0 ? 'text-amber-400' : 'text-dark-200'}`}>
                      {scaleDebug.errorCount ?? 0}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-dark-400">Время Pi</span>
                    <span className="text-dark-200 font-mono text-xs">
                      {scaleDebug.piTime ? new Date(scaleDebug.piTime).toLocaleTimeString('ru-RU') : '—'}
                    </span>
                  </div>
                </div>
              )}

              {!scaleDebug && socketConnected && (
                <p className="text-dark-500 text-xs text-center mt-2">
                  Pi не отправляет диагностику. Обновите клиент на Pi.
                </p>
              )}
            </div>

            <button
              onClick={() => setShowDebug(false)}
              className="w-full mt-5 px-4 py-2.5 bg-dark-700 hover:bg-dark-600 text-dark-300 hover:text-white border border-dark-600 rounded-xl font-medium transition"
            >
              Закрыть
            </button>
          </div>
        </div>
      )}

      {sessionLoading && (
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-500" />
        </div>
      )}

      {session && session.status === 'in_progress' && (
        <>
          {/* Информация о комнате и сессии */}
          <div className="bg-dark-800 rounded-xl p-6 border border-dark-700 mb-6">
            <h2 className="text-lg font-semibold text-white mb-4">Комната и сессия</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              {session.cycleName && (
                <div>
                  <div className="text-dark-400">Цикл</div>
                  <div className="text-white font-medium">{session.cycleName}</div>
                </div>
              )}
              <div>
                <div className="text-dark-400">Комната</div>
                <div className="text-white font-medium">{session.roomName}</div>
              </div>
              <div>
                <div className="text-dark-400">Сорт</div>
                <div className="text-white font-medium">
                  {selectedRoom?.flowerStrains?.length > 0
                    ? selectedRoom.flowerStrains.map(fs => fs.strain).filter(Boolean).join(', ') || '—'
                    : session.strain || '—'}
                </div>
              </div>
              <div>
                <div className="text-dark-400">Ожидается кустов</div>
                <div className="text-white font-medium">{session.plantsCount}</div>
              </div>
              <div>
                <div className="text-dark-400">Сбор начат</div>
                <div className="text-white font-medium">{formatDate(session.startedAt)}</div>
              </div>
            </div>
          </div>

          {/* Весы и запись куста */}
          <div className="bg-dark-800 rounded-xl p-6 border border-dark-700 mb-6">
            <h2 className="text-lg font-semibold text-white mb-4">Записать куст</h2>

            {/* Live-дисплей весов */}
            <div className={`flex items-center gap-3 mb-4 p-3 rounded-lg border ${
              scaleConnected
                ? 'bg-dark-700 border-green-700/50'
                : 'bg-dark-700/50 border-dark-600'
            }`}>
              <div className={`w-3 h-3 rounded-full shrink-0 ${
                scaleConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'
              }`} />
              {scaleConnected ? (
                <div className="flex items-center gap-4 flex-wrap flex-1">
                  <div className="text-3xl font-mono font-bold text-white leading-none">
                    {scaleWeight != null ? `${scaleWeight} г` : '--- г'}
                  </div>
                  {scaleStable && (
                    <span className="text-xs bg-green-600/20 text-green-400 px-2 py-0.5 rounded">
                      Стабильно
                    </span>
                  )}
                </div>
              ) : (
                <div className="text-dark-400 text-sm flex-1">
                  {socketConnected ? 'Весы не подключены' : 'Подключение к серверу...'}
                </div>
              )}
              {/* Кнопка диагностики */}
              <button
                type="button"
                onClick={() => setShowDebug(true)}
                className="p-2 text-dark-400 hover:text-white hover:bg-dark-600 rounded-lg transition shrink-0"
                title="Диагностика оборудования"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
            </div>

            <div className="flex flex-wrap items-end gap-4">
              <div>
                <label className="block text-sm text-dark-400 mb-1">Номер куста</label>
                <input
                  type="number"
                  min="1"
                  value={plantNumber}
                  onChange={(e) => setPlantNumber(e.target.value)}
                  placeholder="1"
                  className={`w-28 px-3 py-2 bg-dark-700 border rounded-lg text-white text-lg focus:ring-2 focus:ring-primary-500 transition-colors duration-300 ${
                    scanFlash ? 'border-green-500 ring-2 ring-green-500/50' : 'border-dark-600'
                  }`}
                />
              </div>
              <div>
                <label className="block text-sm text-dark-400 mb-1">Вес (г)</label>
                <input
                  type="number"
                  min="1"
                  value={manualWeight}
                  onChange={(e) => setManualWeight(e.target.value)}
                  placeholder={scaleConnected && scaleWeight != null ? String(scaleWeight) : '250'}
                  className="w-28 px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-lg focus:ring-2 focus:ring-primary-500"
                />
              </div>
              {scaleConnected && scaleWeight != null && (
                <button
                  type="button"
                  onClick={() => setManualWeight(String(scaleWeight))}
                  className="px-3 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-500 text-sm font-medium"
                >
                  Взять с весов ({scaleWeight} г)
                </button>
              )}
              <button
                type="button"
                onClick={handleRecordPlant}
                disabled={!canDoHarvest || !plantNumber.trim() || (!manualWeight && !(scaleConnected && scaleWeight > 0)) || recordLoading}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-500 disabled:opacity-50 font-medium"
              >
                {recordLoading ? '...' : 'Записать'}
              </button>
            </div>
            {scaleConnected && !manualWeight && (
              <p className="text-xs text-dark-500 mt-2">
                Вес не введён — при записи будет использован вес с весов автоматически.
              </p>
            )}
          </div>

          {/* Карта комнаты */}
          {hasRoomMap ? (
            <div className="bg-dark-800 rounded-xl p-6 border border-dark-700 mb-6">
              <h2 className="text-lg font-semibold text-white mb-4">Карта комнаты</h2>
              <HarvestRoomMap
                room={selectedRoom}
                harvestedPlants={harvestedPlants}
                harvestedWeights={harvestedWeights}
                onPlantClick={(plantNumber) => {
                  if (!harvestedPlants.has(plantNumber)) {
                    setPlantNumber(String(plantNumber));
                  }
                }}
              />
            </div>
          ) : selectedRoom && (
            <div className="bg-dark-800/50 rounded-xl p-4 border border-dark-700/50 mb-6">
              <p className="text-dark-500 text-sm">
                Карта комнаты не настроена.{' '}
                <span className="text-dark-400">Настройте карту и расставьте кусты в «Активных комнатах» чтобы видеть прогресс сбора.</span>
              </p>
            </div>
          )}

          {/* Инфографика */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-dark-800 rounded-xl p-4 border border-dark-700">
              <div className="text-2xl font-bold text-white">{recorded} / {expected}</div>
              <div className="text-xs text-dark-400">Кустов записано</div>
            </div>
            <div className="bg-dark-800 rounded-xl p-4 border border-dark-700">
              <div className="text-2xl font-bold text-green-400">{totalWet} г</div>
              <div className="text-xs text-dark-400">Мокрый вес всего</div>
            </div>
            <div className="bg-dark-800 rounded-xl p-4 border border-dark-700">
              <div className="text-2xl font-bold text-primary-400">{progressPct}%</div>
              <div className="text-xs text-dark-400">Прогресс сбора</div>
            </div>
            <div className="bg-dark-800 rounded-xl p-4 border border-dark-700">
              <div className="text-2xl font-bold text-yellow-400">{avgWeight} г</div>
              <div className="text-xs text-dark-400">Средний вес куста</div>
            </div>
          </div>

          {/* Статистика по сортам */}
          {strainStats.length > 1 && (
            <div className="bg-dark-800 rounded-xl p-4 border border-dark-700 mb-6">
              <h3 className="text-sm font-semibold text-white mb-3">По сортам</h3>
              <div className="space-y-2">
                {strainStats.map(st => {
                  const pct = totalWet > 0 ? Math.round((st.totalWet / totalWet) * 100) : 0;
                  const colorClass = strainColorMap[st.strain] || 'bg-primary-500';
                  return (
                    <div key={st.strain}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-dark-300 flex items-center gap-1.5">
                          <span className={`inline-block w-2.5 h-2.5 rounded-sm ${colorClass}`} />
                          {st.strain}
                        </span>
                        <span className="text-white">{st.count} кустов · {st.totalWet} г · {Math.round(st.totalWet / st.count)} г/куст</span>
                      </div>
                      <div className="h-1.5 bg-dark-700 rounded-full overflow-hidden">
                        <div className={`h-full ${colorClass} rounded-full`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Прогресс-бар */}
          <div className="mb-6">
            <div className="flex justify-between text-sm text-dark-400 mb-1">
              <span>Прогресс</span>
              <span>{recorded} из {expected} кустов</span>
            </div>
            <div className="h-3 bg-dark-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary-500 transition-all duration-500"
                style={{ width: `${Math.min(progressPct, 100)}%` }}
              />
            </div>
          </div>

          {/* Лог записей (когда и кем) */}
          <div className="bg-dark-800 rounded-xl p-6 border border-dark-700 mb-6">
            <h2 className="text-lg font-semibold text-white mb-4">Лог записей</h2>
            {session.plants?.length === 0 ? (
              <p className="text-dark-400 text-sm">Пока нет записей.</p>
            ) : (
              <div className="overflow-x-auto max-h-48 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-dark-400 border-b border-dark-600">
                      <th className="pb-2 pr-3">Время</th>
                      <th className="pb-2 pr-3">Кто записал</th>
                      <th className="pb-2 pr-3">№ куста</th>
                      <th className="pb-2 pr-3">Сорт</th>
                      <th className="pb-2 pr-3">Вес (г)</th>
                      <th className="pb-2">Пометка об ошибке</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...(session.plants || [])]
                      .sort((a, b) => new Date(b.recordedAt) - new Date(a.recordedAt))
                      .map((p) => (
                        <tr key={`${p.plantNumber}-${p.recordedAt}`} className="border-b border-dark-700">
                          <td className="py-2 pr-3 text-dark-300">{formatDate(p.recordedAt)}</td>
                          <td className="py-2 pr-3 text-white">{p.recordedBy?.name || '—'}</td>
                          <td className="py-2 pr-3 font-medium text-white">{p.plantNumber}</td>
                          <td className="py-2 pr-3 text-dark-300">{p.strain || '—'}</td>
                          <td className="py-2 pr-3 text-green-400">{p.wetWeight}</td>
                          <td className="py-2">
                            {errorNoteEdit.plantNumber === p.plantNumber ? (
                              <div className="flex items-center gap-1">
                                <input
                                  type="text"
                                  value={errorNoteEdit.value}
                                  onChange={(e) => setErrorNoteEdit(prev => ({ ...prev, value: e.target.value }))}
                                  placeholder="Пометка об ошибке"
                                  className="flex-1 min-w-0 px-2 py-1 bg-dark-600 border border-dark-500 rounded text-white text-xs"
                                />
                                <button
                                  type="button"
                                  onClick={() => handleSaveErrorNote(p.plantNumber)}
                                  disabled={errorNoteSaving}
                                  className="text-primary-400 hover:text-primary-300 text-xs whitespace-nowrap"
                                >
                                  Сохранить
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setErrorNoteEdit({ plantNumber: null, value: '' })}
                                  className="text-dark-400 hover:text-white text-xs"
                                >
                                  Отмена
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2">
                                {p.errorNote ? (
                                  <span className="text-amber-400 text-xs">{p.errorNote}</span>
                                ) : (
                                  <span className="text-dark-500 text-xs">—</span>
                                )}
                                <button
                                  type="button"
                                  onClick={() => setErrorNoteEdit({
                                    plantNumber: p.plantNumber,
                                    value: p.errorNote || ''
                                  })}
                                  className="text-primary-400 hover:text-primary-300 text-xs"
                                >
                                  {p.errorNote ? 'Изменить' : 'Добавить пометку'}
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-xs text-dark-500 mt-2">Данные нельзя удалить. Можно добавить или изменить пометку об ошибке.</p>
          </div>

          {/* Таблица кустов по номерам и гистограмма весов */}
          <div className="grid lg:grid-cols-2 gap-6 mb-6">
            <div className="bg-dark-800 rounded-xl p-6 border border-dark-700">
              <h2 className="text-lg font-semibold text-white mb-4">Записанные кусты по номеру</h2>
              {session.plants?.length === 0 ? (
                <p className="text-dark-400 text-sm">Пока нет записей. Введите номер куста, снимите вес и нажмите «Записать».</p>
              ) : (
                <div className="overflow-x-auto max-h-64 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-dark-400 border-b border-dark-600">
                        <th className="pb-2 pr-4">№</th>
                        <th className="pb-2 pr-4">Сорт</th>
                        <th className="pb-2 pr-4">Вес (г)</th>
                        <th className="pb-2 pr-4">Когда</th>
                        <th className="pb-2">Кто записал</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...(session.plants || [])].sort((a, b) => a.plantNumber - b.plantNumber).map((p) => (
                        <tr key={`${p.plantNumber}-${p.recordedAt}`} className="border-b border-dark-700">
                          <td className="py-2 pr-4 font-medium text-white">{p.plantNumber}</td>
                          <td className="py-2 pr-4 text-dark-300">{p.strain || '—'}</td>
                          <td className="py-2 pr-4 text-green-400">{p.wetWeight}</td>
                          <td className="py-2 pr-4 text-dark-300">{formatDate(p.recordedAt)}</td>
                          <td className="py-2 text-white">{p.recordedBy?.name || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="bg-dark-800 rounded-xl p-6 border border-dark-700">
              <h2 className="text-lg font-semibold text-white mb-4">Вес по кустам</h2>
              {session.plants?.length === 0 ? (
                <p className="text-dark-400 text-sm">Нет данных для графика.</p>
              ) : (
                <div className="flex items-end gap-1 h-48">
                  {[...(session.plants || [])].sort((a, b) => a.plantNumber - b.plantNumber).map((p) => {
                    const maxW = Math.max(...session.plants.map(x => x.wetWeight), 1);
                    const h = (p.wetWeight / maxW) * 100;
                    const barColor = strainColorMap[p.strain || '—'] || 'bg-primary-500';
                    return (
                      <div key={`${p.plantNumber}-bar`} className="flex-1 flex flex-col items-center gap-1">
                        <div
                          className={`w-full ${barColor} rounded-t min-h-[4px] transition-all`}
                          style={{ height: `${h}%` }}
                          title={`Куст ${p.plantNumber} (${p.strain || '—'}): ${p.wetWeight} г`}
                        />
                        <span className="text-xs text-dark-400">{p.plantNumber}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="flex justify-end items-center gap-3">
            {selectedRoom?.isTestRoom && (
              <span className="text-amber-400 text-sm">Тестовая комната — завершение не создаст архив</span>
            )}
            {!canDoHarvest && (
              <span className="text-dark-500 text-sm">Нет права на сбор урожая — только просмотр</span>
            )}
            <button
              type="button"
              onClick={handleCompleteSession}
              disabled={sessionLoading || !canDoHarvest}
              className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-500 font-medium disabled:opacity-50"
            >
              {selectedRoom?.isTestRoom ? 'Завершить тест' : 'Завершить сбор'}
            </button>
          </div>
        </>
      )}

      {session && session.status === 'completed' && (
        <div className="bg-dark-800 rounded-xl p-6 border border-dark-700">
          <p className="text-green-400 font-medium">Сбор по этой комнате завершён.</p>
          <p className="text-dark-400 text-sm mt-1">Всего записано кустов: {session.plants?.length ?? 0}, мокрый вес: {totalWet} г.</p>
          <button
            type="button"
            onClick={handleBackToRooms}
            className="mt-3 px-4 py-2 bg-dark-700 hover:bg-dark-600 text-primary-400 rounded-lg text-sm font-medium transition"
          >
            ← К выбору комнаты
          </button>
        </div>
      )}
    </div>
  );
};

export default Harvest;
