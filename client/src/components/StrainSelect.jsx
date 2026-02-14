import { useState, useEffect, useRef } from 'react';
import { strainService } from '../services/strainService';

// Кэш на уровне модуля — один запрос на все инстансы компонента
let cachedStrains = null;
let cachePromise = null;
let cacheTimestamp = 0;
const CACHE_TTL = 30_000; // 30 сек

async function loadStrains() {
  const now = Date.now();
  if (cachedStrains && now - cacheTimestamp < CACHE_TTL) return cachedStrains;
  if (cachePromise) return cachePromise;
  cachePromise = strainService.getAll()
    .then(data => {
      cachedStrains = data;
      cacheTimestamp = Date.now();
      cachePromise = null;
      return data;
    })
    .catch(err => {
      cachePromise = null;
      throw err;
    });
  return cachePromise;
}

// Инвалидировать кэш (после создания нового сорта)
export function invalidateStrainCache() {
  cachedStrains = null;
  cacheTimestamp = 0;
}

const StrainSelect = ({ value, onChange, placeholder = 'Сорт', className = '' }) => {
  const [strains, setStrains] = useState(cachedStrains || []);
  const [loading, setLoading] = useState(!cachedStrains);
  const selectRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    loadStrains()
      .then(data => { if (!cancelled) { setStrains(data); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const handleChange = async (e) => {
    const val = e.target.value;
    if (val === '__add__') {
      const name = prompt('Название нового сорта:');
      if (!name || !name.trim()) {
        // Вернуть предыдущее значение
        if (selectRef.current) selectRef.current.value = value || '';
        return;
      }
      try {
        const created = await strainService.create({ name: name.trim() });
        invalidateStrainCache();
        const fresh = await loadStrains();
        setStrains(fresh);
        onChange(created.name);
      } catch (err) {
        alert(err.response?.data?.message || 'Ошибка создания сорта');
        if (selectRef.current) selectRef.current.value = value || '';
      }
      return;
    }
    onChange(val);
  };

  const baseClass = 'bg-dark-700 border border-dark-600 rounded px-2 py-1 text-white text-sm';

  return (
    <select
      ref={selectRef}
      value={value || ''}
      onChange={handleChange}
      className={`${baseClass} ${className}`}
      disabled={loading}
    >
      <option value="">{loading ? 'Загрузка...' : placeholder}</option>
      {strains.map(s => (
        <option key={s._id} value={s.name}>{s.name}</option>
      ))}
      <option value="__add__">+ Добавить новый</option>
    </select>
  );
};

export default StrainSelect;
