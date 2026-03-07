import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { treatmentProductService } from '../../services/treatmentProductService';

const PRODUCT_TYPE_STYLES = {
  insecticide: { color: 'bg-red-500' },
  fungicide: { color: 'bg-blue-500' },
  acaricide: { color: 'bg-orange-500' },
  bio: { color: 'bg-green-500' },
  fertilizer: { color: 'bg-purple-500' },
  ph_adjuster: { color: 'bg-cyan-500' },
  other: { color: 'bg-gray-500' }
};

const PRODUCT_TYPE_KEYS = ['insecticide', 'fungicide', 'acaricide', 'bio', 'fertilizer', 'ph_adjuster', 'other'];

const emptyForm = {
  name: '',
  type: 'other',
  activeIngredient: '',
  concentration: '',
  targetPests: '',
  safetyIntervalDays: '',
  instructions: '',
  notes: ''
};

const TreatmentProducts = () => {
  const { t } = useTranslation();
  const [products, setProducts] = useState([]);
  const [deleted, setDeleted] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);
  const [expandedId, setExpandedId] = useState(null);

  const load = async () => {
    try {
      setLoading(true);
      setError('');
      const [active, del] = await Promise.all([
        treatmentProductService.getAll(),
        treatmentProductService.getDeleted().catch(() => [])
      ]);
      setProducts(active);
      setDeleted(del);
    } catch (err) {
      setError(err.response?.data?.message || t('treatments.loadError'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const resetForm = () => {
    setForm(emptyForm);
    setEditId(null);
    setShowForm(false);
  };

  const startEdit = (p) => {
    setEditId(p._id);
    setForm({
      name: p.name || '',
      type: p.type || 'other',
      activeIngredient: p.activeIngredient || '',
      concentration: p.concentration || '',
      targetPests: (p.targetPests || []).join(', '),
      safetyIntervalDays: p.safetyIntervalDays != null ? String(p.safetyIntervalDays) : '',
      instructions: p.instructions || '',
      notes: p.notes || ''
    });
    setShowForm(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim() || saving) return;
    setSaving(true);
    try {
      const data = {
        name: form.name.trim(),
        type: form.type,
        activeIngredient: form.activeIngredient.trim(),
        concentration: form.concentration.trim(),
        targetPests: form.targetPests
          .split(',')
          .map(s => s.trim())
          .filter(Boolean),
        safetyIntervalDays: form.safetyIntervalDays ? parseInt(form.safetyIntervalDays) : null,
        instructions: form.instructions.trim(),
        notes: form.notes.trim()
      };

      if (editId) {
        await treatmentProductService.update(editId, data);
      } else {
        await treatmentProductService.create(data);
      }
      resetForm();
      await load();
    } catch (err) {
      setError(err.response?.data?.message || t('treatments.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id, name) => {
    if (!confirm(t('treatments.deleteProductConfirm', { name }))) return;
    try {
      await treatmentProductService.delete(id);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || t('treatments.deleteError'));
    }
  };

  const handleRestore = async (id) => {
    try {
      await treatmentProductService.restore(id);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || t('treatments.restoreError'));
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
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">{t('treatments.productsDatabaseTitle')}</h1>
          <p className="text-dark-400 mt-1 text-sm">{t('treatments.productsDatabaseSubtitle')}</p>
        </div>
        {!showForm && (
          <button
            type="button"
            onClick={() => { resetForm(); setShowForm(true); }}
            className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm font-medium transition"
          >
            {t('treatments.addProductBtn')}
          </button>
        )}
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-800 text-red-400 px-4 py-3 rounded-lg mb-4">
          {error}
          <button type="button" onClick={() => setError('')} className="ml-3 text-red-500 hover:text-red-300">×</button>
        </div>
      )}

      {/* Add/Edit form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="bg-dark-800 rounded-xl border border-dark-700 p-4 mb-6 space-y-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-white font-medium">{editId ? t('treatments.editForm') : t('treatments.newProduct')}</h3>
            <button type="button" onClick={resetForm} className="text-dark-400 hover:text-dark-300 text-xl leading-none">&times;</button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-dark-400 text-sm mb-1">{t('treatments.productName')}</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder={t('treatments.productNamePlaceholder')}
                className="w-full bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 text-white text-sm placeholder-dark-500 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                autoFocus
              />
            </div>

            <div>
              <label className="block text-dark-400 text-sm mb-1">{t('treatments.productType')}</label>
              <select
                value={form.type}
                onChange={(e) => setForm(f => ({ ...f, type: e.target.value }))}
                className="w-full bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 text-white text-sm focus:ring-2 focus:ring-primary-500"
              >
                {PRODUCT_TYPE_KEYS.map(key => (
                  <option key={key} value={key}>{t(`treatments.productTypes.${key === 'ph_adjuster' ? 'ph_adjuster_full' : key}`)}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-dark-400 text-sm mb-1">{t('treatments.activeIngredient')}</label>
              <input
                type="text"
                value={form.activeIngredient}
                onChange={(e) => setForm(f => ({ ...f, activeIngredient: e.target.value }))}
                placeholder={t('treatments.activeIngredientPlaceholder')}
                className="w-full bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 text-white text-sm placeholder-dark-500 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-dark-400 text-sm mb-1">{t('treatments.standardDosage')}</label>
              <input
                type="text"
                value={form.concentration}
                onChange={(e) => setForm(f => ({ ...f, concentration: e.target.value }))}
                placeholder={t('treatments.standardDosagePlaceholder')}
                className="w-full bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 text-white text-sm placeholder-dark-500 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-dark-400 text-sm mb-1">{t('treatments.targetPests')}</label>
              <input
                type="text"
                value={form.targetPests}
                onChange={(e) => setForm(f => ({ ...f, targetPests: e.target.value }))}
                placeholder={t('treatments.targetPestsPlaceholder')}
                className="w-full bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 text-white text-sm placeholder-dark-500 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-dark-400 text-sm mb-1">{t('treatments.safetyInterval')}</label>
              <input
                type="number"
                value={form.safetyIntervalDays}
                onChange={(e) => setForm(f => ({ ...f, safetyIntervalDays: e.target.value }))}
                placeholder="0"
                min="0"
                className="w-full bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 text-white text-sm placeholder-dark-500 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-dark-400 text-sm mb-1">{t('treatments.applicationInstructions')}</label>
              <textarea
                value={form.instructions}
                onChange={(e) => setForm(f => ({ ...f, instructions: e.target.value }))}
                placeholder={t('treatments.applicationInstructionsPlaceholder')}
                rows={2}
                className="w-full bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 text-white text-sm placeholder-dark-500 focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-dark-400 text-sm mb-1">{t('treatments.notesLabel')}</label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))}
                rows={1}
                className="w-full bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 text-white text-sm placeholder-dark-500 focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
              />
            </div>
          </div>

          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={resetForm}
              className="px-4 py-2 bg-dark-600 hover:bg-dark-500 text-dark-300 rounded-lg text-sm"
            >
              {t('treatments.cancel')}
            </button>
            <button
              type="submit"
              disabled={!form.name.trim() || saving}
              className="px-6 py-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white rounded-lg font-medium text-sm transition flex items-center gap-2"
            >
              {saving && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />}
              {editId ? t('treatments.save') : t('treatments.add')}
            </button>
          </div>
        </form>
      )}

      {/* Products list */}
      <div className="bg-dark-800 rounded-xl border border-dark-700 overflow-hidden">
        <div className="px-4 py-3 border-b border-dark-700">
          <span className="text-white font-medium">{t('treatments.productsCount', { count: products.length })}</span>
        </div>
        {products.length === 0 ? (
          <div className="px-4 py-8 text-center text-dark-500">{t('treatments.noProductsHint')}</div>
        ) : (
          <div className="divide-y divide-dark-700">
            {products.map(p => (
              <div key={p._id}>
                <div
                  className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-dark-700/50"
                  onClick={() => setExpandedId(expandedId === p._id ? null : p._id)}
                >
                  <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${PRODUCT_TYPE_STYLES[p.type]?.color || 'bg-gray-500'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-white font-medium">{p.name}</div>
                    <div className="text-dark-400 text-xs flex flex-wrap gap-x-3 gap-y-0.5">
                      <span>{t(`treatments.productTypes.${p.type}`) || p.type}</span>
                      {p.activeIngredient && <span>({p.activeIngredient})</span>}
                      {p.concentration && <span className="text-primary-400">{p.concentration}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); startEdit(p); }}
                      className="px-2 py-1 text-dark-400 hover:text-primary-400 text-sm"
                    >
                      {t('treatments.edit')}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); handleDelete(p._id, p.name); }}
                      className="px-2 py-1 text-dark-400 hover:text-red-400 text-sm"
                    >
                      {t('treatments.delete')}
                    </button>
                  </div>
                </div>

                {/* Expanded details */}
                {expandedId === p._id && (
                  <div className="px-4 pb-3 ml-5 space-y-1 text-sm">
                    {p.targetPests && p.targetPests.length > 0 && (
                      <div>
                        <span className="text-dark-500">{t('treatments.targetPestsLabel')}: </span>
                        <span className="text-dark-300">{p.targetPests.join(', ')}</span>
                      </div>
                    )}
                    {p.safetyIntervalDays != null && (
                      <div>
                        <span className="text-dark-500">{t('treatments.safetyIntervalLabel')}: </span>
                        <span className="text-dark-300">{p.safetyIntervalDays}</span>
                      </div>
                    )}
                    {p.instructions && (
                      <div>
                        <span className="text-dark-500">{t('treatments.instructionsLabel')}: </span>
                        <span className="text-dark-300">{p.instructions}</span>
                      </div>
                    )}
                    {p.notes && (
                      <div>
                        <span className="text-dark-500">{t('treatments.notesLabel')}: </span>
                        <span className="text-dark-300">{p.notes}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Deleted products */}
      {deleted.length > 0 && (
        <div className="mt-6">
          <button
            type="button"
            onClick={() => setShowDeleted(!showDeleted)}
            className="flex items-center gap-2 text-dark-500 hover:text-dark-300 text-sm mb-3"
          >
            <span className={`transition-transform inline-block ${showDeleted ? 'rotate-90' : ''}`} style={{ fontSize: '8px' }}>&#9654;</span>
            {t('treatments.deletedProducts', { count: deleted.length })}
          </button>
          {showDeleted && (
            <div className="bg-dark-800/50 rounded-xl border border-dark-700 divide-y divide-dark-700">
              {deleted.map(p => (
                <div key={p._id} className="flex items-center gap-3 px-4 py-3">
                  <div className={`w-2.5 h-2.5 rounded-full shrink-0 opacity-40 ${PRODUCT_TYPE_STYLES[p.type]?.color || 'bg-gray-500'}`} />
                  <span className="flex-1 text-dark-400 line-through">{p.name}</span>
                  <button
                    type="button"
                    onClick={() => handleRestore(p._id)}
                    className="px-3 py-1 bg-green-900/30 text-green-400 hover:bg-green-900/50 rounded text-xs font-medium"
                  >
                    {t('treatments.restore')}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default TreatmentProducts;
