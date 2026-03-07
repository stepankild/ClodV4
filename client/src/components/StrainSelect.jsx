import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { strainService } from '../services/strainService';

// Module-level cache — single request for all component instances
let cachedStrains = null;
let cachePromise = null;
let cacheTimestamp = 0;
const CACHE_TTL = 30_000; // 30 sec

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

// Invalidate cache (after creating a new strain)
export function invalidateStrainCache() {
  cachedStrains = null;
  cacheTimestamp = 0;
}

const StrainSelect = ({ value, onChange, placeholder, className = '' }) => {
  const { t } = useTranslation();
  const [strains, setStrains] = useState(cachedStrains || []);
  const [loading, setLoading] = useState(!cachedStrains);
  const selectRef = useRef(null);

  const displayPlaceholder = placeholder || t('strainSelect.placeholder');

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
      const name = prompt(t('strains.newStrainPlaceholder') + ':');
      if (!name || !name.trim()) {
        // Restore previous value
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
        alert(err.response?.data?.message || t('strains.createError'));
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
      <option value="">{loading ? t('common.loading') : displayPlaceholder}</option>
      {strains.map(s => (
        <option key={s._id} value={s.name}>{s.name}</option>
      ))}
      <option value="__add__">{t('strains.addStrain')}</option>
    </select>
  );
};

export default StrainSelect;
