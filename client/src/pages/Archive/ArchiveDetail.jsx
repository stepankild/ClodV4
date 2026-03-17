import { useState, useEffect } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { archiveService } from '../../services/archiveService';
import { useAuth } from '../../context/AuthContext';
import { localizeRoomName } from '../../utils/localizeRoomName';
import ArchiveHeatMap from '../../components/RoomMap/ArchiveHeatMap';
import CrewInfographic from '../../components/Harvest/CrewInfographic';

const formatDate = (date, locale) => {
  if (!date) return '—';
  return new Date(date).toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const formatDateTime = (date, locale) => {
  if (!date) return '—';
  return new Date(date).toLocaleString(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

const formatNum = (n, locale) => (n != null && Number.isFinite(n) ? Number(n).toLocaleString(locale) : '—');

const qualityColor = { low: 'text-red-400', medium: 'text-yellow-400', high: 'text-green-400', premium: 'text-purple-400' };

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
const TimelineItem = ({ date, label, description, icon, color = 'primary', locale }) => {
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
        <div className="text-dark-400 text-sm">{formatDate(date, locale)}</div>
        {description && <div className="text-dark-500 text-sm mt-1">{description}</div>}
      </div>
    </div>
  );
};

export default function ArchiveDetail() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'en' ? 'en-US' : 'ru-RU';
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

  const qualityLabel = {
    low: t('archive.qualityLow'),
    medium: t('archive.qualityMedium'),
    high: t('archive.qualityHigh'),
    premium: t('archive.qualityPremium')
  };

  const mediumLabel = {
    soil: t('archive.mediumSoilFull'),
    coco: t('archive.mediumCocoFull'),
    hydro: t('archive.mediumHydroFull'),
    aero: t('archive.mediumAeroFull'),
    other: t('archive.mediumOther')
  };

  useEffect(() => {
    if (!id) return;
    archiveService
      .getArchive(id)
      .then(setArchive)
      .catch((err) => {
        setError(err.response?.data?.message || t('archive.archiveNotFound'));
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
      setError(err.response?.data?.message || t('archive.saveError'));
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
      setError(err.response?.data?.message || t('archive.deleteError'));
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
          {t('archive.backToList')}
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

  // Попкорн и готовый продукт
  const totalPopcorn = (h.popcornWeight || 0) + (h.popcornMachine || 0);
  // finalWeight (ручной ввод) — основной показатель; fallback на trimWeight для старых данных
  const finalProduct = (h.finalWeight || 0) > 0 ? h.finalWeight : (h.trimWeight || 0);
  const popcornPct = totalPopcorn > 0 && finalProduct > 0 ? (totalPopcorn / finalProduct * 100).toFixed(1) : null;

  // Усушка: (wet - finalProduct) / wet * 100
  const shrinkagePct = h.wetWeight > 0 && finalProduct > 0
    ? (((h.wetWeight - finalProduct) / h.wetWeight) * 100).toFixed(1)
    : null;
  // Потери на триме: (dry - finalProduct) / dry * 100
  const trimLossPct = h.dryWeight > 0 && finalProduct > 0
    ? (((h.dryWeight - finalProduct) / h.dryWeight) * 100).toFixed(1)
    : null;

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
              {localizeRoomName(archive?.roomName, t) || `${t('archive.room')} ${archive?.roomNumber}`}
            </h1>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-primary-400 font-medium">{archive?.strain || t('archive.noStrain')}</span>
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
            {t('archive.deleteBtn')}
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-900/20 border border-red-700 rounded-lg text-red-300">{error}</div>
      )}

      {/* Quick Stats */}
      <div className="mb-6 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        <div className="bg-green-900/30 border border-green-700/50 rounded-xl p-4 text-center">
          <p className="text-dark-400 text-sm">{t('archive.dryWeightLabel')}</p>
          <p className="text-green-400 text-2xl font-bold">{formatNum(h.dryWeight, locale)}<span className="text-sm">{t('common.grams')}</span></p>
        </div>
        <div className="bg-blue-900/30 border border-blue-700/50 rounded-xl p-4 text-center">
          <p className="text-dark-400 text-sm">{t('archive.gramsPerPlant')}</p>
          <p className="text-blue-400 text-2xl font-bold">{formatNum(m.gramsPerPlant, locale)}</p>
        </div>
        <div className="bg-primary-900/30 border border-primary-700/50 rounded-xl p-4 text-center">
          <p className="text-dark-400 text-sm">{t('archive.plantsLabel')}</p>
          <p className="text-primary-400 text-2xl font-bold">{formatNum(archive?.plantsCount, locale)}</p>
        </div>
        <div className="bg-yellow-900/30 border border-yellow-700/50 rounded-xl p-4 text-center">
          <p className="text-dark-400 text-sm">{t('archive.floweringDays')}</p>
          <p className="text-yellow-400 text-2xl font-bold">{formatNum(archive?.actualDays, locale)}</p>
        </div>
        <div className="bg-purple-900/30 border border-purple-700/50 rounded-xl p-4 text-center">
          <p className="text-dark-400 text-sm">{t('archive.qualityLabel')}</p>
          <p className={`text-xl font-bold ${qualityColor[h.quality] || 'text-white'}`}>
            {qualityLabel[h.quality] || h.quality || '—'}
          </p>
        </div>
        {m.gramsPerWatt > 0 && (
          <div className="bg-amber-900/30 border border-amber-700/50 rounded-xl p-4 text-center">
            <p className="text-dark-400 text-sm">{t('archive.gPerWattLabel')}</p>
            <p className="text-amber-400 text-2xl font-bold">{formatNum(m.gramsPerWatt, locale)}</p>
          </div>
        )}
        {gramsPerSqm > 0 && (
          <div className="bg-teal-900/30 border border-teal-700/50 rounded-xl p-4 text-center">
            <p className="text-dark-400 text-sm">{t('archive.gPerSqMLabel')}</p>
            <p className="text-teal-400 text-2xl font-bold">{formatNum(gramsPerSqm, locale)}</p>
          </div>
        )}
        {totalDays && (
          <div className="bg-dark-700/50 border border-dark-600 rounded-xl p-4 text-center">
            <p className="text-dark-400 text-sm">{t('archive.fullCycle')}</p>
            <p className="text-white text-2xl font-bold">{totalDays}<span className="text-sm"> {t('archive.daysLabel')}</span></p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column - Timeline & Details */}
        <div className="lg:col-span-2 space-y-6">
          {/* Timeline */}
          <Section title={t('archive.cycleTimeline')} icon="📅">
            <div className="pl-2">
              {clone?.cutDate && (
                <TimelineItem
                  date={clone.cutDate}
                  label={t('archive.clonesCut')}
                  description={t('archive.clonesPcs', { qty: clone.quantity || clone.strains?.reduce((s, x) => s + (x.quantity || 0), 0) || '?' })}
                  icon="✂️"
                  color="purple"
                  locale={locale}
                />
              )}
              {veg?.transplantedToVegAt && (
                <TimelineItem
                  date={veg.transplantedToVegAt}
                  label={t('archive.transplantToVeg')}
                  description={[
                    veg.vegPlantsCount ? t('archive.plantsCountN', { count: veg.vegPlantsCount }) : null,
                    veg.vegDaysTarget ? t('archive.planDays', { days: veg.vegDaysTarget }) : null
                  ].filter(Boolean).join(' · ') || null}
                  icon="🌱"
                  color="green"
                  locale={locale}
                />
              )}
              {veg?.transplantedToFlowerAt && (
                <TimelineItem
                  date={veg.transplantedToFlowerAt}
                  label={t('archive.transplantToFlower')}
                  description={[
                    veg.flowerPlantsCount ? t('archive.plantsCountN', { count: veg.flowerPlantsCount }) : null,
                    veg.vegDaysActual ? t('archive.vegDays', { days: veg.vegDaysActual }) : null
                  ].filter(Boolean).join(' · ') || null}
                  icon="🌸"
                  color="yellow"
                  locale={locale}
                />
              )}
              {archive?.startDate && !veg?.transplantedToFlowerAt && (
                <TimelineItem
                  date={archive.startDate}
                  label={t('archive.floweringStart')}
                  icon="🌸"
                  color="yellow"
                  locale={locale}
                />
              )}
              {archive?.harvestDate && (
                <TimelineItem
                  date={archive.harvestDate}
                  label={t('archive.harvestCollection')}
                  description={t('archive.floweringDaysDesc', { days: archive.actualDays })}
                  icon="🌿"
                  color="primary"
                  locale={locale}
                />
              )}
            </div>
          </Section>

          {/* Harvest Data */}
          <Section title={t('archive.harvestSection')} icon="⚖️">
            <div className="flex justify-between items-start mb-4">
              <div />
              {canEditWeights && (
                <button
                  type="button"
                  onClick={() => setEditWeights((v) => !v)}
                  className="text-sm text-primary-400 hover:text-primary-300"
                >
                  {editWeights ? t('archive.editWeightsCancel') : t('archive.editWeights')}
                </button>
              )}
            </div>
            {editWeights ? (
              <form onSubmit={handleSaveWeights} className="space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-dark-400 text-sm mb-1">{t('archive.wetWeightG')}</label>
                    <input
                      type="number"
                      value={weightForm.wetWeight}
                      onChange={(e) => setWeightForm((f) => ({ ...f, wetWeight: e.target.value }))}
                      className="w-full bg-dark-800 border border-dark-600 rounded px-3 py-2 text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-dark-400 text-sm mb-1">{t('archive.dryWeightG')}</label>
                    <input
                      type="number"
                      value={weightForm.dryWeight}
                      onChange={(e) => setWeightForm((f) => ({ ...f, dryWeight: e.target.value }))}
                      className="w-full bg-dark-800 border border-dark-600 rounded px-3 py-2 text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-dark-400 text-sm mb-1">{t('archive.trimWeightG')}</label>
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
                  {saving ? t('archive.saving') : t('archive.save')}
                </button>
              </form>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <InfoRow label={t('archive.wetWeightLabel')} value={`${formatNum(h.wetWeight, locale)} ${t('common.grams')}`} />
                <InfoRow label={t('archive.dryWeightLabel')} value={`${formatNum(h.dryWeight, locale)} ${t('common.grams')}`} highlight color="text-green-400" />
                <InfoRow label={t('archive.trimWeightLabel')} value={`${formatNum(h.trimWeight, locale)} ${t('common.grams')}`} />
                {finalProduct > 0 && <InfoRow label={t('trim.finalWeight')} value={`${formatNum(finalProduct, locale)} ${t('common.grams')}`} highlight color="text-emerald-400" />}
                {totalPopcorn > 0 && <InfoRow label={t('trim.popcorn')} value={`${formatNum(totalPopcorn, locale)} ${t('common.grams')}${popcornPct ? ` (${popcornPct}%)` : ''}`} />}
                <InfoRow label={t('archive.gramsPerPlant')} value={formatNum(m.gramsPerPlant, locale)} highlight color="text-primary-400" />
                <InfoRow label={t('archive.gPerDay')} value={formatNum(m.gramsPerDay, locale)} />
                {m.gramsPerWatt > 0 && <InfoRow label={t('archive.gPerWattLabel')} value={formatNum(m.gramsPerWatt, locale)} color="text-amber-400" />}
                {shrinkagePct && <InfoRow label={t('archive.shrinkage')} value={`${shrinkagePct}%`} color="text-red-400" />}
                {trimLossPct && <InfoRow label={t('trim.loss')} value={`${trimLossPct}%`} color="text-orange-400" />}
                <InfoRow
                  label={t('archive.qualityLabel')}
                  value={qualityLabel[h.quality] || h.quality || '—'}
                  color={qualityColor[h.quality]}
                />
                {h.notes && !h.notes.startsWith('Автоархив') && !h.notes.startsWith('Auto-archived') && (
                  <div className="col-span-2 sm:col-span-4">
                    <span className="text-dark-400 text-sm">{t('archive.harvestNotes')}</span>
                    <p className="text-dark-300">{h.notes}</p>
                  </div>
                )}
              </div>
            )}
          </Section>

          {/* Карта сбора (тепловая) */}
          {archive?.harvestMapData?.plants?.length > 0 && (
            <Section title={t('archive.harvestMap')} icon="🗺️">
              <ArchiveHeatMap harvestMapData={archive.harvestMapData} />
            </Section>
          )}

          {/* Команда сбора */}
          {archive?.crewData?.members?.length > 0 && (
            <Section title={t('archive.crewSection')} icon="👥">
              <CrewInfographic
                crewData={archive.crewData}
                roomSquareMeters={archive.squareMeters}
                roomName={localizeRoomName(archive.roomName, t)}
                strain={archive.strain}
                embedded
              />
            </Section>
          )}

          {/* Completed Tasks */}
          {tasks.length > 0 && (
            <Section title={t('archive.completedTasks', { count: tasks.length })} icon="✅">
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {tasks.map((tk, i) => (
                  <div key={i} className="flex flex-wrap items-baseline gap-2 text-sm py-2 border-b border-dark-700 last:border-0">
                    <span className="px-2 py-0.5 bg-primary-900/50 text-primary-400 rounded text-xs">
                      {tk.type || t('archive.taskLabel')}
                    </span>
                    <span className="text-white">{tk.title}</span>
                    {tk.dayOfCycle && (
                      <span className="text-dark-500">{t('archive.dayOfCycle', { day: tk.dayOfCycle })}</span>
                    )}
                    {tk.completedAt && (
                      <span className="text-dark-500">{formatDateTime(tk.completedAt, locale)}</span>
                    )}
                    {tk.completedBy?.name && (
                      <span className="text-dark-400">({tk.completedBy.name})</span>
                    )}
                    {tk.sprayProduct && (
                      <span className="text-blue-400 text-xs">🧪 {tk.sprayProduct}</span>
                    )}
                    {tk.feedProduct && (
                      <span className="text-green-400 text-xs">🌿 {tk.feedProduct} {tk.feedDosage}</span>
                    )}
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Issues */}
          {issues.length > 0 && (
            <Section title={t('archive.issuesInCycle')} icon="⚠️">
              <div className="space-y-2">
                {issues.map((iss, i) => (
                  <div key={i} className="p-3 bg-red-900/20 border border-red-800/50 rounded-lg">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="px-2 py-0.5 bg-red-900/50 text-red-400 rounded text-xs">
                        {iss.type || t('archive.issueLabel')}
                      </span>
                      {iss.resolvedAt && (
                        <span className="px-2 py-0.5 bg-green-900/50 text-green-400 rounded text-xs">
                          {t('archive.resolved')}
                        </span>
                      )}
                    </div>
                    <p className="text-dark-300">{iss.description || '—'}</p>
                    {iss.solution && (
                      <p className="text-dark-400 text-sm mt-1">{t('archive.solutionLabel', { solution: iss.solution })}</p>
                    )}
                    <div className="text-dark-500 text-xs mt-1">
                      {iss.resolvedAt
                        ? t('archive.detectedAndResolved', { detected: formatDate(iss.detectedAt, locale), resolved: formatDate(iss.resolvedAt, locale) })
                        : t('archive.detectedAt', { date: formatDate(iss.detectedAt, locale) })
                      }
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
            <Section title={t('archive.clonesSection')} icon="✂️">
              <div className="space-y-3">
                <InfoRow label={t('archive.cutDate')} value={formatDate(clone.cutDate, locale)} />
                <InfoRow
                  label={t('archive.quantity')}
                  value={t('archive.clonesPcs', { qty: clone.quantity || clone.strains?.reduce((s, x) => s + (x.quantity || 0), 0) || '?' })}
                />
                {clone.strains?.length > 0 && (
                  <div>
                    <span className="text-dark-400 text-sm">{t('archive.strainsLabel')}</span>
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
                    <span className="text-dark-400 text-sm">{t('archive.notesLabel')}</span>
                    <p className="text-dark-300 text-sm">{clone.notes}</p>
                  </div>
                )}
              </div>
            </Section>
          )}

          {/* Veg Data */}
          {veg && (
            <Section title={t('archive.vegSection')} icon="🌱">
              <div className="space-y-3">
                <InfoRow label={t('archive.vegStart')} value={formatDate(veg.transplantedToVegAt, locale)} />
                {veg.vegPlantsCount > 0 && (
                  <InfoRow label={t('archive.plantsToVeg')} value={t('archive.clonesPcs', { qty: veg.vegPlantsCount })} />
                )}
                <InfoRow label={t('archive.toFlower')} value={formatDate(veg.transplantedToFlowerAt, locale)} />
                {veg.flowerPlantsCount > 0 && (
                  <InfoRow label={t('archive.plantsToFlower')} value={t('archive.clonesPcs', { qty: veg.flowerPlantsCount })} highlight color="text-primary-400" />
                )}
                <div className="grid grid-cols-2 gap-3">
                  <InfoRow label={t('archive.planLabel')} value={t('archive.daysValue', { days: veg.vegDaysTarget || '—' })} />
                  <InfoRow
                    label={t('archive.factLabel')}
                    value={t('archive.daysValue', { days: veg.vegDaysActual || '—' })}
                    highlight
                    color="text-green-400"
                  />
                </div>
                {veg.notes && (
                  <div>
                    <span className="text-dark-400 text-sm">{t('archive.notesLabel')}</span>
                    <p className="text-dark-300 text-sm">{veg.notes}</p>
                  </div>
                )}
              </div>
            </Section>
          )}

          {/* Lighting & Room */}
          {(light?.totalWatts || archive?.squareMeters) && (
            <Section title={t('archive.lightingAndRoom')} icon="💡">
              <div className="space-y-3">
                {archive?.squareMeters > 0 && (
                  <InfoRow label={t('archive.greenArea')} value={t('archive.sqMeters', { area: archive.squareMeters })} />
                )}
                {light?.lampCount > 0 && (
                  <InfoRow label={t('archive.lampsLabel')} value={t('archive.lampsInfo', { count: light.lampCount, wattage: light.lampWattage || '?' })} />
                )}
                {light?.lampType && (
                  <InfoRow label={t('archive.lampType')} value={light.lampType} />
                )}
                {m.gramsPerWatt > 0 && (
                  <InfoRow label={t('archive.gPerWattLabel')} value={formatNum(m.gramsPerWatt, locale)} highlight color="text-amber-400" />
                )}
                {gramsPerSqm > 0 && (
                  <InfoRow label={t('archive.gPerSqMLabel')} value={formatNum(gramsPerSqm, locale)} highlight color="text-teal-400" />
                )}
              </div>
            </Section>
          )}

          {/* Environment */}
          <Section title={t('archive.conditionsSection')} icon="🌡️">
            <div className="space-y-3">
              <InfoRow label={t('archive.lightSchedule')} value={t('archive.lightScheduleVal', { hours: env.lightHours || 12 })} />
              <InfoRow label={t('archive.substrate')} value={mediumLabel[env.medium] || env.medium || '—'} />
              {env.avgTemperature && (
                <InfoRow label={t('archive.avgTemp')} value={t('archive.avgTempVal', { temp: env.avgTemperature })} />
              )}
              {env.avgHumidity && (
                <InfoRow label={t('archive.avgHumidity')} value={t('archive.avgHumidityVal', { humidity: env.avgHumidity })} />
              )}
              {env.nutrients && (
                <div>
                  <span className="text-dark-400 text-sm">{t('archive.fertilizers')}</span>
                  <p className="text-dark-300 text-sm">{env.nutrients}</p>
                </div>
              )}
            </div>
          </Section>

          {/* Cycle Dates */}
          <Section title={t('archive.cycleDates')} icon="📆">
            <div className="space-y-3">
              <InfoRow label={t('archive.floweringStartDate')} value={formatDate(archive?.startDate, locale)} />
              <InfoRow label={t('archive.plannedHarvest')} value={t('archive.daysValue', { days: archive?.floweringDays || '—' })} />
              <InfoRow label={t('archive.actualHarvest')} value={formatDate(archive?.harvestDate, locale)} />
              <InfoRow
                label={t('archive.actualDays')}
                value={t('archive.daysValue', { days: archive?.actualDays || '—' })}
                highlight
              />
            </div>
          </Section>

          {/* Notes */}
          {archive?.notes && (
            <Section title={t('archive.generalNotes')} icon="📝">
              <p className="text-dark-300 whitespace-pre-wrap">{archive.notes}</p>
            </Section>
          )}
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-dark-800 rounded-2xl p-6 max-w-md w-full border border-dark-700">
            <h3 className="text-xl font-bold text-white mb-4">{t('archive.deleteArchiveTitle')}</h3>
            <p className="text-dark-300 mb-6">
              {t('archive.deleteArchiveMsg', {
                room: localizeRoomName(archive?.roomName, t) || `${t('archive.room')} ${archive?.roomNumber}`,
                strain: archive?.strain
              })}
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteConfirm(false)}
                className="px-4 py-2 text-dark-300 hover:text-white transition"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleDelete}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-500 transition"
              >
                {t('common.delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
