import { useState, useEffect } from 'react';
import { strainService } from '../../services/strainService';
import { invalidateStrainCache } from '../../components/StrainSelect';

const Strains = () => {
  const [strains, setStrains] = useState([]);
  const [deleted, setDeleted] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [newName, setNewName] = useState('');
  const [editId, setEditId] = useState(null);
  const [editName, setEditName] = useState('');
  const [showDeleted, setShowDeleted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [migrateResult, setMigrateResult] = useState(null);

  // Merge state
  const [mergeMode, setMergeMode] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [mergeTarget, setMergeTarget] = useState('');
  const [merging, setMerging] = useState(false);
  const [mergeResult, setMergeResult] = useState(null);
  const [manualMergeName, setManualMergeName] = useState('');

  const load = async () => {
    try {
      setLoading(true);
      setError('');
      const [active, del] = await Promise.all([
        strainService.getAll(),
        strainService.getDeleted().catch(() => [])
      ]);
      setStrains(active);
      setDeleted(del);
      invalidateStrainCache();
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newName.trim() || saving) return;
    setSaving(true);
    try {
      await strainService.create({ name: newName.trim() });
      setNewName('');
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async (id) => {
    if (!editName.trim() || saving) return;
    setSaving(true);
    try {
      await strainService.update(id, { name: editName.trim() });
      setEditId(null);
      setEditName('');
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id, name) => {
    if (!confirm(`Удалить сорт «${name}»?`)) return;
    try {
      await strainService.delete(id);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка');
    }
  };

  const handleRestore = async (id) => {
    try {
      await strainService.restore(id);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка');
    }
  };

  const handleMigrate = async () => {
    if (migrating) return;
    setMigrating(true);
    setMigrateResult(null);
    try {
      const result = await strainService.migrate();
      setMigrateResult(result);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка миграции');
    } finally {
      setMigrating(false);
    }
  };

  // Merge handlers
  const toggleMergeMode = () => {
    if (mergeMode) {
      // Exit merge mode
      setMergeMode(false);
      setSelected(new Set());
      setMergeTarget('');
      setMergeResult(null);
      setManualMergeName('');
    } else {
      setMergeMode(true);
      setSelected(new Set());
      setMergeTarget('');
      setMergeResult(null);
      setManualMergeName('');
    }
  };

  const toggleSelect = (name) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
        // If we removed the target, reset it
        if (mergeTarget === name) setMergeTarget('');
      } else {
        next.add(name);
      }
      return next;
    });
  };

  const handleMerge = async () => {
    if (merging || !mergeTarget || selected.size < 2) return;
    const sourceNames = [...selected];
    if (!confirm(`Объединить ${sourceNames.length} сортов в «${mergeTarget}»?\n\nВсе записи в базе будут обновлены. Это действие нельзя отменить.`)) return;
    setMerging(true);
    setMergeResult(null);
    try {
      const result = await strainService.merge(sourceNames, mergeTarget);
      setMergeResult(result);
      setSelected(new Set());
      setMergeTarget('');
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка объединения');
    } finally {
      setMerging(false);
    }
  };

  const selectedArr = [...selected];

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
          <h1 className="text-2xl font-bold text-white">Библиотека сортов</h1>
          <p className="text-dark-400 mt-1 text-sm">Справочник сортов для единообразия во всех формах</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            type="button"
            onClick={toggleMergeMode}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2 ${
              mergeMode
                ? 'bg-yellow-600 hover:bg-yellow-700 text-white'
                : 'bg-dark-700 hover:bg-dark-600 text-dark-300 border border-dark-600'
            }`}
          >
            {mergeMode ? 'Отмена' : 'Объединить'}
          </button>
          <button
            type="button"
            onClick={handleMigrate}
            disabled={migrating}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition flex items-center gap-2"
          >
            {migrating && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />}
            Импорт из базы
          </button>
        </div>
      </div>

      {migrateResult && (
        <div className="bg-blue-900/30 border border-blue-800 text-blue-300 px-4 py-3 rounded-lg mb-4 text-sm">
          <div className="flex items-center justify-between">
            <span>
              Найдено: <b>{migrateResult.found}</b> | Уже было: <b>{migrateResult.alreadyExisted}</b> | Добавлено: <b>{migrateResult.inserted}</b>
            </span>
            <button type="button" onClick={() => setMigrateResult(null)} className="ml-3 text-blue-500 hover:text-blue-300">×</button>
          </div>
        </div>
      )}

      {mergeResult && (
        <div className="bg-green-900/30 border border-green-800 text-green-300 px-4 py-3 rounded-lg mb-4 text-sm">
          <div className="flex items-center justify-between">
            <span>{mergeResult.message} (обновлено документов: {mergeResult.stats?.totalUpdated || 0})</span>
            <button type="button" onClick={() => setMergeResult(null)} className="ml-3 text-green-500 hover:text-green-300">×</button>
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-900/30 border border-red-800 text-red-400 px-4 py-3 rounded-lg mb-4">
          {error}
          <button type="button" onClick={() => setError('')} className="ml-3 text-red-500 hover:text-red-300">×</button>
        </div>
      )}

      {/* Merge panel */}
      {mergeMode && selected.size >= 2 && (
        <div className="bg-yellow-900/20 border border-yellow-800 rounded-lg px-4 py-3 mb-4">
          <div className="text-yellow-300 text-sm mb-2">
            Выбрано {selected.size} сортов. Выберите какой оставить:
          </div>
          <div className="flex flex-wrap gap-2 mb-3">
            {selectedArr.map(name => (
              <button
                key={name}
                type="button"
                onClick={() => setMergeTarget(name)}
                className={`px-3 py-1.5 rounded text-sm font-medium transition ${
                  mergeTarget === name
                    ? 'bg-yellow-600 text-white ring-2 ring-yellow-400'
                    : 'bg-dark-700 text-dark-300 hover:bg-dark-600 border border-dark-600'
                }`}
              >
                {name}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={handleMerge}
            disabled={!mergeTarget || merging}
            className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition flex items-center gap-2"
          >
            {merging && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />}
            Объединить в «{mergeTarget || '...'}»
          </button>
        </div>
      )}

      {/* Manual merge input — for strains not in library */}
      {mergeMode && (
        <div className="bg-dark-800/50 border border-dark-700 rounded-lg px-4 py-3 mb-4">
          <div className="text-dark-400 text-sm mb-2">
            Если сорт не отображается в списке, введите его имя вручную:
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={manualMergeName}
              onChange={(e) => setManualMergeName(e.target.value)}
              placeholder="Название сорта (как в базе)"
              className="flex-1 bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 text-white text-sm placeholder-dark-500 focus:ring-2 focus:ring-yellow-500"
            />
            <button
              type="button"
              onClick={() => {
                const name = manualMergeName.trim();
                if (name && !selected.has(name)) {
                  setSelected(prev => new Set([...prev, name]));
                  setManualMergeName('');
                }
              }}
              disabled={!manualMergeName.trim()}
              className="px-4 py-2 bg-yellow-600/50 hover:bg-yellow-600 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition"
            >
              + Добавить
            </button>
          </div>
        </div>
      )}

      {/* Add form */}
      {!mergeMode && (
        <form onSubmit={handleCreate} className="flex gap-2 mb-6">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Название нового сорта"
            className="flex-1 bg-dark-700 border border-dark-600 rounded-lg px-4 py-2 text-white placeholder-dark-500 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
          <button
            type="submit"
            disabled={!newName.trim() || saving}
            className="px-6 py-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white rounded-lg font-medium transition"
          >
            Добавить
          </button>
        </form>
      )}

      {/* Active strains */}
      <div className="bg-dark-800 rounded-xl border border-dark-700 overflow-hidden">
        <div className="px-4 py-3 border-b border-dark-700">
          <span className="text-white font-medium">Сорта ({strains.length})</span>
        </div>
        {strains.length === 0 ? (
          <div className="px-4 py-8 text-center text-dark-500">Нет сортов. Добавьте первый.</div>
        ) : (
          <div className="divide-y divide-dark-700">
            {strains.map(s => (
              <div key={s._id} className={`flex items-center gap-3 px-4 py-3 ${mergeMode && selected.has(s.name) ? 'bg-yellow-900/10' : ''}`}>
                {mergeMode ? (
                  <>
                    <input
                      type="checkbox"
                      checked={selected.has(s.name)}
                      onChange={() => toggleSelect(s.name)}
                      className="w-4 h-4 rounded border-dark-600 text-yellow-500 focus:ring-yellow-500 bg-dark-700 cursor-pointer"
                    />
                    <span className={`flex-1 ${selected.has(s.name) ? 'text-yellow-300' : 'text-white'}`}>{s.name}</span>
                  </>
                ) : editId === s._id ? (
                  <>
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleUpdate(s._id); if (e.key === 'Escape') setEditId(null); }}
                      className="flex-1 bg-dark-700 border border-primary-600 rounded px-3 py-1.5 text-white text-sm focus:ring-1 focus:ring-primary-500"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => handleUpdate(s._id)}
                      disabled={saving}
                      className="px-3 py-1.5 bg-primary-600 hover:bg-primary-700 text-white rounded text-sm font-medium"
                    >
                      Сохранить
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditId(null)}
                      className="px-3 py-1.5 bg-dark-600 hover:bg-dark-500 text-dark-300 rounded text-sm"
                    >
                      Отмена
                    </button>
                  </>
                ) : (
                  <>
                    <span className="flex-1 text-white">{s.name}</span>
                    <button
                      type="button"
                      onClick={() => { setEditId(s._id); setEditName(s.name); }}
                      className="px-2 py-1 text-dark-400 hover:text-primary-400 text-sm"
                    >
                      Изменить
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(s._id, s.name)}
                      className="px-2 py-1 text-dark-400 hover:text-red-400 text-sm"
                    >
                      Удалить
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Deleted strains */}
      {deleted.length > 0 && (
        <div className="mt-6">
          <button
            type="button"
            onClick={() => setShowDeleted(!showDeleted)}
            className="flex items-center gap-2 text-dark-500 hover:text-dark-300 text-sm mb-3"
          >
            <span className={`transition-transform inline-block ${showDeleted ? 'rotate-90' : ''}`} style={{ fontSize: '8px' }}>&#9654;</span>
            Удалённые сорта ({deleted.length})
          </button>
          {showDeleted && (
            <div className="bg-dark-800/50 rounded-xl border border-dark-700 divide-y divide-dark-700">
              {deleted.map(s => (
                <div key={s._id} className={`flex items-center gap-3 px-4 py-3 ${mergeMode && selected.has(s.name) ? 'bg-yellow-900/10' : ''}`}>
                  {mergeMode ? (
                    <>
                      <input
                        type="checkbox"
                        checked={selected.has(s.name)}
                        onChange={() => toggleSelect(s.name)}
                        className="w-4 h-4 rounded border-dark-600 text-yellow-500 focus:ring-yellow-500 bg-dark-700 cursor-pointer"
                      />
                      <span className={`flex-1 line-through ${selected.has(s.name) ? 'text-yellow-300' : 'text-dark-400'}`}>{s.name}</span>
                    </>
                  ) : (
                    <>
                      <span className="flex-1 text-dark-400 line-through">{s.name}</span>
                      <button
                        type="button"
                        onClick={() => handleRestore(s._id)}
                        className="px-3 py-1 bg-green-900/30 text-green-400 hover:bg-green-900/50 rounded text-xs font-medium"
                      >
                        Восстановить
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Strains;
