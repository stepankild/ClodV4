import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { treatmentService } from '../../services/treatmentService';

const APPLICATION_METHODS = {
  spray: 'Опрыскивание',
  soil_drench: 'Полив в грунт',
  release: 'Выпуск',
  other: 'Другое'
};

const Treatments = () => {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('treatments:manage');

  const [tab, setTab] = useState('products'); // products | protocols
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState(null);

  // Products state
  const [products, setProducts] = useState([]);
  const [productFilter, setProductFilter] = useState('all');
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [editProductId, setEditProductId] = useState(null);
  const [productForm, setProductForm] = useState({
    name: '', type: 'chemical', description: '', defaultDosage: '', applicationMethod: 'spray', notes: ''
  });

  // Protocols state
  const [protocols, setProtocols] = useState([]);
  const [phaseFilter, setPhaseFilter] = useState('all');
  const [showAddProtocol, setShowAddProtocol] = useState(false);
  const [editProtocolId, setEditProtocolId] = useState(null);
  const [protocolForm, setProtocolForm] = useState({
    name: '', phase: 'flower', notes: '', entries: []
  });

  const load = async () => {
    try {
      setLoading(true);
      const [prods, protos] = await Promise.all([
        treatmentService.getProducts(),
        treatmentService.getProtocols()
      ]);
      setProducts(prods);
      setProtocols(protos);
    } catch (err) {
      console.error(err);
      setResult({ type: 'error', text: 'Ошибка загрузки данных' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const showResult = (type, text) => {
    setResult({ type, text });
    setTimeout(() => setResult(null), 3000);
  };

  // ── Product handlers ──

  const resetProductForm = () => {
    setProductForm({ name: '', type: 'chemical', description: '', defaultDosage: '', applicationMethod: 'spray', notes: '' });
    setShowAddProduct(false);
    setEditProductId(null);
  };

  const handleSaveProduct = async () => {
    if (!productForm.name.trim()) return showResult('error', 'Укажите название');
    try {
      if (editProductId) {
        await treatmentService.updateProduct(editProductId, productForm);
        showResult('success', 'Препарат обновлён');
      } else {
        await treatmentService.createProduct(productForm);
        showResult('success', 'Препарат добавлен');
      }
      resetProductForm();
      load();
    } catch (err) {
      showResult('error', err.response?.data?.message || 'Ошибка сохранения');
    }
  };

  const handleEditProduct = (p) => {
    setEditProductId(p._id);
    setProductForm({
      name: p.name, type: p.type, description: p.description || '',
      defaultDosage: p.defaultDosage || '', applicationMethod: p.applicationMethod || 'spray',
      notes: p.notes || ''
    });
    setShowAddProduct(true);
  };

  const handleDeleteProduct = async (id) => {
    if (!confirm('Удалить препарат?')) return;
    try {
      await treatmentService.deleteProduct(id);
      showResult('success', 'Препарат удалён');
      load();
    } catch (err) {
      showResult('error', err.response?.data?.message || 'Ошибка удаления');
    }
  };

  // ── Protocol handlers ──

  const resetProtocolForm = () => {
    setProtocolForm({ name: '', phase: 'flower', notes: '', entries: [] });
    setShowAddProtocol(false);
    setEditProtocolId(null);
  };

  const handleSaveProtocol = async () => {
    if (!protocolForm.name.trim()) return showResult('error', 'Укажите название протокола');
    try {
      const data = {
        ...protocolForm,
        entries: protocolForm.entries.map(e => ({
          product: e.product,
          intervalDays: parseInt(e.intervalDays) || 7,
          dosage: e.dosage || '',
          startDay: parseInt(e.startDay) || 1,
          endDay: e.endDay ? parseInt(e.endDay) : null,
          notes: e.notes || ''
        }))
      };
      if (editProtocolId) {
        await treatmentService.updateProtocol(editProtocolId, data);
        showResult('success', 'Протокол обновлён');
      } else {
        await treatmentService.createProtocol(data);
        showResult('success', 'Протокол создан');
      }
      resetProtocolForm();
      load();
    } catch (err) {
      showResult('error', err.response?.data?.message || 'Ошибка сохранения');
    }
  };

  const handleEditProtocol = (p) => {
    setEditProtocolId(p._id);
    setProtocolForm({
      name: p.name, phase: p.phase, notes: p.notes || '',
      entries: p.entries.map(e => ({
        product: e.product?._id || e.product,
        intervalDays: e.intervalDays,
        dosage: e.dosage || '',
        startDay: e.startDay || 1,
        endDay: e.endDay || '',
        notes: e.notes || ''
      }))
    });
    setShowAddProtocol(true);
  };

  const handleDeleteProtocol = async (id) => {
    if (!confirm('Удалить протокол?')) return;
    try {
      await treatmentService.deleteProtocol(id);
      showResult('success', 'Протокол удалён');
      load();
    } catch (err) {
      showResult('error', err.response?.data?.message || 'Ошибка удаления');
    }
  };

  const handleSetDefault = async (id) => {
    try {
      await treatmentService.setDefaultProtocol(id);
      showResult('success', 'Протокол назначен по умолчанию');
      load();
    } catch (err) {
      showResult('error', err.response?.data?.message || 'Ошибка');
    }
  };

  const addProtocolEntry = () => {
    setProtocolForm(prev => ({
      ...prev,
      entries: [...prev.entries, { product: '', intervalDays: 7, dosage: '', startDay: 1, endDay: '', notes: '' }]
    }));
  };

  const updateProtocolEntry = (index, field, value) => {
    setProtocolForm(prev => ({
      ...prev,
      entries: prev.entries.map((e, i) => i === index ? { ...e, [field]: value } : e)
    }));
  };

  const removeProtocolEntry = (index) => {
    setProtocolForm(prev => ({
      ...prev,
      entries: prev.entries.filter((_, i) => i !== index)
    }));
  };

  // Filter
  const filteredProducts = products.filter(p =>
    productFilter === 'all' ? true : p.type === productFilter
  );

  const filteredProtocols = protocols.filter(p =>
    phaseFilter === 'all' ? true : p.phase === phaseFilter
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Обработка</h1>
      </div>

      {/* Result toast */}
      {result && (
        <div className={`p-3 rounded-lg text-sm ${
          result.type === 'error' ? 'bg-red-900/50 text-red-300' :
          result.type === 'success' ? 'bg-green-900/50 text-green-300' :
          'bg-blue-900/50 text-blue-300'
        }`}>
          {result.text}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2">
        <button
          onClick={() => setTab('products')}
          className={`px-4 py-2 rounded-lg font-medium transition-colors ${
            tab === 'products' ? 'bg-primary-600 text-white' : 'bg-dark-800 text-dark-400 hover:text-white'
          }`}
        >
          Препараты
        </button>
        <button
          onClick={() => setTab('protocols')}
          className={`px-4 py-2 rounded-lg font-medium transition-colors ${
            tab === 'protocols' ? 'bg-primary-600 text-white' : 'bg-dark-800 text-dark-400 hover:text-white'
          }`}
        >
          Протоколы
        </button>
      </div>

      {/* ────── PRODUCTS TAB ────── */}
      {tab === 'products' && (
        <div className="space-y-4">
          {/* Filters + Add */}
          <div className="flex items-center justify-between">
            <div className="flex gap-2">
              {[['all', 'Все'], ['chemical', 'Химия'], ['biological', 'Биология']].map(([val, label]) => (
                <button
                  key={val}
                  onClick={() => setProductFilter(val)}
                  className={`px-3 py-1.5 rounded text-sm ${
                    productFilter === val ? 'bg-dark-600 text-white' : 'bg-dark-800 text-dark-400 hover:text-white'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {canManage && (
              <button
                onClick={() => { resetProductForm(); setShowAddProduct(true); }}
                className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm"
              >
                + Добавить
              </button>
            )}
          </div>

          {/* Add/Edit form */}
          {showAddProduct && canManage && (
            <div className="bg-dark-800 rounded-lg p-4 space-y-3">
              <h3 className="text-white font-medium">{editProductId ? 'Редактировать препарат' : 'Новый препарат'}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <input
                  className="bg-dark-700 text-white rounded px-3 py-2 text-sm"
                  placeholder="Название"
                  value={productForm.name}
                  onChange={e => setProductForm(f => ({ ...f, name: e.target.value }))}
                />
                <select
                  className="bg-dark-700 text-white rounded px-3 py-2 text-sm"
                  value={productForm.type}
                  onChange={e => setProductForm(f => ({ ...f, type: e.target.value }))}
                >
                  <option value="chemical">Химия</option>
                  <option value="biological">Биология</option>
                </select>
                <input
                  className="bg-dark-700 text-white rounded px-3 py-2 text-sm"
                  placeholder="Дозировка (напр. 2мл/л)"
                  value={productForm.defaultDosage}
                  onChange={e => setProductForm(f => ({ ...f, defaultDosage: e.target.value }))}
                />
                <select
                  className="bg-dark-700 text-white rounded px-3 py-2 text-sm"
                  value={productForm.applicationMethod}
                  onChange={e => setProductForm(f => ({ ...f, applicationMethod: e.target.value }))}
                >
                  {Object.entries(APPLICATION_METHODS).map(([val, label]) => (
                    <option key={val} value={val}>{label}</option>
                  ))}
                </select>
                <input
                  className="bg-dark-700 text-white rounded px-3 py-2 text-sm md:col-span-2"
                  placeholder="Описание"
                  value={productForm.description}
                  onChange={e => setProductForm(f => ({ ...f, description: e.target.value }))}
                />
              </div>
              <div className="flex gap-2">
                <button onClick={handleSaveProduct} className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded text-sm">
                  {editProductId ? 'Сохранить' : 'Добавить'}
                </button>
                <button onClick={resetProductForm} className="px-4 py-2 bg-dark-700 hover:bg-dark-600 text-dark-300 rounded text-sm">
                  Отмена
                </button>
              </div>
            </div>
          )}

          {/* Products list */}
          <div className="bg-dark-800 rounded-lg divide-y divide-dark-700">
            {filteredProducts.length === 0 ? (
              <p className="text-dark-400 text-sm p-4">Нет препаратов</p>
            ) : filteredProducts.map(p => (
              <div key={p._id} className="p-4 flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-white font-medium">{p.name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      p.type === 'chemical' ? 'bg-orange-900/50 text-orange-300' : 'bg-green-900/50 text-green-300'
                    }`}>
                      {p.type === 'chemical' ? 'Химия' : 'Биология'}
                    </span>
                    <span className="text-xs text-dark-500">{APPLICATION_METHODS[p.applicationMethod]}</span>
                  </div>
                  {(p.defaultDosage || p.description) && (
                    <p className="text-sm text-dark-400 mt-1">
                      {p.defaultDosage && <span className="text-dark-300">{p.defaultDosage}</span>}
                      {p.defaultDosage && p.description && ' — '}
                      {p.description}
                    </p>
                  )}
                </div>
                {canManage && (
                  <div className="flex gap-2 ml-4">
                    <button onClick={() => handleEditProduct(p)} className="text-dark-400 hover:text-white text-sm">
                      Изм.
                    </button>
                    <button onClick={() => handleDeleteProduct(p._id)} className="text-dark-400 hover:text-red-400 text-sm">
                      Удл.
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ────── PROTOCOLS TAB ────── */}
      {tab === 'protocols' && (
        <div className="space-y-4">
          {/* Filters + Add */}
          <div className="flex items-center justify-between">
            <div className="flex gap-2">
              {[['all', 'Все'], ['veg', 'Вегетация'], ['flower', 'Цветение']].map(([val, label]) => (
                <button
                  key={val}
                  onClick={() => setPhaseFilter(val)}
                  className={`px-3 py-1.5 rounded text-sm ${
                    phaseFilter === val ? 'bg-dark-600 text-white' : 'bg-dark-800 text-dark-400 hover:text-white'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {canManage && (
              <button
                onClick={() => { resetProtocolForm(); setShowAddProtocol(true); }}
                className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm"
              >
                + Создать протокол
              </button>
            )}
          </div>

          {/* Add/Edit protocol form */}
          {showAddProtocol && canManage && (
            <div className="bg-dark-800 rounded-lg p-4 space-y-4">
              <h3 className="text-white font-medium">{editProtocolId ? 'Редактировать протокол' : 'Новый протокол'}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <input
                  className="bg-dark-700 text-white rounded px-3 py-2 text-sm"
                  placeholder="Название протокола"
                  value={protocolForm.name}
                  onChange={e => setProtocolForm(f => ({ ...f, name: e.target.value }))}
                />
                <select
                  className="bg-dark-700 text-white rounded px-3 py-2 text-sm"
                  value={protocolForm.phase}
                  onChange={e => setProtocolForm(f => ({ ...f, phase: e.target.value }))}
                >
                  <option value="veg">Вегетация</option>
                  <option value="flower">Цветение</option>
                </select>
              </div>
              <textarea
                className="w-full bg-dark-700 text-white rounded px-3 py-2 text-sm"
                placeholder="Заметки"
                rows={2}
                value={protocolForm.notes}
                onChange={e => setProtocolForm(f => ({ ...f, notes: e.target.value }))}
              />

              {/* Protocol entries */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-dark-300">Записи протокола</span>
                  <button onClick={addProtocolEntry} className="text-sm text-primary-400 hover:text-primary-300">
                    + Добавить запись
                  </button>
                </div>
                {protocolForm.entries.length === 0 && (
                  <p className="text-dark-500 text-sm">Нет записей. Добавьте препарат и интервал.</p>
                )}
                {protocolForm.entries.map((entry, i) => (
                  <div key={i} className="bg-dark-700 rounded p-3 space-y-2">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      <select
                        className="bg-dark-600 text-white rounded px-2 py-1.5 text-sm col-span-2"
                        value={entry.product}
                        onChange={e => updateProtocolEntry(i, 'product', e.target.value)}
                      >
                        <option value="">-- Препарат --</option>
                        {products.map(p => (
                          <option key={p._id} value={p._id}>
                            {p.name} ({p.type === 'chemical' ? 'Хим' : 'Био'})
                          </option>
                        ))}
                      </select>
                      <input
                        className="bg-dark-600 text-white rounded px-2 py-1.5 text-sm"
                        type="number" min="1"
                        placeholder="Интервал (дни)"
                        value={entry.intervalDays}
                        onChange={e => updateProtocolEntry(i, 'intervalDays', e.target.value)}
                      />
                      <input
                        className="bg-dark-600 text-white rounded px-2 py-1.5 text-sm"
                        placeholder="Дозировка"
                        value={entry.dosage}
                        onChange={e => updateProtocolEntry(i, 'dosage', e.target.value)}
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <input
                        className="bg-dark-600 text-white rounded px-2 py-1.5 text-sm"
                        type="number" min="1"
                        placeholder="С дня"
                        value={entry.startDay}
                        onChange={e => updateProtocolEntry(i, 'startDay', e.target.value)}
                      />
                      <input
                        className="bg-dark-600 text-white rounded px-2 py-1.5 text-sm"
                        type="number" min="1"
                        placeholder="До дня (пусто = конец)"
                        value={entry.endDay}
                        onChange={e => updateProtocolEntry(i, 'endDay', e.target.value)}
                      />
                      <button
                        onClick={() => removeProtocolEntry(i)}
                        className="text-sm text-red-400 hover:text-red-300"
                      >
                        Удалить
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex gap-2">
                <button onClick={handleSaveProtocol} className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded text-sm">
                  {editProtocolId ? 'Сохранить' : 'Создать'}
                </button>
                <button onClick={resetProtocolForm} className="px-4 py-2 bg-dark-700 hover:bg-dark-600 text-dark-300 rounded text-sm">
                  Отмена
                </button>
              </div>
            </div>
          )}

          {/* Protocols list */}
          <div className="space-y-3">
            {filteredProtocols.length === 0 ? (
              <div className="bg-dark-800 rounded-lg p-4">
                <p className="text-dark-400 text-sm">Нет протоколов</p>
              </div>
            ) : filteredProtocols.map(p => (
              <div key={p._id} className="bg-dark-800 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-white font-medium">{p.name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      p.phase === 'veg' ? 'bg-green-900/50 text-green-300' : 'bg-purple-900/50 text-purple-300'
                    }`}>
                      {p.phase === 'veg' ? 'Вегетация' : 'Цветение'}
                    </span>
                    {p.isDefault && (
                      <span className="text-xs px-2 py-0.5 rounded bg-yellow-900/50 text-yellow-300">
                        По умолчанию
                      </span>
                    )}
                  </div>
                  {canManage && (
                    <div className="flex gap-2">
                      {!p.isDefault && (
                        <button onClick={() => handleSetDefault(p._id)} className="text-dark-400 hover:text-yellow-400 text-sm">
                          По умолч.
                        </button>
                      )}
                      <button onClick={() => handleEditProtocol(p)} className="text-dark-400 hover:text-white text-sm">
                        Изм.
                      </button>
                      <button onClick={() => handleDeleteProtocol(p._id)} className="text-dark-400 hover:text-red-400 text-sm">
                        Удл.
                      </button>
                    </div>
                  )}
                </div>
                {p.notes && <p className="text-sm text-dark-400 mb-2">{p.notes}</p>}
                {p.entries.length > 0 && (
                  <div className="space-y-1">
                    {p.entries.map((e, i) => (
                      <div key={e._id || i} className="flex items-center gap-2 text-sm text-dark-300">
                        <span className="text-dark-500">{i + 1}.</span>
                        <span className="text-white">{e.product?.name || '?'}</span>
                        <span className="text-dark-500">—</span>
                        <span>каждые {e.intervalDays} дн.</span>
                        {e.dosage && <span className="text-dark-400">({e.dosage})</span>}
                        <span className="text-dark-500">
                          дни {e.startDay}–{e.endDay || '...'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default Treatments;
