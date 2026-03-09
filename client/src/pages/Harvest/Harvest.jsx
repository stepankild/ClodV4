import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { roomService } from '../../services/roomService';
import { harvestService } from '../../services/harvestService';
import { useScale } from '../../hooks/useScale';
import { useBarcode } from '../../hooks/useBarcode';
import { onScaleEvent } from '../../services/scaleSocket';
import HarvestRoomMap from '../../components/RoomMap/HarvestRoomMap';
import HarvestHistory from './HarvestHistory';
import HarvestCompleteModal from './HarvestCompleteModal';
import CrewInfographic from '../../components/Harvest/CrewInfographic';
import { localizeRoomName } from '../../utils/localizeRoomName';

// ── Crew roles definition (takes t for i18n) ──
const getCREW_ROLES = (t) => [
  { key: 'cutting', emoji: '✂️', label: t('crewRoles.cutting'), desc: t('crewRoles.cuttingDesc') },
  { key: 'room', emoji: '🧹', label: t('crewRoles.room'), desc: t('crewRoles.roomDesc') },
  { key: 'carrying', emoji: '🚶', label: t('crewRoles.carrying'), desc: t('crewRoles.carryingDesc') },
  { key: 'weighing', emoji: '⚖️', label: t('crewRoles.weighing'), desc: t('crewRoles.weighingDesc'), max: 1 },
  { key: 'hooks', emoji: '🪝', label: t('crewRoles.hooks'), desc: t('crewRoles.hooksDesc') },
  { key: 'hanging', emoji: '🧵', label: t('crewRoles.hanging'), desc: t('crewRoles.hangingDesc') },
  { key: 'observer', emoji: '👁️', label: t('crewRoles.observer'), desc: t('crewRoles.observerDesc') },
];

