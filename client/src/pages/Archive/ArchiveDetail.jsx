import { useState, useEffect } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { archiveService } from '../../services/archiveService';
import { useAuth } from '../../context/AuthContext';

const formatDate = (date) => {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const formatDateTime = (date) => {
  if (!date) return '—';
  return new Date(date).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

const formatNum = (n) => (n != null && Number.isFinite(n) ? Number(n).toLocaleString('ru-RU') : '—');

const qualityLabel = { low: 'Низкое', medium: 'Среднее', high: 'Высокое', premium: 'Премиум' };
const qualityColor = { low: 'text-red-400', medium: 'text-yellow-400', high: 'text-green-400', premium: 'text-purple-400' };

const mediumLabel = { soil: 'Земля', coco: 'Кокос', hydro: 'Гидропоника', aero: 'Аэропоника', other: 'Другое' };

// Section component
const Section = ({ title, icon, children, className = '' }) => (
  <section className={`bg-dark-800/50 rounded-xl border border-dark-700 overflow-hidden ${className}`}>
    <div className="px-4 py-3 border-b border-dark-700 flex items-center gap-2">
      {icon && <span className="text-xl">{icon}</span>}
      <h2 className="text-lg font-semibold text-white">{title}</h2>
    </div>
    <div className="p-4">
      {children}
    </div>
  </section>
);

// Info row
const InfoRow = ({ label, value, highlight, color }) => (
  <div className="flex flex-col">
    <span className="text-dark-400 text-sm">{label}</span>
    <span className={`${highlight ? 'font-semibold' : ''} ${color || 'text-white'}`}>{value}</span>
  </div>
);

// Timeline item
const TimelineItem = ({ date, label, description, icon, color = 'primary' }) => {
  const colors = {
    primary: 'bg-primary-500',
    green: 'bg-green-500',
    blue: 'bg-blue-500',
    yellow: 'bg-yellow-500',
    purple: 'bg-purple-500'
  };

  return (
    <div className="flex gap-4">
      <div className="flex flex-col items-center">
        <div className={`w-3 h-3 rounded-full ${colors[color]}`} />
        <div className="w-0.5 flex-1 bg-dark-600" />
      </div>
      <div className="pb-6">
        <div className="flex items-center gap-2 mb-1">
          {icon && <span>{icon}</span>}
          <span className="text-white font-medium">{label}</span>
        </div>
        <div className="text-dark-400 text-sm">{formatDate(date)}</div>
        {description && <div className="text-dark-500 text-sm mt-1">{description}</div>}
      </div>
    </div>
  );
};

export default function ArchiveDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const [archive, setArchive] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const canEditWeights = hasPermission?.('harvest:edit_weights') ?? false;
  const canDelete = hasPermission?.('archive:delete') ?? hasPermission?.('*') ?? false;
  const [editWeights, setEditWeights] = useState(false);
  const [weightForm, setWeightForm] = useState({ dryWeight: '', wetWeight: '', trimWeight: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    archiveService
      .getArchive(id)
      .then(setArchive)
      .catch((err) => {
        setError(err.response?.data?.message || 'Архив не найден');
        setArchive(null);
      })
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!archive?.harvestData) return;
    setWeightForm({
      dryWeight: archive.harvestData.dryWeight ?? '',
      wetWeight: archive.harvestData.wetWeight ?? '',
      trimWeight: archive.harvestData.trimWeight ?? ''
    });
  }, [archive]);

  const handleSaveWeights = async (e) => {
    e.preventDefault();
    if (!archive?._id || !canEditWeights) return;
    setSaving(true);
    try {
      const payload = {
        harvestData: {
          dryWeight: weightForm.dryWeight === '' ? undefined : Number(weightForm.dryWeight),
          wetWeight: weightForm.wetWeight === '' ? undefined : Number(weightForm.wetWeight),
          trimWeight: weightForm.trimWeight === '' ? undefined : Number(weightForm.trimWeight)
        }
      };
      const updated = await archiveService.updateArchive(archive._id, payload);
      setArchive(updated);
      setEditWeights(false);
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!archive?._id) return;
    try {
      await archiveService.deleteArchive(archive._id);
      navigate('/archive');
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка удаления');
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500" />
      </div>
    );
  }

  if (error && !archive) {
    return (
      <div className="p-6">
        <div className="p-4 bg-red-900/20 border border-red-700 rounded-lg text-red-300">{error}</div>
        <Link to="/archive" className="inline-block mt-4 text-primary-400 hover:text-primary-300">
          ← К списку архива
        </Link>
      </div>
    );
  }

  const h = archive?.harvestData || {};
  const m = archive?.metrics || {};
  const env = archive?.environment || {};
  const veg = archive?.vegData || null;
  const clone = archive?.cloneData || null;
  const light = archive?.lighting || null;
  const tasks = Array.isArray(archive?.completedTasks) ? archive.completedTasks : [];
  const issues = Array.isArray(archive?.issues) ? archive.issues : [];

  const gramsPerSqm = (archive?.squareMeters > 0 && h.dryWeight > 0)
    ? Math.round(h.dryWeight / archive.squareMeters * 100) / 100
    : null;

  // Calculate total cycle duration (from clones to harvest)
  const totalDays = (() => {
    if (clone?.cutDate && archive?.harvestDate) {
      return Math.floor((new Date(archive.harvestDate) - new Date(clone.cutDate)) / (1000 * 60 * 60 * 24));
    }
    return null;
  })();

  // Drying ratio
  const dryingRatio = h.wetWeight && h.dryWeight ? ((h.dryWeight / h.wetWeight) * 100).toFixed(1) : null;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link to="/archive" className="text-dark-400 hover:text-white transition">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-white">
              {archive?.roomName || `Комната ${archive?.roomNumber}`}
            </h1>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-primary-400 font-medium">{archive?.strain || 'Без сорта'}</span>
              {archive?.cycleName && (
                <span className="text-dark-500">· {archive.cycleName}</span>
              )}
            </div>
          </div>
        </div>
        {canDelete && (
          <button
            onClick={() => setDeleteConfirm(true)}
            className="px-3 py-2 text-red-400 hover:bg-red-900/30 rounded-lg transition text-sm"
          >
            Удалить
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-900/20 border border-red-700 rounded-lg text-red-300">{error}</div>
      )}

      {/* Quick Stats */}
      <div className="mb-6 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        <div className="bg-green-900/30 border border-green-700/50 rounded-xl p-4 text-center">
          <p className="text-dark-400 text-sm">Сухой вес</p>
          <p className="text-green-400 text-2xl font-bold">{formatNum(h.dryWeight)}<span className="text-sm">г</span></p>
        </div>
        <div className="bg-blue-900/30 border border-blue-700/50 rounded-xl p-4 text-center">
          <p className="text-dark-400 text-sm">г/куст</p>
          <p className="text-blue-400 text-2xl font-bold">{formatNum(m.gramsPerPlant)}</p>
        </div>
        <div className="bg-primary-900/30 border border-primary-700/50 rounded-xl p-4 text-center">
          <p className="text-dark-400 text-sm">Кустов</p>
          <p className="text-primary-400 text-2xl font-bold">{formatNum(archive?.plantsCount)}</p>
        </div>
        <div className="bg-yellow-900/30 border border-yellow-700/50 rounded-xl p-4 text-center">
          <p className="text-dark-400 text-sm">Дней цветения</p>
          <p className="text-yellow-400 text-2xl font-bold">{formatNum(archive?.actualDays)}</p>
        </div>
        <div className="bg-purple-900/30 border border-purple-700/50 rounded-xl p-4 text-center">
          <p className="text-dark-400 text-sm">Качество</p>
          <p className={`text-xl font-bold ${qualityColor[h.quality] || 'text-white'}`}>
            {qualityLabel[h.quality] || h.quality || '—'}
          </p>
        </div>
        {m.gramsPerWatt > 0 && (
          <div className="bg-amber-900/30 border border-amber-700/50 rounded-xl p-4 text-center">
            <p className="text-dark-400 text-sm">г/ватт</p>
            <p className="text-amber-400 text-2xl font-bold">{formatNum(m.gramsPerWatt)}</p>
          </div>
        )}
        {gramsPerSqm > 0 && (
          <div className="bg-teal-900/30 border border-teal-700/50 rounded-xl p-4 text-center">
            <p className="text-dark-400 text-sm">г/м²</p>
            <p className="text-teal-400 text-2xl font-bold">{formatNum(gramsPerSqm)}</p>
          </div>
        )}
        {totalDays && (
          <div className="bg-dark-700/50 border border-dark-600 rounded-xl p-4 text-center">
            <p className="text-dark-400 text-sm">Весь цикл</p>
            <p className="text-white text-2xl font-bold">{totalDays}<span className="text-sm"> дней</span></p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column - Timeline & Details */}
        <div className="lg:col-span-2 space-y-6">
          {/* Timeline */}
          <Section title="Хронология цикла" icon="📅">
            <div className="pl-2">
              {clone?.cutDate && (
                <TimelineItem
                  date={clone.cutDate}
                  label="Клоны нарезаны"
                  description={`${clone.quantity || clone.strains?.reduce((s, x) => s + (x.quantity || 0), 0) || '?'} шт`}
                  icon="✂️"
                  color="purple"
                />
              )}
              {veg?.transplantedToVegAt && (
                <TimelineItem
                  date={veg.transplantedToVegAt}
                  label="Пересадка на вегу"
                  description={veg.vegDaysTarget ? `План: ${veg.vegDaysTarget} дней` : null}
                  icon="🌱"
                  color="green"
                />
              )}
              {veg?.transplantedToFlowerAt && (
                <TimelineItem
                  date={veg.transplantedToFlowerAt}
                  label="Пересадка на цвет"
                  description={veg.vegDaysActual ? `Вега: ${veg.vegDaysActual} дней` : null}
                  icon="🌸"
                  color="yellow"
                />
              )}
              {archive?.startDate && !veg?.transplantedToFlowerAt && (
                <TimelineItem
                  date={archive.startDate}
                  label="Начало цветения"
                  icon="🌸"
                  color="yellow"
                />
              )}
              {archive?.harvestDate && (
                <TimelineItem
                  date={archive.harvestDate}
                  label="Сбор урожая"
                  description={`${archive.actualDays} дней цветения`}
                  icon="🌿"
                  color="primary"
                />
              )}
            </div>
          </Section>

          {/* Harvest Data */}
          <Section title="Урожай" icon="⚖️">
            <div className="flex justify-between items-start mb-4">
              <div />
              {canEditWeights && (
                <button
                  type="button"
                  onClick={() => setEditWeights((v) => !v)}
                  className="text-sm text-primary-400 hover:text-primary-300"
                >
                  {editWeights ? 'Отмена' : 'Изменить веса'}
                </button>
              )}
            </div>
            {editWeights ? (
              <form onSubmit={handleSaveWeights} className="space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-dark-400 text-sm mb-1">Сырой вес (г)</label>
                    <input
                      type="number"
                      value={weightForm.wetWeight}
                      onChange={(e) => setWeightForm((f) => ({ ...f, wetWeight: e.target.value }))}
                      className="w-full bg-dark-800 border border-dark-600 rounded px-3 py-2 text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-dark-400 text-sm mb-1">Сухой вес (г)</label>
                    <input
                      type="number"
                      value={weightForm.dryWeight}
                      onChange={(e) => setWeightForm((f) => ({ ...f, dryWeight: e.target.value }))}
                      className="w-full bg-dark-800 border border-dark-600 rounded px-3 py-2 text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-dark-400 text-sm mb-1">Трим (г)</label>
                    <input
                      type="number"
                      value={weightForm.trimWeight}
                      onChange={(e) => setWeightForm((f) => ({ ...f, trimWeight: e.target.value }))}
                      className="w-full bg-dark-800 border border-dark-600 rounded px-3 py-2 text-white"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-500 disabled:opacity-50"
                >
                  {saving ? 'Сохранение…' : 'Сохранить'}
                </button>
              </form>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <InfoRow label="Сырой вес" value={`${formatNum(h.wetWeight)} г`} />
                <InfoRow label="Сухой вес" value={`${formatNum(h.dryWeight)} г`} highlight color="text-green-400" />
                <InfoRow label="Трим" value={`${formatNum(h.trimWeight)} г`} />
                <InfoRow label="г/куст" value={formatNum(m.gramsPerPlant)} highlight color="text-primary-400" />
                <InfoRow label="г/день" value={formatNum(m.gramsPerDay)} />
                {m.gramsPerWatt > 0 && <InfoRow label="г/ватт" value={formatNum(m.gramsPerWatt)} color="text-amber-400" />}
                {dryingRatio && <InfoRow label="Усушка" value={`${dryingRatio}%`} />}
                <InfoRow
                  label="Качество"
                  value={qualityLabel[h.quality] || h.quality || '—'}
                  color={qualityColor[h.quality]}
                />
                {h.notes && (
                  <div className="col-span-2 sm:col-span-4">
                    <span className="text-dark-400 text-sm">Заметки урожая</span>
                    <p className="text-dark-300">{h.notes}</p>
                  </div>
                )}
              </div>
            )}
          </Section>

          {/* Completed Tasks */}
          {tasks.length > 0 && (
            <Section title={`Выполненные задачи (${tasks.length})`} icon="✅">
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {tasks.map((t, i) => (
                  <div key={i} className="flex flex-wrap items-baseline gap-2 text-sm py-2 border-b border-dark-700 last:border-0">
                    <span className="px-2 py-0.5 bg-primary-900/50 text-primary-400 rounded text-xs">
                      {t.type || 'Задача'}
                    </span>
                    <span className="text-white">{t.title}</span>
                    {t.dayOfCycle && (
                      <span className="text-dark-500">День {t.dayOfCycle}</span>
                    )}
                    {t.completedAt && (
                      <span className="text-dark-500">{formatDateTime(t.completedAt)}</span>
                    )}
                    {t.completedBy?.name && (
                      <span className="text-dark-400">({t.completedBy.name})</span>
                    )}
                    {t.sprayProduct && (
                      <span className="text-blue-400 text-xs">🧪 {t.sprayProduct}</span>
                    )}
                    {t.feedProduct && (
                      <span className="text-green-400 text-xs">🌿 {t.feedProduct} {t.feedDosage}</span>
                    )}
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Issues */}
          {issues.length > 0 && (
            <Section title="Проблемы в цикле" icon="⚠️">
              <div className="space-y-2">
                {issues.map((iss, i) => (
                  <div key={i} className="p-3 bg-red-900/20 border border-red-800/50 rounded-lg">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="px-2 py-0.5 bg-red-900/50 text-red-400 rounded text-xs">
                        {iss.type || 'Проблема'}
                      </span>
                      {iss.resolvedAt && (
                        <span className="px-2 py-0.5 bg-green-900/50 text-green-400 rounded text-xs">
                          Решено
                        </span>
                      )}
                    </div>
                    <p className="text-dark-300">{iss.description || '—'}</p>
                    {iss.solution && (
                      <p className="text-dark-400 text-sm mt-1">Решение: {iss.solution}</p>
                    )}
                    <div className="text-dark-500 text-xs mt-1">
                      Обнаружено: {formatDate(iss.detectedAt)}
                      {iss.resolvedAt && ` · Решено: ${formatDate(iss.resolvedAt)}`}
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>

        {/* Right column - Info cards */}
        <div className="space-y-6">
          {/* Clone Data */}
          {clone && (
            <Section title="Клоны" icon="✂️">
              <div className="space-y-3">
                <InfoRow label="Дата нарезки" value={formatDate(clone.cutDate)} />
                <InfoRow
                  label="Количество"
                  value={`${clone.quantity || clone.strains?.reduce((s, x) => s + (x.quantity || 0), 0) || '?'} шт`}
                />
                {clone.strains?.length > 0 && (
                  <div>
                    <span className="text-dark-400 text-sm">Сорта</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {clone.strains.map((s, i) => (
                        <span key={i} className="px-2 py-1 bg-purple-900/50 text-purple-400 rounded text-xs">
                          {s.strain}: {s.quantity}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {clone.notes && (
                  <div>
                    <span className="text-dark-400 text-sm">Заметки</span>
                    <p className="text-dark-300 text-sm">{clone.notes}</p>
                  </div>
                )}
              </div>
            </Section>
          )}

          {/* Veg Data */}
          {veg && (
            <Section title="Вегетация" icon="🌱">
              <div className="space-y-3">
                <InfoRow label="Начало веги" value={formatDate(veg.transplantedToVegAt)} />
                <InfoRow label="На цвет" value={formatDate(veg.transplantedToFlowerAt)} />
                <div className="grid grid-cols-2 gap-3">
                  <InfoRow label="План" value={`${veg.vegDaysTarget || '—'} дней`} />
                  <InfoRow
                    label="Факт"
                    value={`${veg.vegDaysActual || '—'} дней`}
                    highlight
                    color="text-green-400"
                  />
                </div>
                {veg.notes && (
                  <div>
                    <span className="text-dark-400 text-sm">Заметки</span>
                    <p className="text-dark-300 text-sm">{veg.notes}</p>
                  </div>
                )}
              </div>
            </Section>
          )}

          {/* Lighting & Room */}
          {(light?.totalWatts || archive?.squareMeters) && (
            <Section title="Освещение и комната" icon="💡">
              <div className="space-y-3">
                {archive?.squareMeters > 0 && (
                  <InfoRow label="Зелёная площадь" value={`${archive.squareMeters} м²`} />
                )}
                {light?.lampCount > 0 && (
                  <InfoRow label="Лампы" value={`${light.lampCount} шт × ${light.lampWattage || '?'} Вт`} />
                )}
                {light?.lampType && (
                  <InfoRow label="Тип ламп" value={light.lampType} />
                )}
                {m.gramsPerWatt > 0 && (
                  <InfoRow label="г/ватт" value={formatNum(m.gramsPerWatt)} highlight color="text-amber-400" />
                )}
                {gramsPerSqm > 0 && (
                  <InfoRow label="г/м²" value={formatNum(gramsPerSqm)} highlight color="text-teal-400" />
                )}
              </div>
            </Section>
          )}

          {/* Environment */}
          <Section title="Условия" icon="🌡️">
            <div className="space-y-3">
              <InfoRow label="Световой режим" value={`${env.lightHours || 12}/12`} />
              <InfoRow label="Субстрат" value={mediumLabel[env.medium] || env.medium || '—'} />
              {env.avgTemperature && (
                <InfoRow label="Средняя t°" value={`${env.avgTemperature}°C`} />
              )}
              {env.avgHumidity && (
                <InfoRow label="Средняя влажность" value={`${env.avgHumidity}%`} />
              )}
              {env.nutrients && (
                <div>
                  <span className="text-dark-400 text-sm">Удобрения</span>
                  <p className="text-dark-300 text-sm">{env.nutrients}</p>
                </div>
              )}
            </div>
          </Section>

          {/* Cycle Dates */}
          <Section title="Даты цикла" icon="📆">
            <div className="space-y-3">
              <InfoRow label="Начало цветения" value={formatDate(archive?.startDate)} />
              <InfoRow label="План урожая" value={`${archive?.floweringDays || '—'} дней`} />
              <InfoRow label="Факт урожая" value={formatDate(archive?.harvestDate)} />
              <InfoRow
                label="Фактических дней"
                value={`${archive?.actualDays || '—'} дней`}
                highlight
              />
            </div>
          </Section>

          {/* Notes */}
          {archive?.notes && (
            <Section title="Общие заметки" icon="📝">
              <p className="text-dark-300 whitespace-pre-wrap">{archive.notes}</p>
            </Section>
          )}
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-dark-800 rounded-2xl p-6 max-w-md w-full border border-dark-700">
            <h3 className="text-xl font-bold text-white mb-4">Удалить архив?</h3>
            <p className="text-dark-300 mb-6">
              Вы уверены, что хотите удалить архивную запись для {archive?.roomName || `Комната ${archive?.roomNumber}`} · {archive?.strain}?
              Это действие нельзя отменить.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteConfirm(false)}
                className="px-4 py-2 text-dark-300 hover:text-white transition"
              >
                Отмена
              </button>
              <button
                onClick={handleDelete}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-500 transition"
              >
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
