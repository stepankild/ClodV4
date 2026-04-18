import { useState, useEffect, useMemo } from 'react';
import api from '../../services/api';

/**
 * Timelapse browser for a zone.
 * Photos are served directly from Cloudflare R2 (CDN) — no proxy through server.
 * Server returns list of days + pre-built URLs: { thumb, medium, full }.
 *
 * Module-level cache per zone so repeat visits render instantly; server cache
 * is still consulted via a soft refresh (60s staleness).
 */
const _photosCache = new Map(); // zone -> { at: ms, days: [...] }
const PHOTOS_TTL_MS = 60 * 1000;

export default function TimelapsePanel({ zone = 'vega', title = 'Таймлапс' }) {
  const cached = _photosCache.get(zone);
  const [days, setDays] = useState(cached?.days || []);
  // Only show "loading" spinner when we have nothing at all
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState(null);
  const [openArchive, setOpenArchive] = useState(false);
  const [openVideo, setOpenVideo] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const c = _photosCache.get(zone);
    // If cache is fresh, skip REST entirely this mount
    if (c && Date.now() - c.at < PHOTOS_TTL_MS) {
      setDays(c.days);
      setLoading(false);
      return;
    }
    const load = async () => {
      if (!c) setLoading(true); // only show spinner if no stale data to show
      setError(null);
      try {
        const { data } = await api.get(`/timelapse/${zone}/photos`);
        if (cancelled) return;
        const nextDays = Array.isArray(data.days) ? data.days : [];
        _photosCache.set(zone, { at: Date.now(), days: nextDays });
        setDays(nextDays);
      } catch (e) {
        if (!cancelled) setError(e?.response?.data?.error || e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [zone]);

  const totalCount = useMemo(() => days.reduce((s, d) => s + (d.count || 0), 0), [days]);
  const latestDay = days[0];
  const latestUrl = latestDay?.urls?.[latestDay.urls.length - 1];
  const latestLabel = latestUrl ? `${latestDay.date} · ${latestUrl.name.replace('-', ':')}` : null;

  return (
    <div className="bg-dark-800 border border-dark-700 rounded-lg p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-dark-100 flex items-center gap-2">
          <span>📷</span> {title}
        </h2>
        <div className="text-xs text-dark-500">
          {totalCount > 0
            ? `${totalCount} снимков · ${days.length} дней${loading ? ' · обновление…' : ''}`
            : loading ? 'загрузка…'
            : error ? `ошибка: ${error}` : 'нет снимков'}
        </div>
      </div>

      {latestLabel && (
        <div className="text-xs text-dark-500 mb-3">
          Последний снимок: <span className="text-dark-300">{latestLabel}</span>
        </div>
      )}

      <div className="flex gap-2">
        <button
          className="flex-1 px-3 py-2 bg-dark-700 hover:bg-dark-600 text-dark-100 rounded-md text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={totalCount === 0}
          onClick={() => setOpenArchive(true)}
        >
          📅 Архив
        </button>
        <button
          className="flex-1 px-3 py-2 bg-primary-700 hover:bg-primary-600 text-white rounded-md text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={totalCount < 5}
          onClick={() => setOpenVideo(true)}
        >
          ▶️ Таймлапс
        </button>
      </div>

      {openArchive && (
        <ArchiveModal days={days} onClose={() => setOpenArchive(false)} />
      )}
      {openVideo && (
        <VideoModal zone={zone} onClose={() => setOpenVideo(false)} />
      )}
    </div>
  );
}

function ArchiveModal({ days, onClose }) {
  const [selectedDate, setSelectedDate] = useState(days[0]?.date);
  const [viewerIndex, setViewerIndex] = useState(null);
  const [viewerLoaded, setViewerLoaded] = useState(false);
  const selected = days.find(d => d.date === selectedDate);

  const urls = selected?.urls || [];

  useEffect(() => {
    setViewerLoaded(false);
  }, [viewerIndex, selectedDate]);

  // Keyboard nav in viewer
  useEffect(() => {
    if (viewerIndex == null) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setViewerIndex(null);
      else if (e.key === 'ArrowLeft' && viewerIndex > 0) setViewerIndex(viewerIndex - 1);
      else if (e.key === 'ArrowRight' && viewerIndex < urls.length - 1) setViewerIndex(viewerIndex + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewerIndex, urls.length]);

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-dark-900 rounded-lg border border-dark-700 max-w-5xl w-full max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-dark-700">
          <h3 className="text-lg font-semibold text-dark-100">📅 Архив снимков</h3>
          <button onClick={onClose} className="text-dark-400 hover:text-dark-200 text-2xl leading-none">×</button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Days list */}
          <div className="w-48 border-r border-dark-700 overflow-y-auto">
            {days.map(d => (
              <button
                key={d.date}
                onClick={() => setSelectedDate(d.date)}
                className={`w-full text-left px-4 py-2 text-sm border-b border-dark-800 transition-colors ${
                  d.date === selectedDate ? 'bg-primary-800 text-white' : 'text-dark-200 hover:bg-dark-800'
                }`}
              >
                <div className="font-medium">{d.date}</div>
                <div className="text-xs opacity-70">{d.count} фото</div>
              </button>
            ))}
          </div>

          {/* Photos grid */}
          <div className="flex-1 overflow-y-auto p-4">
            {urls.length === 0 ? (
              <div className="text-dark-500 text-sm">Нет фото в этот день</div>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                {urls.map((u, i) => (
                  <button
                    key={u.name}
                    onClick={() => setViewerIndex(i)}
                    className="relative aspect-video bg-dark-800 rounded overflow-hidden hover:ring-2 hover:ring-primary-500 transition-all"
                  >
                    <img src={u.thumb} alt={u.name} loading="lazy" decoding="async" className="w-full h-full object-cover" />
                    <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-xs px-1 py-0.5 text-center">
                      {u.name.replace('-', ':')}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Full-size viewer */}
        {viewerIndex != null && urls[viewerIndex] && (
          <div
            className="absolute inset-0 bg-black/90 flex items-center justify-center"
            onClick={() => setViewerIndex(null)}
          >
            {/* Blurred thumb while full photo loads */}
            {!viewerLoaded && (
              <img
                key={`thumb-${urls[viewerIndex].name}`}
                src={urls[viewerIndex].thumb}
                alt=""
                className="absolute max-w-full max-h-full object-contain blur-sm"
              />
            )}
            <img
              key={`full-${urls[viewerIndex].name}`}
              src={urls[viewerIndex].full}
              alt=""
              className={`max-w-full max-h-full object-contain transition-opacity duration-200 ${viewerLoaded ? 'opacity-100' : 'opacity-0'}`}
              onLoad={() => setViewerLoaded(true)}
              onError={() => setViewerLoaded(true)}
            />
            {!viewerLoaded && (
              <div className="absolute bottom-20 left-1/2 -translate-x-1/2 bg-black/70 text-white text-xs px-3 py-1.5 rounded flex items-center gap-2">
                <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                загрузка…
              </div>
            )}
            <div className="absolute top-4 right-4 text-white text-xl cursor-pointer select-none" onClick={() => setViewerIndex(null)}>×</div>
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/60 text-white text-sm px-4 py-1 rounded">
              {selected.date} · {urls[viewerIndex].name.replace('-', ':')}
            </div>
            {viewerIndex > 0 && (
              <button
                onClick={(e) => { e.stopPropagation(); setViewerIndex(viewerIndex - 1); }}
                className="absolute left-4 top-1/2 -translate-y-1/2 bg-black/60 hover:bg-black/80 text-white text-3xl w-12 h-12 rounded-full"
              >‹</button>
            )}
            {viewerIndex < urls.length - 1 && (
              <button
                onClick={(e) => { e.stopPropagation(); setViewerIndex(viewerIndex + 1); }}
                className="absolute right-4 top-1/2 -translate-y-1/2 bg-black/60 hover:bg-black/80 text-white text-3xl w-12 h-12 rounded-full"
              >›</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function VideoModal({ zone, onClose }) {
  const [data, setData] = useState(null);      // { presets, customs, presetDays }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null); // 'preset:3' | 'custom:10' | null
  const [customDays, setCustomDays] = useState('');
  const [building, setBuilding] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/timelapse/${zone}/videos`);
      setData(data);
      setError(null);
    } catch (e) {
      setError(e?.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, [zone]);

  const presets = data?.presets || {};
  const presetDays = data?.presetDays || [3, 7, 14, 30];
  const currentUrl = selected && data ? resolveUrl(data, selected) : null;
  const currentMeta = selected && data ? resolveMeta(data, selected) : null;

  const buildCustom = async () => {
    const n = parseInt(customDays, 10);
    if (!Number.isInteger(n) || n < 1 || n > 90) {
      setError('Введи число от 1 до 90');
      return;
    }
    setBuilding(true);
    setError(null);
    try {
      const { data: res } = await api.post(`/timelapse/${zone}/video/build`, { days: n });
      await refresh();
      setSelected(`custom:${n}`);
    } catch (e) {
      setError(e?.response?.data?.error || e.message);
    } finally {
      setBuilding(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-dark-900 rounded-lg border border-dark-700 max-w-4xl w-full max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-dark-700">
          <h3 className="text-lg font-semibold text-dark-100">▶️ Таймлапс</h3>
          <button onClick={onClose} className="text-dark-400 hover:text-dark-200 text-2xl leading-none">×</button>
        </div>

        <div className="p-4 space-y-4">
          {/* Preset buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-dark-400">Период:</span>
            {presetDays.map(n => {
              const avail = !!presets[n];
              const active = selected === `preset:${n}`;
              return (
                <button
                  key={n}
                  disabled={!avail || loading}
                  onClick={() => setSelected(`preset:${n}`)}
                  className={`px-3 py-1.5 rounded text-sm transition-colors ${
                    active ? 'bg-primary-600 text-white' :
                    avail ? 'bg-dark-700 hover:bg-dark-600 text-dark-100' :
                    'bg-dark-800 text-dark-500 cursor-not-allowed'
                  }`}
                  title={avail ? presets[n].generatedAt : 'ещё не собрано'}
                >
                  {n} {n === 1 ? 'день' : n < 5 ? 'дня' : 'дней'}
                </button>
              );
            })}
          </div>

          {/* Custom days */}
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-dark-700">
            <span className="text-sm text-dark-400">Свой период:</span>
            <input
              type="number"
              min="1"
              max="90"
              value={customDays}
              onChange={(e) => setCustomDays(e.target.value)}
              placeholder="N"
              disabled={building}
              className="w-20 bg-dark-800 border border-dark-700 rounded px-2 py-1 text-sm text-dark-100"
            />
            <span className="text-sm text-dark-500">дней</span>
            <button
              onClick={buildCustom}
              disabled={building || !customDays}
              className="px-3 py-1.5 bg-primary-700 hover:bg-primary-600 disabled:bg-dark-700 disabled:text-dark-500 text-white rounded text-sm"
            >
              {building ? 'Сборка…' : 'Собрать'}
            </button>
            {building && (
              <span className="text-xs text-dark-500">
                Занимает до 90 секунд на Pi…
              </span>
            )}
          </div>

          {/* Previously built custom videos */}
          {data?.customs?.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-dark-500">Готовые custom:</span>
              {data.customs.map(c => {
                const m = c.key.match(/^custom-(\d+)d$/);
                const n = m ? m[1] : c.key;
                const active = selected === `custom:${n}`;
                return (
                  <button
                    key={c.key}
                    onClick={() => setSelected(`custom:${n}`)}
                    className={`px-2 py-1 rounded text-xs ${
                      active ? 'bg-primary-600 text-white' : 'bg-dark-700 hover:bg-dark-600 text-dark-100'
                    }`}
                  >
                    {n} дн.
                  </button>
                );
              })}
            </div>
          )}

          {/* Status / error */}
          {error && (
            <div className="text-xs text-red-400">Ошибка: {error}</div>
          )}

          {/* Player */}
          {currentUrl ? (
            <div>
              <video
                key={currentUrl}
                src={currentUrl}
                controls
                autoPlay
                className="w-full rounded bg-black"
              />
              {currentMeta && (
                <div className="text-xs text-dark-500 mt-2">
                  Обновлено: {new Date(currentMeta.generatedAt).toLocaleString()} · {Math.round((currentMeta.sizeKB || 0) / 1024 * 10) / 10} MB
                </div>
              )}
            </div>
          ) : (
            <div className="aspect-video bg-dark-800 rounded flex items-center justify-center text-dark-500 text-sm">
              {loading ? 'Загрузка списка…' : 'Выбери период чтобы посмотреть таймлапс'}
            </div>
          )}

          <p className="text-xs text-dark-500">
            Пресеты (3/7/14/30 дней) пересобираются автоматически раз в сутки.
            Твои кастомные сборки остаются доступны до следующей чистки.
          </p>
        </div>
      </div>
    </div>
  );
}

function resolveUrl(data, selected) {
  const [kind, n] = selected.split(':');
  if (kind === 'preset') return data.presets?.[n]?.url;
  if (kind === 'custom') return data.customs?.find(c => c.key === `custom-${n}d`)?.url;
  return null;
}

function resolveMeta(data, selected) {
  const [kind, n] = selected.split(':');
  if (kind === 'preset') return data.presets?.[n];
  if (kind === 'custom') return data.customs?.find(c => c.key === `custom-${n}d`);
  return null;
}