const Harvest = () => {
  const { t, i18n } = useTranslation();
  const { hasPermission, user } = useAuth();
  const canDoHarvest = hasPermission && hasPermission('harvest:record');
  const { weight: scaleWeight, unit: scaleUnit, stable: scaleStable, scaleConnected, socketConnected, debug: scaleDebug, syncing, syncCount, bufferedBarcodes } = useScale();
  const { lastBarcode, scanTime, barcodeWeight, barcodeWeightUnit, barcodeWeightStable, barcodeBuffered } = useBarcode();

  const CREW_ROLES = getCREW_ROLES(t);
  const getRoleInfo = (key) => CREW_ROLES.find(r => r.key === key) || { emoji: '❓', label: key, desc: '' };

  const formatDate = (date) => {
    if (!date) return '—';
    const locale = i18n.language === 'en' ? 'en-US' : 'ru-RU';
    return new Date(date).toLocaleString(locale, {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

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
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [completionData, setCompletionData] = useState(null); // { crewData, roomSquareMeters, roomName, strain }
  const [scanFlash, setScanFlash] = useState(false);
  const [duplicateError, setDuplicateError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);
  const [showDebug, setShowDebug] = useState(false);
  const undoTimerRef = useRef(null);
  const undoCountdownRef = useRef(null);
  const autoRecordRef = useRef(false);

  // ── Crew state ──
  const [myRole, setMyRole] = useState(null);
  const [crew, setCrew] = useState([]);
  const [roleLoading, setRoleLoading] = useState(false);
  const [weighingConflict, setWeighingConflict] = useState(null);
  const [piOfflineModal, setPiOfflineModal] = useState(false);
  const [weighingTip, setWeighingTip] = useState(false);
  const prevScaleConnected = useRef(scaleConnected);
  const piGraceTimerRef = useRef(null);

  const safeRooms = Array.isArray(rooms) ? rooms : [];
  const activeRooms = safeRooms.filter(r => r && r.isActive);

  const isWeigher = myRole === 'weighing';

  useEffect(() => {
    loadRooms();
    return () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
      if (undoCountdownRef.current) clearInterval(undoCountdownRef.current);
      if (piGraceTimerRef.current) clearTimeout(piGraceTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (prevScaleConnected.current && !scaleConnected && session && myRole) {
      if (piGraceTimerRef.current) clearTimeout(piGraceTimerRef.current);
      piGraceTimerRef.current = setTimeout(() => {
        piGraceTimerRef.current = null;
        setPiOfflineModal(true);
      }, 6000);
    }
    if (scaleConnected && piGraceTimerRef.current) {
      clearTimeout(piGraceTimerRef.current);
      piGraceTimerRef.current = null;
    }
    prevScaleConnected.current = scaleConnected;
  }, [scaleConnected, session, myRole]);

  useEffect(() => {
    const unsub = onScaleEvent((event, data) => {
      if (event === 'crew_update' && session && data.sessionId === session._id) {
        setCrew(data.crew || []);
        const me = (data.crew || []).find(c => {
          const uid = c.user?._id || c.user;
          return uid === user?._id || uid === user?.id;
        });
        if (me) {
          setMyRole(me.role);
        }
      }
    });
    return unsub;
  }, [session?._id, user?._id, user?.id]);

  const loadRooms = async () => {
    try {
      setLoading(true);
      setError('');
      const data = await roomService.getRooms();
      const list = Array.isArray(data) ? data : [];
      setRooms(list);
    } catch (err) {
      setError(t('harvest.loadError'));
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
      const sessionCrew = (s.crew || []).filter(c => !c.leftAt);
      setCrew(sessionCrew);
      const userId = user?._id || user?.id;
      const me = sessionCrew.find(c => {
        const uid = c.user?._id || c.user;
        return uid === userId;
      });
      if (me) {
        setMyRole(me.role);
      } else {
        setMyRole(null);
      }
    } catch (err) {
      const msg = err.response?.data?.message || err.message || t('harvest.sessionError');
      setError(msg);
      setSession(null);
      console.error('Harvest session error:', err.response?.data || err);
    } finally {
      setSessionLoading(false);
    }
  }, [user, t]);

  const handleSelectRoom = (roomId) => {
    setSelectedRoomId(roomId);
    setSession(null);
    setError('');
    setCompletionData(null);
    setMyRole(null);
    setCrew([]);
    loadOrCreateSession(roomId);
  };

  const handleBackToRooms = () => {
    if (session && myRole) {
      harvestService.leaveSession(session._id).catch(() => {});
    }
    setSelectedRoomId('');
    setSession(null);
    setError('');
    setManualWeight('');
    setPlantNumber('');
    setMyRole(null);
    setCrew([]);
  };

  const handleJoinRole = async (roleKey) => {
    if (!session) return;
    try {
      setRoleLoading(true);
      setError('');
      setWeighingConflict(null);
      const res = await harvestService.joinSession(session._id, roleKey);
      setCrew(res.crew || []);
      setMyRole(roleKey);
      if (roleKey === 'weighing') {
        setWeighingTip(true);
      }
    } catch (err) {
      if (err.response?.status === 409) {
        setWeighingConflict({
          currentWeigher: err.response.data.currentWeigher
        });
      } else {
        setError(err.response?.data?.message || t('harvest.roleChangeError'));
      }
    } finally {
      setRoleLoading(false);
    }
  };

  const handleForceJoinWeighing = async () => {
    if (!session) return;
    try {
      setRoleLoading(true);
      setError('');
      setWeighingConflict(null);
      const res = await harvestService.forceJoinSession(session._id, 'weighing');
      setCrew(res.crew || []);
      setMyRole('weighing');
      setWeighingTip(true);
    } catch (err) {
      setError(err.response?.data?.message || t('harvest.forceRoleError'));
    } finally {
      setRoleLoading(false);
    }
  };

  const handleChangeRole = async () => {
    if (!session) return;
    try {
      await harvestService.leaveSession(session._id);
      setMyRole(null);
    } catch (err) {
      console.error('Leave session error:', err);
    }
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

  // Barcode scan handling — only for weighing role
  useEffect(() => {
    if (!lastBarcode || !scanTime || !session || session.status !== 'in_progress') return;
    if (!isWeigher) return;

    const num = parseInt(lastBarcode, 10);
    if (isNaN(num) || num <= 0) return;

    const harvestedPlants = new Set((session.plants || []).map(p => p.plantNumber));

    if (harvestedPlants.has(num)) {
      setDuplicateError({ plantNumber: num });
      return;
    }

    setPlantNumber(String(num));
    setError('');

    let shouldAutoRecord = false;
    if (barcodeBuffered && barcodeWeight != null && barcodeWeight > 0) {
      setManualWeight(String(Math.round(barcodeWeight)));
      shouldAutoRecord = true;
    } else if (scaleConnected && scaleWeight != null && scaleWeight > 0) {
      shouldAutoRecord = true;
    }

    setScanFlash(true);
    setTimeout(() => setScanFlash(false), 1500);

    // Auto-record directly — don't rely on plantNumber state change
    // (if scanned number equals current plantNumber, React won't re-render)
    if (shouldAutoRecord) {
      setTimeout(() => handleRecordPlant(null, String(num)), 0);
    }
  }, [scanTime]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRecordPlant = async (e, overridePlantNumber) => {
    if (e && e.preventDefault) e.preventDefault();
    if (duplicateError) return;
    if (!isWeigher) return;
    const num = (overridePlantNumber || plantNumber).toString().trim();
    const weight = manualWeight
      ? parseInt(manualWeight, 10)
      : (scaleConnected && scaleWeight != null ? scaleWeight : NaN);
    if (!session || !num || isNaN(weight) || weight <= 0) return;
    if (session.status !== 'in_progress') return;

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
      setPlantNumber(String(parseInt(num, 10) + 1));
      setManualWeight('');
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
      setError(err.response?.data?.message || t('harvest.recordError'));
      console.error(err);
    } finally {
      setRecordLoading(false);
    }
  };

  const handleUndoPlant = async () => {
    if (!successMsg) return;
    const { sessionId, plantNumber: num } = successMsg;
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    if (undoCountdownRef.current) clearInterval(undoCountdownRef.current);
    setSuccessMsg(null);
    try {
      const updated = await harvestService.removePlant(sessionId, num);
      setSession(updated);
    } catch (err) {
      setError(err.response?.data?.message || t('harvest.undoError'));
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
      setError(err.response?.data?.message || t('harvest.errorNoteError'));
      console.error(err);
    } finally {
      setErrorNoteSaving(false);
    }
  };

  const handleCompleteSession = () => {
    if (!session) return;
    setShowCompleteModal(true);
  };

  const handleConfirmComplete = async (data) => {
    if (!session) return;
    try {
      setSessionLoading(true);
      setError('');
      const result = await harvestService.completeSession(session._id, data);
      const roomNameStr = localizeRoomName(selectedRoom?.name, t) || localizeRoomName(session.roomName, t) || '';
      const strainStr = selectedRoom?.flowerStrains?.length > 0
        ? selectedRoom.flowerStrains.map(fs => fs.strain).filter(Boolean).join(', ')
        : session.strain || '';
      setShowCompleteModal(false);
      setSession(null);
      setMyRole(null);
      setCrew([]);

      if (result?.crewData?.members?.length > 0) {
        setCompletionData({
          crewData: result.crewData,
          roomSquareMeters: result.roomSquareMeters,
          roomName: roomNameStr,
          strain: strainStr
        });
      } else {
        setSelectedRoomId('');
      }

      await loadRooms();
    } catch (err) {
      setError(err.response?.data?.message || t('harvest.completionError'));
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

  // ── Infographic mode after completion ──
  if (completionData) {
    return (
      <div>
        <CrewInfographic
          crewData={completionData.crewData}
          roomSquareMeters={completionData.roomSquareMeters}
          roomName={completionData.roomName}
          strain={completionData.strain}
          onClose={() => {
            setCompletionData(null);
            setSelectedRoomId('');
          }}
        />
      </div>
    );
  }

  // ── Room selection mode ──
  if (!selectedRoomId && !sessionLoading) {
    return (
      <div>
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">{t('harvest.title')}</h1>
          <p className="text-dark-400 mt-1">{t('harvest.selectRoom')}</p>
        </div>

        {error && (
          <div className="bg-red-900/30 border border-red-800 text-red-400 px-4 py-3 rounded-lg mb-6">
            {error}
          </div>
        )}

        {activeRooms.length === 0 ? (
          <div className="bg-amber-900/20 border border-amber-700 text-amber-400 px-4 py-3 rounded-lg">
            {t('harvest.noActiveRooms')}
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
                      {localizeRoomName(r.name, t)}
                    </span>
                    <svg className="w-5 h-5 text-dark-500 group-hover:text-primary-400 transition shrink-0 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                  <div className="text-sm text-primary-400 truncate mb-2">
                    {r.flowerStrains?.length > 0
                      ? r.flowerStrains.map(fs => fs.strain).filter(Boolean).join(', ') || t('harvest.noStrain')
                      : r.strain || t('harvest.noStrain')}
                  </div>
                  <div className="flex items-center gap-3 text-sm text-dark-400 mb-3">
                    <span>{r.plantsCount || 0} {t('common.plants')}</span>
                    {daysLeft != null && daysLeft >= 0 && (
                      <span className={daysLeft <= 3 ? 'text-red-400' : ''}>
                        {daysLeft === 0 ? t('harvest.harvestToday') : t('harvest.daysToHarvest', { days: daysLeft })}
                      </span>
                    )}
                  </div>
                  <div className="h-2 bg-dark-700 rounded-full overflow-hidden mb-1.5">
                    <div
                      className={`h-full ${progressColor} rounded-full transition-all`}
                      style={{ width: `${Math.min(progress, 100)}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-dark-500">{t('harvest.dayOfTotal', { day, total })}</span>
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

  // ── Role selection mode ──
  const selectedRoom = safeRooms.find(r => r._id === selectedRoomId);

  if (session && session.status === 'in_progress' && !myRole) {
    const crewByRole = {};
    for (const c of crew) {
      const r = c.role;
      if (!crewByRole[r]) crewByRole[r] = [];
      crewByRole[r].push(c);
    }

    return (
      <div>
        <div className="mb-6">
          <button
            type="button"
            onClick={handleBackToRooms}
            className="flex items-center gap-2 text-dark-400 hover:text-primary-400 transition text-sm mb-3"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            {t('harvest.backToRooms')}
          </button>
          <h1 className="text-2xl font-bold text-white">
            {t('harvest.harvestRoom', { name: localizeRoomName(selectedRoom?.name, t) || t('harvest.room') })}
          </h1>
          <p className="text-dark-400 mt-1">{t('harvest.chooseRole')}</p>
        </div>

        {error && (
          <div className="bg-red-900/30 border border-red-800 text-red-400 px-4 py-3 rounded-lg mb-6">
            {error}
          </div>
        )}

        {/* Weighing conflict modal */}
        {weighingConflict && (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-dark-800 border-2 border-amber-600 rounded-2xl p-6 max-w-sm w-full shadow-2xl">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 rounded-full bg-amber-600/20 flex items-center justify-center shrink-0">
                  <span className="text-2xl">⚖️</span>
                </div>
                <div>
                  <h3 className="text-white font-bold text-lg">{t('harvest.roleOccupied')}</h3>
                  <p className="text-amber-400 text-sm mt-1">
                    {t('harvest.weighingLabel')} <span className="font-bold text-white">{weighingConflict.currentWeigher?.name || '—'}</span>
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setWeighingConflict(null)}
                  className="flex-1 px-4 py-3 bg-dark-700 hover:bg-dark-600 text-dark-300 hover:text-white rounded-xl font-medium transition"
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={handleForceJoinWeighing}
                  disabled={roleLoading}
                  className="flex-1 px-4 py-3 bg-amber-600 hover:bg-amber-500 text-white rounded-xl font-bold transition disabled:opacity-50"
                >
                  {t('harvest.replace')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Role grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-8">
          {CREW_ROLES.map(role => {
            const roleCrew = crewByRole[role.key] || [];
            const isWeighingTaken = role.key === 'weighing' && roleCrew.length > 0;
            const userId = user?._id || user?.id;
            const isMeInRole = roleCrew.some(c => {
              const uid = c.user?._id || c.user;
              return uid === userId;
            });

            return (
              <button
                key={role.key}
                type="button"
                onClick={() => handleJoinRole(role.key)}
                disabled={roleLoading}
                className={`relative text-left p-4 rounded-xl border-2 transition-all ${
                  isMeInRole
                    ? 'border-primary-500 bg-primary-900/30'
                    : isWeighingTaken
                      ? 'border-amber-700/50 bg-dark-800 hover:border-amber-500/70'
                      : 'border-dark-600 bg-dark-800 hover:border-primary-600/50 hover:bg-dark-750'
                } disabled:opacity-50`}
              >
                <div className="text-3xl mb-2">{role.emoji}</div>
                <div className="text-white font-bold text-sm mb-1">{role.label}</div>
                <div className="text-dark-400 text-xs leading-tight">{role.desc}</div>
                {roleCrew.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-dark-700">
                    {roleCrew.map(c => (
                      <div key={c.user?._id || c.user} className="text-xs text-dark-300 truncate">
                        {c.user?.name || '—'}
                      </div>
                    ))}
                  </div>
                )}
                {role.max === 1 && (
                  <div className="absolute top-2 right-2 text-[10px] text-dark-500 bg-dark-700 px-1.5 py-0.5 rounded">
                    {t('harvest.max1')}
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Current team */}
        {crew.length > 0 && (
          <div className="bg-dark-800 rounded-xl p-4 border border-dark-700">
            <h3 className="text-sm font-semibold text-white mb-3">{t('harvest.teamOnHarvest')}</h3>
            <div className="flex flex-wrap gap-2">
              {crew.map(c => {
                const ri = getRoleInfo(c.role);
                return (
                  <div
                    key={c.user?._id || c.user}
                    className="flex items-center gap-1.5 bg-dark-700 rounded-full px-3 py-1.5"
                  >
                    <span className="text-sm">{ri.emoji}</span>
                    <span className="text-xs text-white font-medium">{c.user?.name || '—'}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Harvest session mode (role selected) ──
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

  const sessionPlants = session?.plants || [];
  const harvestedPlants = new Set(sessionPlants.map(p => p.plantNumber));
  const harvestedWeights = new Map(sessionPlants.map(p => [p.plantNumber, p.wetWeight]));
  const hasRoomMap = selectedRoom?.roomLayout?.customRows?.length > 0 &&
    selectedRoom?.roomLayout?.plantPositions?.length > 0;

  const myRoleInfo = getRoleInfo(myRole);

  return (
    <div>
      {/* Header with back button */}
      <div className="mb-6">
        <button
          type="button"
          onClick={handleBackToRooms}
          className="flex items-center gap-2 text-dark-400 hover:text-primary-400 transition text-sm mb-3"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          {t('harvest.backToRooms')}
        </button>
        <h1 className="text-2xl font-bold text-white">
          {t('harvest.harvestRoom', { name: localizeRoomName(selectedRoom?.name, t) || t('harvest.room') })}
        </h1>
        {isWeigher ? (
          <p className="text-dark-400 mt-1">{t('harvest.scanOrEnter')}</p>
        ) : (
          <p className="text-dark-400 mt-1">{t('harvest.watchProgress')}</p>
        )}
      </div>

      {/* Role badge + team */}
      {myRole && (
        <div className="bg-dark-800 rounded-xl border border-dark-700 mb-6 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-dark-700/50">
            <div className="flex items-center gap-3">
              <span className="text-2xl">{myRoleInfo.emoji}</span>
              <div>
                <div className="text-white font-bold text-sm">{t('harvest.yourRole', { role: myRoleInfo.label })}</div>
                {isWeigher && (
                  <div className="text-green-400 text-xs">{t('harvest.recordFromYou')}</div>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={handleChangeRole}
              className="px-3 py-1.5 bg-dark-700 hover:bg-dark-600 text-dark-400 hover:text-white border border-dark-600 rounded-lg text-xs font-medium transition shrink-0"
            >
              {t('harvest.changeRole')}
            </button>
          </div>

          {crew.length > 0 && (
            <div className="px-4 py-3">
              <div className="text-xs text-dark-500 uppercase tracking-wider mb-2">
                {t('harvest.teamCount', { count: crew.length })}
              </div>
              <div className="flex flex-wrap gap-2">
                {crew.map(c => {
                  const ri = getRoleInfo(c.role);
                  const userId = user?._id || user?.id;
                  const isMe = (c.user?._id || c.user) === userId;
                  return (
                    <div
                      key={c.user?._id || c.user}
                      className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 ${
                        isMe
                          ? 'bg-primary-900/40 border border-primary-700/50'
                          : 'bg-dark-700'
                      }`}
                    >
                      <span className="text-sm">{ri.emoji}</span>
                      <span className={`text-xs font-medium ${isMe ? 'text-primary-300' : 'text-white'}`}>
                        {c.user?.name || '—'}
                      </span>
                      <span className="text-[10px] text-dark-500">
                        {ri.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="bg-red-900/30 border border-red-800 text-red-400 px-4 py-3 rounded-lg mb-6">
          {error}
        </div>
      )}

      {/* Pi offline modal */}
      {piOfflineModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-dark-800 border-2 border-amber-600 rounded-2xl p-6 max-w-sm w-full shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-full bg-amber-600/20 flex items-center justify-center shrink-0">
                <svg className="w-7 h-7 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636a9 9 0 010 12.728M5.636 18.364a9 9 0 010-12.728M15.536 8.464a5 5 0 010 7.072M8.464 15.536a5 5 0 010-7.072" />
                </svg>
              </div>
              <div>
                <h3 className="text-white font-bold text-lg">{t('harvest.offlineMode')}</h3>
                <p className="text-amber-400 text-sm mt-1">{t('harvest.piLostConnection')}</p>
              </div>
            </div>
            <p className="text-dark-300 text-sm mb-5">
              {t('harvest.offlineNote')}
            </p>
            <button
              onClick={() => setPiOfflineModal(false)}
              className="w-full bg-amber-600 hover:bg-amber-700 text-white font-medium py-3 px-4 rounded-xl transition-colors"
            >
              {t('harvest.understood')}
            </button>
          </div>
        </div>
      )}

      {/* Weighing tip modal */}
      {weighingTip && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-dark-800 border-2 border-primary-600 rounded-2xl p-6 max-w-sm w-full shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-full bg-primary-600/20 flex items-center justify-center shrink-0">
                <span className="text-2xl">⚖️</span>
              </div>
              <div>
                <h3 className="text-white font-bold text-lg">{t('harvest.youOnScale')}</h3>
                <p className="text-primary-400 text-sm mt-1">{t('harvest.reminderBefore')}</p>
              </div>
            </div>
            <div className="space-y-3 mb-5">
              <div className="flex items-start gap-3 bg-dark-700 rounded-lg p-3">
                <span className="text-lg shrink-0 mt-0.5">🔄</span>
                <div>
                  <div className="text-white text-sm font-medium">{t('harvest.tareScale')}</div>
                  <div className="text-dark-400 text-xs">{t('harvest.tareScaleDesc')}</div>
                </div>
              </div>
              <div className="flex items-start gap-3 bg-dark-700 rounded-lg p-3">
                <span className="text-lg shrink-0 mt-0.5">⏱️</span>
                <div>
                  <div className="text-white text-sm font-medium">{t('harvest.undoTime')}</div>
                  <div className="text-dark-400 text-xs">{t('harvest.undoTimeDesc')}</div>
                </div>
              </div>
              <div className="flex items-start gap-3 bg-red-900/30 border border-red-800/50 rounded-lg p-3">
                <span className="text-lg shrink-0 mt-0.5">💀</span>
                <div>
                  <div className="text-red-400 text-sm font-medium">{t('harvest.dontSkip')}</div>
                  <div className="text-dark-400 text-xs">{t('harvest.dontSkipDesc')}</div>
                </div>
              </div>
            </div>
            <button
              onClick={() => setWeighingTip(false)}
              className="w-full bg-primary-600 hover:bg-primary-500 text-white font-bold py-3 px-4 rounded-xl transition-colors"
            >
              {t('harvest.letsGo')}
            </button>
          </div>
        </div>
      )}

      {/* Pi syncing buffered data */}
      {syncing && (
        <div className="bg-blue-900/30 border border-blue-700 text-blue-400 px-4 py-3 rounded-lg mb-6 flex items-center gap-3">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-400 shrink-0" />
          <span className="font-medium">{t('harvest.syncing', { count: syncCount })}</span>
        </div>
      )}

      {/* Pi offline banner (after modal closed) */}
      {!scaleConnected && socketConnected && !piOfflineModal && session && myRole && (
        <div className="bg-amber-900/30 border border-amber-700 text-amber-400 px-4 py-3 rounded-lg mb-6 flex items-center gap-3">
          <div className="w-3 h-3 rounded-full bg-amber-500 animate-pulse shrink-0" />
          <span className="font-medium text-sm">{t('harvest.offlineBanner')}{bufferedBarcodes > 0 ? ` ${t('harvest.offlineScans', { count: bufferedBarcodes })}` : ''}</span>
        </div>
      )}

      {/* Duplicate error modal */}
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
                <h3 className="text-white font-bold text-lg">{t('harvest.plantAlreadyRecorded')}</h3>
                <p className="text-red-400 text-sm mt-1">{t('harvest.plantInSession', { num: duplicateError.plantNumber })}</p>
              </div>
            </div>
            <button
              onClick={() => { setDuplicateError(null); setPlantNumber(''); }}
              className="w-full px-4 py-3 bg-red-600 hover:bg-red-500 text-white rounded-xl font-bold text-lg transition"
            >
              {t('harvest.ok')}
            </button>
          </div>
        </div>
      )}

      {/* Success notification */}
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
                <h3 className="text-white font-bold text-lg">{t('harvest.plantRecorded')}</h3>
                <p className="text-green-400 text-sm mt-1">
                  {t('harvest.plantWeight', { num: successMsg.plantNumber, weight: successMsg.weight })}
                </p>
              </div>
            </div>
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
              {t('harvest.undo', { sec: successMsg.countdown || 0 })}
            </button>
          </div>
        </div>
      )}

      {/* Debug panel */}
      {showDebug && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-dark-800 border border-dark-600 rounded-2xl p-6 max-w-md w-full shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-white font-bold text-lg">{t('harvest.diagnostics')}</h3>
              <button onClick={() => setShowDebug(false)} className="text-dark-400 hover:text-white p-1">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between py-2 px-3 bg-dark-700 rounded-lg">
                <span className="text-dark-300 text-sm">{t('harvest.serverWS')}</span>
                <span className={`flex items-center gap-2 text-sm font-medium ${socketConnected ? 'text-green-400' : 'text-red-400'}`}>
                  <span className={`w-2 h-2 rounded-full ${socketConnected ? 'bg-green-400' : 'bg-red-400'}`} />
                  {socketConnected ? t('harvest.connected') : t('harvest.disconnected')}
                </span>
              </div>
              <div className="flex items-center justify-between py-2 px-3 bg-dark-700 rounded-lg">
                <span className="text-dark-300 text-sm">{t('harvest.raspberryPi')}</span>
                <span className={`flex items-center gap-2 text-sm font-medium ${scaleDebug ? 'text-green-400' : 'text-red-400'}`}>
                  <span className={`w-2 h-2 rounded-full ${scaleDebug ? 'bg-green-400' : 'bg-red-400'}`} />
                  {scaleDebug ? t('harvest.online') : t('harvest.noDataPi')}
                </span>
              </div>
              <div className="flex items-center justify-between py-2 px-3 bg-dark-700 rounded-lg">
                <span className="text-dark-300 text-sm">{t('harvest.scaleUSB')}</span>
                <span className={`flex items-center gap-2 text-sm font-medium ${scaleConnected ? 'text-green-400' : 'text-red-400'}`}>
                  <span className={`w-2 h-2 rounded-full ${scaleConnected ? 'bg-green-400' : 'bg-red-400'}`} />
                  {scaleConnected ? t('harvest.scaleConnected') : t('harvest.scaleDisconnected')}
                </span>
              </div>
              <div className="flex items-center justify-between py-2 px-3 bg-dark-700 rounded-lg">
                <span className="text-dark-300 text-sm">{t('harvest.barcodeScanner')}</span>
                <span className={`flex items-center gap-2 text-sm font-medium ${scaleDebug?.barcodeConnected ? 'text-green-400' : 'text-red-400'}`}>
                  <span className={`w-2 h-2 rounded-full ${scaleDebug?.barcodeConnected ? 'bg-green-400' : 'bg-red-400'}`} />
                  {scaleDebug?.barcodeConnected ? t('harvest.connected') : t('harvest.disconnected')}
                </span>
              </div>

              {scaleDebug && (
                <div className="mt-3 pt-3 border-t border-dark-600 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-dark-400">{t('harvest.scalePort')}</span>
                    <span className="text-dark-200 font-mono">{scaleDebug.serialPort || '—'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-dark-400">{t('harvest.piUptime')}</span>
                    <span className="text-dark-200 font-mono">
                      {scaleDebug.uptime != null
                        ? scaleDebug.uptime >= 3600
                          ? `${Math.floor(scaleDebug.uptime / 3600)}h ${Math.floor((scaleDebug.uptime % 3600) / 60)}m`
                          : scaleDebug.uptime >= 60
                            ? `${Math.floor(scaleDebug.uptime / 60)}m ${scaleDebug.uptime % 60}s`
                            : `${scaleDebug.uptime}s`
                        : '—'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-dark-400">{t('harvest.lastWeight')}</span>
                    <span className="text-dark-200 font-mono">{scaleDebug.lastWeight ?? '—'} {t('common.grams')}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-dark-400">{t('harvest.readErrors')}</span>
                    <span className={`font-mono ${scaleDebug.errorCount > 0 ? 'text-amber-400' : 'text-dark-200'}`}>
                      {scaleDebug.errorCount ?? 0}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-dark-400">{t('harvest.piTime')}</span>
                    <span className="text-dark-200 font-mono text-xs">
                      {scaleDebug.piTime ? new Date(scaleDebug.piTime).toLocaleTimeString(i18n.language === 'en' ? 'en-US' : 'ru-RU') : '—'}
                    </span>
                  </div>
                </div>
              )}

              {!scaleDebug && socketConnected && (
                <p className="text-dark-500 text-xs text-center mt-2">
                  {t('harvest.piNoDiag')}
                </p>
              )}
            </div>

            <button
              onClick={() => setShowDebug(false)}
              className="w-full mt-5 px-4 py-2.5 bg-dark-700 hover:bg-dark-600 text-dark-300 hover:text-white border border-dark-600 rounded-xl font-medium transition"
            >
              {t('common.close')}
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
          {/* Room and session info */}
          <div className="bg-dark-800 rounded-xl p-6 border border-dark-700 mb-6">
            <h2 className="text-lg font-semibold text-white mb-4">{t('harvest.roomAndSession')}</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              {session.cycleName && (
                <div>
                  <div className="text-dark-400">{t('harvest.cycleLabel')}</div>
                  <div className="text-white font-medium">{session.cycleName}</div>
                </div>
              )}
              <div>
                <div className="text-dark-400">{t('harvest.roomLabel')}</div>
                <div className="text-white font-medium">{localizeRoomName(session.roomName, t)}</div>
              </div>
              <div>
                <div className="text-dark-400">{t('harvest.strainLabel')}</div>
                <div className="text-white font-medium">
                  {selectedRoom?.flowerStrains?.length > 0
                    ? selectedRoom.flowerStrains.map(fs => fs.strain).filter(Boolean).join(', ') || '—'
                    : session.strain || '—'}
                </div>
              </div>
              <div>
                <div className="text-dark-400">{t('harvest.expectedPlants')}</div>
                <div className="text-white font-medium">{session.plantsCount}</div>
              </div>
              <div>
                <div className="text-dark-400">{t('harvest.harvestStarted')}</div>
                <div className="text-white font-medium">{formatDate(session.startedAt)}</div>
              </div>
            </div>
          </div>

          {/* Scale and plant recording — ONLY for weighing */}
          {isWeigher && (
            <div className="bg-dark-800 rounded-xl p-6 border border-dark-700 mb-6">
              <h2 className="text-lg font-semibold text-white mb-4">{t('harvest.recordPlant')}</h2>

              {/* Live scale display */}
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
                      {scaleWeight != null ? `${scaleWeight} ${t('common.grams')}` : `--- ${t('common.grams')}`}
                    </div>
                    {scaleStable && (
                      <span className="text-xs bg-green-600/20 text-green-400 px-2 py-0.5 rounded">
                        {t('harvest.stable')}
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="text-dark-400 text-sm flex-1">
                    {socketConnected ? t('harvest.scaleNotConnected') : t('harvest.connectingServer')}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setShowDebug(true)}
                  className="p-2 text-dark-400 hover:text-white hover:bg-dark-600 rounded-lg transition shrink-0"
                  title={t('harvest.diagnostics')}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </button>
              </div>

              <div className="flex flex-wrap items-end gap-4">
                <div>
                  <label className="block text-sm text-dark-400 mb-1">{t('harvest.plantNumber')}</label>
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
                  <label className="block text-sm text-dark-400 mb-1">{t('harvest.weightG')}</label>
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
                    {t('harvest.takeFromScale', { weight: scaleWeight })}
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleRecordPlant}
                  disabled={!canDoHarvest || !plantNumber.trim() || (!manualWeight && !(scaleConnected && scaleWeight > 0)) || recordLoading}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-500 disabled:opacity-50 font-medium"
                >
                  {recordLoading ? '...' : t('harvest.record')}
                </button>
              </div>
              {scaleConnected && !manualWeight && (
                <p className="text-xs text-dark-500 mt-2">
                  {t('harvest.autoWeightNote')}
                </p>
              )}
            </div>
          )}

          {/* For non-weighing roles */}
          {!isWeigher && (
            <div className="bg-dark-800/50 rounded-xl p-4 border border-dark-700/50 mb-6">
              <div className="flex items-center gap-3">
                <span className="text-2xl">{myRoleInfo.emoji}</span>
                <div>
                  <p className="text-dark-300 text-sm">
                    {t('harvest.roleWeighingOnly', { role: myRoleInfo.label })}
                  </p>
                  <p className="text-dark-500 text-xs mt-1">{t('harvest.canWatchProgress')}</p>
                </div>
              </div>
            </div>
          )}

          {/* Room map */}
          {hasRoomMap ? (
            <div className="bg-dark-800 rounded-xl p-6 border border-dark-700 mb-6">
              <h2 className="text-lg font-semibold text-white mb-4">{t('harvest.roomMapTitle')}</h2>
              <HarvestRoomMap
                room={selectedRoom}
                harvestedPlants={harvestedPlants}
                harvestedWeights={harvestedWeights}
                onPlantClick={(plantNumber) => {
                  if (isWeigher && !harvestedPlants.has(plantNumber)) {
                    setPlantNumber(String(plantNumber));
                  }
                }}
              />
            </div>
          ) : selectedRoom && (
            <div className="bg-dark-800/50 rounded-xl p-4 border border-dark-700/50 mb-6">
              <p className="text-dark-500 text-sm">
                {t('harvest.noRoomMap')}{' '}
                <span className="text-dark-400">{t('harvest.setupRoomMap')}</span>
              </p>
            </div>
          )}

          {/* Stats cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-dark-800 rounded-xl p-4 border border-dark-700">
              <div className="text-2xl font-bold text-white">{recorded} / {expected}</div>
              <div className="text-xs text-dark-400">{t('harvest.plantsRecorded')}</div>
            </div>
            <div className="bg-dark-800 rounded-xl p-4 border border-dark-700">
              <div className="text-2xl font-bold text-green-400">{totalWet} {t('common.grams')}</div>
              <div className="text-xs text-dark-400">{t('harvest.totalWetWeight')}</div>
            </div>
            <div className="bg-dark-800 rounded-xl p-4 border border-dark-700">
              <div className="text-2xl font-bold text-primary-400">{progressPct}%</div>
              <div className="text-xs text-dark-400">{t('harvest.harvestProgress')}</div>
            </div>
            <div className="bg-dark-800 rounded-xl p-4 border border-dark-700">
              <div className="text-2xl font-bold text-yellow-400">{avgWeight} {t('common.grams')}</div>
              <div className="text-xs text-dark-400">{t('harvest.avgPlantWeight')}</div>
            </div>
          </div>

          {/* Progress bar */}
          <div className="mb-6">
            <div className="flex justify-between text-sm text-dark-400 mb-1">
              <span>{t('common.progress')}</span>
              <span>{t('harvest.ofPlants', { recorded, expected })}</span>
            </div>
            <div className="h-3 bg-dark-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary-500 transition-all duration-500"
                style={{ width: `${Math.min(progressPct, 100)}%` }}
              />
            </div>
          </div>

          {/* Record log */}
          <div className="bg-dark-800 rounded-xl p-6 border border-dark-700 mb-6">
            <h2 className="text-lg font-semibold text-white mb-4">{t('harvest.logTitle')}</h2>
            {session.plants?.length === 0 ? (
              <p className="text-dark-400 text-sm">{t('harvest.noRecordsYet')}</p>
            ) : (
              <div className="overflow-x-auto max-h-48 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-dark-400 border-b border-dark-600">
                      <th className="pb-2 pr-3">{t('harvest.timeCol')}</th>
                      <th className="pb-2 pr-3">{t('harvest.recorderCol')}</th>
                      <th className="pb-2 pr-3">{t('harvest.plantNumCol')}</th>
                      <th className="pb-2 pr-3">{t('harvest.strainCol')}</th>
                      <th className="pb-2 pr-3">{t('harvest.weightCol')}</th>
                      <th className="pb-2">{t('harvest.errorNoteCol')}</th>
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
                                  placeholder={t('harvest.errorNotePlaceholder')}
                                  className="flex-1 min-w-0 px-2 py-1 bg-dark-600 border border-dark-500 rounded text-white text-xs"
                                />
                                <button
                                  type="button"
                                  onClick={() => handleSaveErrorNote(p.plantNumber)}
                                  disabled={errorNoteSaving}
                                  className="text-primary-400 hover:text-primary-300 text-xs whitespace-nowrap"
                                >
                                  {t('common.save')}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setErrorNoteEdit({ plantNumber: null, value: '' })}
                                  className="text-dark-400 hover:text-white text-xs"
                                >
                                  {t('common.cancel')}
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2">
                                {p.errorNote ? (
                                  <span className="text-amber-400 text-xs">{p.errorNote}</span>
                                ) : (
                                  <span className="text-dark-500 text-xs">—</span>
                                )}
                                {isWeigher && (
                                  <button
                                    type="button"
                                    onClick={() => setErrorNoteEdit({
                                      plantNumber: p.plantNumber,
                                      value: p.errorNote || ''
                                    })}
                                    className="text-primary-400 hover:text-primary-300 text-xs"
                                  >
                                    {p.errorNote ? t('harvest.changeMark') : t('harvest.addMark')}
                                  </button>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-xs text-dark-500 mt-2">{t('harvest.dataCannotDelete')}</p>
          </div>

          {/* Progress by strains and rows + analytics */}
          <div className="grid lg:grid-cols-2 gap-6 mb-6">
            {/* Progress by strains and rows */}
            <div className="bg-dark-800 rounded-xl p-6 border border-dark-700">
              <h2 className="text-lg font-semibold text-white mb-4">{t('harvest.byStrainAndRow')}</h2>
              {session.plants?.length === 0 ? (
                <p className="text-dark-400 text-sm">{t('harvest.noRecordsYet')}</p>
              ) : (() => {
                const plants = session.plants || [];

                const positions = selectedRoom?.roomLayout?.plantPositions || [];
                const customRows = selectedRoom?.roomLayout?.customRows || [];
                const plantToRow = {};
                for (const pos of positions) {
                  plantToRow[pos.plantNumber] = pos.row;
                }
                const rowExpected = {};
                for (const pos of positions) {
                  const rowName = customRows[pos.row]?.name || `${t('roomMap.row')} ${pos.row + 1}`;
                  if (!rowExpected[rowName]) rowExpected[rowName] = 0;
                  rowExpected[rowName]++;
                }
                const rowStats = {};
                for (const p of plants) {
                  const rowIdx = plantToRow[p.plantNumber];
                  if (rowIdx != null) {
                    const rowName = customRows[rowIdx]?.name || `${t('roomMap.row')} ${rowIdx + 1}`;
                    if (!rowStats[rowName]) rowStats[rowName] = { count: 0, total: 0 };
                    rowStats[rowName].count++;
                    rowStats[rowName].total += p.wetWeight;
                  }
                }
                const allRowNames = [...new Set([...Object.keys(rowExpected), ...Object.keys(rowStats)])];
                const rowEntries = allRowNames.map(name => ({
                  name,
                  count: rowStats[name]?.count || 0,
                  total: rowStats[name]?.total || 0,
                  expected: rowExpected[name] || 0
                })).sort((a, b) => {
                  const numA = parseInt(a.name.replace(/\D/g, '')) || 0;
                  const numB = parseInt(b.name.replace(/\D/g, '')) || 0;
                  return numA - numB;
                });

                const strainExpected = {};
                if (selectedRoom?.flowerStrains?.length > 0) {
                  for (const pos of positions) {
                    const strainIdx = pos.strainIndex ?? 0;
                    const strainName = selectedRoom.flowerStrains[strainIdx]?.strain || '—';
                    if (!strainExpected[strainName]) strainExpected[strainName] = 0;
                    strainExpected[strainName]++;
                  }
                }

                const ROW_COLORS = ['bg-blue-500', 'bg-emerald-500', 'bg-violet-500', 'bg-orange-500', 'bg-pink-500', 'bg-cyan-500', 'bg-lime-500', 'bg-rose-500'];

                return (
                  <div className="space-y-5">
                    {strainStats.length > 0 && (
                      <div>
                        <div className="text-xs text-dark-500 uppercase tracking-wider mb-3">{t('harvest.byStrains')}</div>
                        <div className="space-y-3">
                          {strainStats.map(st => {
                            const exp = strainExpected[st.strain] || expected;
                            const pct = exp > 0 ? Math.round((st.count / exp) * 100) : 0;
                            const weightPct = totalWet > 0 ? Math.round((st.totalWet / totalWet) * 100) : 0;
                            const colorClass = strainColorMap[st.strain] || 'bg-primary-500';
                            return (
                              <div key={st.strain}>
                                <div className="flex justify-between text-sm mb-1.5">
                                  <span className="text-white font-medium flex items-center gap-1.5">
                                    <span className={`inline-block w-2.5 h-2.5 rounded-sm ${colorClass}`} />
                                    {st.strain}
                                  </span>
                                  <span className="text-dark-300">
                                    <span className="text-white font-bold">{st.count}</span>
                                    {strainExpected[st.strain] ? <span>/{strainExpected[st.strain]}</span> : null}
                                    <span className="text-dark-500 ml-1">·</span>
                                    <span className="text-green-400 font-bold ml-1">{st.totalWet} {t('common.grams')}</span>
                                    <span className="text-dark-500 ml-1">· {Math.round(st.totalWet / st.count)} {t('harvest.perPlant')}</span>
                                  </span>
                                </div>
                                <div className="flex gap-1.5">
                                  <div className="flex-1 h-2.5 bg-dark-700 rounded-full overflow-hidden" title={`${pct}%`}>
                                    <div
                                      className={`h-full ${colorClass} rounded-full transition-all duration-500`}
                                      style={{ width: `${Math.min(pct, 100)}%` }}
                                    />
                                  </div>
                                  <span className="text-xs text-dark-400 w-10 text-right shrink-0">{pct}%</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {rowEntries.length > 0 && (
                      <div>
                        <div className="text-xs text-dark-500 uppercase tracking-wider mb-3">{t('harvest.byRows')}</div>
                        <div className="space-y-3">
                          {rowEntries.map((row, idx) => {
                            const pct = row.expected > 0 ? Math.round((row.count / row.expected) * 100) : (row.count > 0 ? 100 : 0);
                            const colorClass = ROW_COLORS[idx % ROW_COLORS.length];
                            const isDone = row.expected > 0 && row.count >= row.expected;
                            return (
                              <div key={row.name}>
                                <div className="flex justify-between text-sm mb-1.5">
                                  <span className={`font-medium flex items-center gap-1.5 ${isDone ? 'text-green-400' : 'text-white'}`}>
                                    {isDone && <span>✓</span>}
                                    {row.name}
                                  </span>
                                  <span className="text-dark-300">
                                    <span className="text-white font-bold">{row.count}</span>
                                    {row.expected > 0 && <span>/{row.expected}</span>}
                                    {row.total > 0 && (
                                      <>
                                        <span className="text-dark-500 ml-1">·</span>
                                        <span className="text-green-400 font-bold ml-1">{row.total} {t('common.grams')}</span>
                                        {row.count > 0 && <span className="text-dark-500 ml-1">· {Math.round(row.total / row.count)} {t('harvest.perPlant')}</span>}
                                      </>
                                    )}
                                  </span>
                                </div>
                                <div className="flex gap-1.5">
                                  <div className="flex-1 h-2.5 bg-dark-700 rounded-full overflow-hidden">
                                    <div
                                      className={`h-full ${isDone ? 'bg-green-500' : colorClass} rounded-full transition-all duration-500`}
                                      style={{ width: `${Math.min(pct, 100)}%` }}
                                    />
                                  </div>
                                  <span className="text-xs text-dark-400 w-10 text-right shrink-0">{pct}%</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {strainStats.length === 0 && rowEntries.length === 0 && (
                      <p className="text-dark-500 text-sm">{t('harvest.setupMapForRows')}</p>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* Analytics */}
            <div className="bg-dark-800 rounded-xl p-6 border border-dark-700">
              <h2 className="text-lg font-semibold text-white mb-4">{t('harvest.analytics')}</h2>
              {session.plants?.length === 0 ? (
                <p className="text-dark-400 text-sm">{t('harvest.noAnalytics')}</p>
              ) : (() => {
                const plants = session.plants || [];
                const sorted = [...plants].sort((a, b) => b.wetWeight - a.wetWeight);
                const heaviest = sorted[0];
                const lightest = sorted[sorted.length - 1];
                const median = sorted[Math.floor(sorted.length / 2)];

                return (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between py-1.5 px-3 bg-dark-700 rounded-lg">
                      <span className="text-dark-300 text-sm">{t('harvest.heaviest')}</span>
                      <span className="text-green-400 font-bold text-sm">
                        #{heaviest.plantNumber} — {heaviest.wetWeight} {t('common.grams')}
                        {heaviest.strain && <span className="text-dark-400 font-normal ml-1">({heaviest.strain})</span>}
                      </span>
                    </div>
                    <div className="flex items-center justify-between py-1.5 px-3 bg-dark-700 rounded-lg">
                      <span className="text-dark-300 text-sm">{t('harvest.lightest')}</span>
                      <span className="text-amber-400 font-bold text-sm">
                        #{lightest.plantNumber} — {lightest.wetWeight} {t('common.grams')}
                        {lightest.strain && <span className="text-dark-400 font-normal ml-1">({lightest.strain})</span>}
                      </span>
                    </div>
                    <div className="flex items-center justify-between py-1.5 px-3 bg-dark-700 rounded-lg">
                      <span className="text-dark-300 text-sm">{t('harvest.median')}</span>
                      <span className="text-primary-400 font-bold text-sm">{median.wetWeight} {t('common.grams')}</span>
                    </div>
                    <div className="flex items-center justify-between py-1.5 px-3 bg-dark-700 rounded-lg">
                      <span className="text-dark-300 text-sm">{t('harvest.spread')}</span>
                      <span className="text-dark-200 font-bold text-sm">{lightest.wetWeight} — {heaviest.wetWeight} {t('common.grams')}</span>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>

          <div className="flex justify-end items-center gap-3">
            {!isWeigher && (
              <span className="text-dark-500 text-sm">{t('harvest.onlyWeigherComplete')}</span>
            )}
            <button
              type="button"
              onClick={handleCompleteSession}
              disabled={sessionLoading || !isWeigher || !canDoHarvest}
              className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-500 font-medium disabled:opacity-50"
            >
              {t('harvest.finishHarvest')}
            </button>
          </div>
        </>
      )}

      {/* Complete modal */}
      <HarvestCompleteModal
        isOpen={showCompleteModal}
        onClose={() => setShowCompleteModal(false)}
        onConfirm={handleConfirmComplete}
        loading={sessionLoading}
        crew={crew}
      />

      {session && session.status === 'completed' && (
        <div className="bg-dark-800 rounded-xl p-6 border border-dark-700">
          <p className="text-green-400 font-medium">{t('harvest.sessionCompleted')}</p>
          <p className="text-dark-400 text-sm mt-1">{t('harvest.sessionStats', { count: session.plants?.length ?? 0, weight: totalWet })}</p>
          <button
            type="button"
            onClick={handleBackToRooms}
            className="mt-3 px-4 py-2 bg-dark-700 hover:bg-dark-600 text-primary-400 rounded-lg text-sm font-medium transition"
          >
            ← {t('harvest.backToRooms')}
          </button>
        </div>
      )}
    </div>
  );
};

export default Harvest;
