import { useState, useEffect, useMemo } from 'react';
import api from '../../services/api';

/**
 * Timelapse browser for a zone. Shows:
 *  - latest thumbnail
 *  - "Архив" modal: pick a day -> grid of hourly snapshots -> fullscreen viewer
 *  - "Timelapse за месяц" modal: video player streaming /video/month
 */
export default function TimelapsePanel({ zone = 'vega', title = 'Таймлапс' }) {
  const [days, setDays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [openArchive, setOpenArchive] = useState(false);
  const [openVideo, setOpenVideo] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const { data } = await api.get(`/timelapse/${zone}/photos`);
        if (!cancelled) setDays(Array.isArray(data.days) ? data.days : []);
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
  const latestPhoto = latestDay?.photos?.[latestDay.photos.length - 1];
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : '';
  const photoUrl = (date, name) =>
    `/api/timelapse/${zone}/photo/${date}/${name}.jpg?token=${encodeURIComponent(token || '')}`;
  const videoUrl = `/api/timelapse/${zone}/video/month?token=${encodeURIComponent(token || '')}`;
  const previewUrl = latestPhoto ? photoUrl(latestDay.date, latestPhoto) : null;

  return (
    <div className="bg-dark-800 border border-dark-700 rounded-lg p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-dark-100 flex items-center gap-2">
          <span>📷</span> {title}
        </h2>
        <div className="text-xs text-dark-500">
          {loading ? 'загрузка…' : totalCount > 0
            ? `${totalCount} снимков · ${days.length} дней`
            : error ? `ошибка: ${error}` : 'нет снимков'}
        </div>
      </div>

      {/* Preview */}
      <div className="relative bg-dark-900 rounded-md overflow-hidden mb-3 aspect-video flex items-center justify-center">
        {previewUrl ? (
          <img
            src={previewUrl}
            alt="Last snapshot"
            className="w-full h-full object-cover"
            onError={(e) => { e.target.style.display = 'none'; }}
          />
        ) : (
          <div className="text-dark-500 text-sm">Снимки появятся после первого часа</div>
        )}
        {latestPhoto && (
          <div className="absolute bottom-2 left-2 bg-black/60 text-white text-xs px-2 py-1 rounded">
            {latestDay.date} · {latestPhoto.replace('-', ':')}
          </div>
        )}
      </div>

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
          ▶️ Timelapse за месяц
        </button>
      </div>

      {openArchive && (
        <ArchiveModal days={days} photoUrl={photoUrl} onClose={() => setOpenArchive(false)} />
      )}
      {openVideo && (
        <VideoModal videoUrl={videoUrl} onClose={() => setOpenVideo(false)} />
      )}
    </div>
  );
}

function ArchiveModal({ days, photoUrl, onClose }) {
  const [selectedDate, setSelectedDate] = useState(days[0]?.date);
  const [viewerIndex, setViewerIndex] = useState(null);
  const selected = days.find(d => d.date === selectedDate);

  const photos = selected?.photos || [];

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
            {photos.length === 0 ? (
              <div className="text-dark-500 text-sm">Нет фото в этот день</div>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                {photos.map((name, i) => {
                  const url = photoUrl(selected.date, name);
                  return (
                    <button
                      key={name}
                      onClick={() => setViewerIndex(i)}
                      className="relative aspect-video bg-dark-800 rounded overflow-hidden hover:ring-2 hover:ring-primary-500 transition-all"
                    >
                      <img src={url} alt={name} loading="lazy" className="w-full h-full object-cover" />
                      <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-xs px-1 py-0.5 text-center">
                        {name.replace('-', ':')}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Full-size viewer */}
        {viewerIndex != null && photos[viewerIndex] && (
          <div
            className="absolute inset-0 bg-black/90 flex items-center justify-center"
            onClick={() => setViewerIndex(null)}
          >
            <img
              src={photoUrl(selected.date, photos[viewerIndex])}
              alt=""
              className="max-w-full max-h-full object-contain"
            />
            <div className="absolute top-4 right-4 text-white text-xl cursor-pointer" onClick={() => setViewerIndex(null)}>×</div>
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/60 text-white text-sm px-4 py-1 rounded">
              {selected.date} · {photos[viewerIndex].replace('-', ':')}
            </div>
            {viewerIndex > 0 && (
              <button
                onClick={(e) => { e.stopPropagation(); setViewerIndex(viewerIndex - 1); }}
                className="absolute left-4 top-1/2 -translate-y-1/2 bg-black/60 hover:bg-black/80 text-white text-3xl w-12 h-12 rounded-full"
              >‹</button>
            )}
            {viewerIndex < photos.length - 1 && (
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

function VideoModal({ videoUrl, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-dark-900 rounded-lg border border-dark-700 max-w-4xl w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-dark-700">
          <h3 className="text-lg font-semibold text-dark-100">▶️ Timelapse за месяц</h3>
          <button onClick={onClose} className="text-dark-400 hover:text-dark-200 text-2xl leading-none">×</button>
        </div>
        <div className="p-4">
          <video
            src={videoUrl}
            controls
            autoPlay
            className="w-full rounded"
          >
            Ваш браузер не поддерживает видео
          </video>
          <p className="text-xs text-dark-500 mt-2">
            Видео собирается за последние 30 дней. При первом открытии генерация может занять 1-2 минуты.
          </p>
        </div>
      </div>
    </div>
  );
}
