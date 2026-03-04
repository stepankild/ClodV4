import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import VegMapCell from './VegMapCell';
import { STRAIN_COLORS } from '../RoomMap/PlantCell';
import RoomMapSetup from '../RoomMap/RoomMapSetup';
import { roomTemplateService } from '../../services/roomTemplateService';

function getRowPositions(row) {
  return (row.cols || 1) * (row.rows || 1);
}

function flipPositionVertically(pos, cols, rowsCount) {
  const rIdx = Math.floor(pos / cols);
  const cIdx = pos % cols;
  return (rowsCount - 1 - rIdx) * cols + cIdx;
}

export default function VegMap({ vegMapData, batches, onSave, saving }) {
  const { t } = useTranslation();

  const [customRows, setCustomRows] = useState(
    (vegMapData?.customRows || []).map(r => ({
      ...r,
      fillDirection: r.fillDirection || vegMapData?.fillDirection || 'topDown'
    }))
  );
  const [batchPositions, setBatchPositions] = useState(vegMapData?.batchPositions || []);
  const [editMode, setEditMode] = useState(false);
  const [showSetup, setShowSetup] = useState((vegMapData?.customRows || []).length === 0);
  const [activeBatchId, setActiveBatchId] = useState(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [showTemplates, setShowTemplates] = useState(false);
  const templateDropdownRef = useRef(null);

  useEffect(() => {
    roomTemplateService.getTemplates().then(setTemplates).catch(() => {});
  }, []);

  useEffect(() => {
    if (!showTemplates) return;
    const handler = (e) => {
      if (templateDropdownRef.current && !templateDropdownRef.current.contains(e.target)) {
        setShowTemplates(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showTemplates]);

  // Маппинг batchId -> индекс для цветов (стабильный по _id)
  const batchIndexMap = useMemo(() => {
    const m = {};
    batches.forEach((b, i) => { m[b._id] = i; });
    return m;
  }, [batches]);

  // Маппинг batchId -> name
  const batchNameMap = useMemo(() => {
    const m = {};
    batches.forEach(b => { m[b._id] = b.name || '—'; });
    return m;
  }, [batches]);

  // Маппинг cell -> batchId
  const positionMap = useMemo(() => {
    const m = {};
    batchPositions.forEach(p => {
      const bid = typeof p.batchId === 'object' ? (p.batchId?._id || p.batchId) : p.batchId;
      m[`${p.row}:${p.position}`] = String(bid);
    });
    return m;
  }, [batchPositions]);

  // Кол-во ячеек по батчам
  const batchCellCounts = useMemo(() => {
    const counts = {};
    Object.values(positionMap).forEach(bid => {
      counts[bid] = (counts[bid] || 0) + 1;
    });
    return counts;
  }, [positionMap]);

  const totalSpots = useMemo(() => {
    return customRows.reduce((s, r) => s + getRowPositions(r), 0);
  }, [customRows]);

  const totalGoodPlants = useMemo(() => {
    return batches.reduce((s, b) => {
      const total = (b.strains || []).reduce((sum, st) => sum + (st.quantity || 0), 0) || b.quantity || 0;
      return s + Math.max(0, total - (b.diedCount || 0) - (b.disposedCount || 0));
    }, 0);
  }, [batches]);

  const handleApplySetup = (newCustomRows) => {
    const cleaned = batchPositions.filter(p => {
      if (p.row >= newCustomRows.length) return false;
      if (p.position >= getRowPositions(newCustomRows[p.row])) return false;
      return true;
    });
    setCustomRows(newCustomRows);
    setBatchPositions(cleaned);
    setShowSetup(false);
  };

  const handleApplyTemplate = (template) => {
    const rows = template.customRows.map(r => ({
      name: r.name || '',
      cols: r.cols || 4,
      rows: r.rows || 1,
      fillDirection: r.fillDirection || 'topDown'
    }));
    if (batchPositions.length > 0) {
      if (!window.confirm(t('vegMap.applyTemplateConfirm'))) return;
    }
    const cleaned = batchPositions.filter(p => {
      if (p.row >= rows.length) return false;
      if (p.position >= getRowPositions(rows[p.row])) return false;
      return true;
    });
    setCustomRows(rows);
    setBatchPositions(cleaned);
    setShowTemplates(false);
  };

  const handleCellClick = useCallback((rowIdx, posIdx) => {
    if (!editMode) return;
    const key = `${rowIdx}:${posIdx}`;
    const existing = positionMap[key];

    if (existing) {
      // Убрать ячейку
      setBatchPositions(prev => prev.filter(p => !(p.row === rowIdx && p.position === posIdx)));
    } else if (activeBatchId) {
      // Назначить ячейку активному батчу
      setBatchPositions(prev => [...prev, { row: rowIdx, position: posIdx, batchId: activeBatchId }]);
    }
  }, [editMode, positionMap, activeBatchId]);

  const handleFillRow = (rowIdx) => {
    if (!activeBatchId) return;
    const total = getRowPositions(customRows[rowIdx]);
    const cols = customRows[rowIdx].cols || 1;
    const rowsCount = customRows[rowIdx].rows || 1;
    const isBottomUp = customRows[rowIdx].fillDirection === 'bottomUp';

    // Убрать старые позиции этого ряда
    const cleaned = batchPositions.filter(p => p.row !== rowIdx);
    const newPositions = [...cleaned];
    for (let p = 0; p < total; p++) {
      const pos = isBottomUp ? flipPositionVertically(p, cols, rowsCount) : p;
      newPositions.push({ row: rowIdx, position: pos, batchId: activeBatchId });
    }
    setBatchPositions(newPositions);
  };

  const handleClearRow = (rowIdx) => {
    setBatchPositions(prev => prev.filter(p => p.row !== rowIdx));
  };

  const handleClearAll = () => {
    setBatchPositions([]);
    setActiveBatchId(null);
  };

  const handleToggleRowDirection = (rowIdx) => {
    const cols = customRows[rowIdx].cols || 1;
    const rowsCount = customRows[rowIdx].rows || 1;
    setCustomRows(prev => prev.map((r, i) =>
      i === rowIdx ? { ...r, fillDirection: r.fillDirection === 'bottomUp' ? 'topDown' : 'bottomUp' } : r
    ));
    setBatchPositions(prev => prev.map(p =>
      p.row === rowIdx ? { ...p, position: flipPositionVertically(p.position, cols, rowsCount) } : p
    ));
  };

  const handleSave = async () => {
    // Нормализуем batchId — только строки
    const normalized = batchPositions.map(p => ({
      row: p.row,
      position: p.position,
      batchId: typeof p.batchId === 'object' ? (p.batchId?._id || p.batchId) : p.batchId
    }));
    await onSave({ customRows, batchPositions: normalized });
    setEditMode(false);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  };

  const handleCancel = () => {
    setEditMode(false);
    setCustomRows((vegMapData?.customRows || []).map(r => ({
      ...r,
      fillDirection: r.fillDirection || vegMapData?.fillDirection || 'topDown'
    })));
    setBatchPositions(vegMapData?.batchPositions || []);
    setActiveBatchId(null);
  };

  const hasGrid = customRows.length > 0;

  if (showSetup || !hasGrid) {
    return (
      <div className="space-y-4">
        <RoomMapSetup
          currentRows={customRows.length > 0 ? customRows : null}
          plantsCount={totalGoodPlants}
          onApply={handleApplySetup}
        />
      </div>
    );
  }

  const assignedCount = Object.keys(positionMap).length;

  return (
    <div className="space-y-4">
      {/* Заголовок + кнопки */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h4 className="text-sm font-medium text-white">
          {t('vegMap.title')}
          <span className="text-dark-400 font-normal ml-2">
            {assignedCount}/{totalSpots} {t('vegMap.spotsUsed')}
          </span>
        </h4>
        <div className="flex gap-2 flex-wrap">
          {editMode ? (
            <>
              <button type="button" onClick={handleClearAll}
                className="px-2 py-1 text-xs bg-dark-700 text-red-400 rounded hover:bg-dark-600 transition">{t('vegMap.clear')}</button>
              <button type="button" onClick={() => setShowSetup(true)}
                className="px-2 py-1 text-xs bg-dark-700 text-dark-300 rounded hover:bg-dark-600 transition">{t('roomMap.rows')}</button>
              {templates.length > 0 && (
                <div className="relative" ref={templateDropdownRef}>
                  <button type="button" onClick={() => setShowTemplates(!showTemplates)}
                    className="px-2 py-1 text-xs bg-dark-700 text-primary-400 rounded hover:bg-dark-600 transition">{t('roomMap.templates')}</button>
                  {showTemplates && (
                    <div className="absolute right-0 top-full mt-1 w-56 bg-dark-800 border border-dark-600 rounded-lg shadow-xl z-50 py-1 max-h-60 overflow-y-auto">
                      {templates.map(tpl => {
                        const spots = tpl.customRows.reduce((s, r) => s + (r.cols || 1) * (r.rows || 1), 0);
                        return (
                          <button key={tpl._id} type="button"
                            onClick={() => handleApplyTemplate(tpl)}
                            className="w-full text-left px-3 py-2 text-xs hover:bg-dark-700 transition">
                            <div className="text-white">{tpl.name}</div>
                            <div className="text-dark-500">{t('roomMap.templateRowsSpots', { rows: tpl.customRows.length, spots })}</div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
              <button type="button" onClick={handleSave} disabled={saving}
                className="px-3 py-1 text-xs bg-primary-600 text-white rounded hover:bg-primary-500 disabled:opacity-50 transition">
                {saving ? '...' : t('common.save')}</button>
              <button type="button" onClick={handleCancel}
                className="px-3 py-1 text-xs text-dark-400 hover:bg-dark-700 rounded transition">{t('common.cancel')}</button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => setEditMode(true)}
                className="px-3 py-1 text-xs bg-dark-700 text-white rounded hover:bg-dark-600 transition">{t('common.edit')}</button>
              <button type="button" onClick={() => setShowSetup(true)}
                className="px-2 py-1 text-xs bg-dark-700 text-dark-300 rounded hover:bg-dark-600 transition">{t('roomMap.rows')}</button>
              {templates.length > 0 && (
                <div className="relative" ref={templateDropdownRef}>
                  <button type="button" onClick={() => setShowTemplates(!showTemplates)}
                    className="px-2 py-1 text-xs bg-dark-700 text-primary-400 rounded hover:bg-dark-600 transition">{t('roomMap.templates')}</button>
                  {showTemplates && (
                    <div className="absolute right-0 top-full mt-1 w-56 bg-dark-800 border border-dark-600 rounded-lg shadow-xl z-50 py-1 max-h-60 overflow-y-auto">
                      {templates.map(tpl => {
                        const spots = tpl.customRows.reduce((s, r) => s + (r.cols || 1) * (r.rows || 1), 0);
                        return (
                          <button key={tpl._id} type="button"
                            onClick={() => handleApplyTemplate(tpl)}
                            className="w-full text-left px-3 py-2 text-xs hover:bg-dark-700 transition">
                            <div className="text-white">{tpl.name}</div>
                            <div className="text-dark-500">{t('roomMap.templateRowsSpots', { rows: tpl.customRows.length, spots })}</div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {saveSuccess && (
        <div className="bg-green-900/30 border border-green-800 text-green-400 px-3 py-2 rounded-lg text-xs flex items-center justify-between">
          <span>{t('vegMap.mapSaved')}</span>
          <button type="button" onClick={() => setSaveSuccess(false)} className="text-green-500 hover:text-green-300 ml-2">✕</button>
        </div>
      )}

      {/* Палитра батчей (в режиме редактирования) */}
      {editMode && (
        <div className="bg-dark-700/50 border border-dark-600 rounded-lg p-3">
          <div className="text-xs text-dark-400 mb-2">{t('vegMap.selectBatch')}</div>
          <div className="flex flex-wrap gap-2">
            {batches.map((b, idx) => {
              const color = STRAIN_COLORS[idx % STRAIN_COLORS.length];
              const isActive = activeBatchId === b._id;
              return (
                <button key={b._id} type="button"
                  onClick={() => setActiveBatchId(isActive ? null : b._id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${color.bg} ${color.border} ${color.text} ${
                    isActive ? 'ring-2 ring-white scale-105' : 'hover:brightness-125'
                  }`}>
                  {b.name || '—'}
                  <span className="ml-1 opacity-60">({batchCellCounts[b._id] || 0})</span>
                </button>
              );
            })}
            {batches.length === 0 && (
              <span className="text-xs text-dark-500">{t('vegMap.noBatches')}</span>
            )}
          </div>
        </div>
      )}

      {/* Карта: каждый ряд */}
      <div className="flex gap-3 overflow-x-auto pb-2">
        {customRows.map((row, rowIdx) => {
          const cols = row.cols || 1;
          const rowsCount = row.rows || 1;
          const isBottomUp = row.fillDirection === 'bottomUp';
          const rowCellCount = batchPositions.filter(p => p.row === rowIdx).length;

          return (
            <div key={rowIdx} className="flex flex-col items-center shrink-0">
              <div className="flex items-center gap-1 mb-1.5">
                <span className="text-xs text-dark-400 font-medium whitespace-nowrap">
                  {row.name || `${t('vegMap.tableDefault')} ${rowIdx + 1}`}
                </span>
                {editMode && (
                  <>
                    <button type="button"
                      onClick={() => handleFillRow(rowIdx)}
                      className="text-[10px] px-1.5 py-0.5 rounded text-dark-500 hover:text-dark-300 hover:bg-dark-700 transition"
                      title={t('vegMap.fillRow')}>▣</button>
                    <button type="button"
                      onClick={() => handleClearRow(rowIdx)}
                      className="text-[10px] px-1 py-0.5 rounded text-dark-500 hover:text-red-400 hover:bg-dark-700 transition"
                      title={t('vegMap.clearRow')}>✕</button>
                    <button type="button"
                      onClick={() => handleToggleRowDirection(rowIdx)}
                      className={`text-[10px] px-1 py-0.5 rounded transition ${
                        isBottomUp ? 'bg-primary-600/30 text-primary-400' : 'text-dark-500 hover:text-dark-300 hover:bg-dark-700'
                      }`}
                      title={isBottomUp ? t('roomMap.fillBottomUp') : t('roomMap.fillTopDown')}>
                      {isBottomUp ? '↑' : '↓'}
                    </button>
                  </>
                )}
              </div>

              <div className="text-[10px] text-dark-600 mb-1">
                {cols}×{rowsCount}
                {isBottomUp && <span className="text-primary-500 ml-1">↑</span>}
              </div>

              <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
                {Array.from({ length: rowsCount }, (_, rIdx) =>
                  Array.from({ length: cols }, (_, cIdx) => {
                    const posIdx = rIdx * cols + cIdx;
                    const batchId = positionMap[`${rowIdx}:${posIdx}`];
                    const batchIdx = batchId ? batchIndexMap[batchId] : undefined;
                    const batchName = batchId ? batchNameMap[batchId] : undefined;
                    return (
                      <VegMapCell
                        key={posIdx}
                        batchLabel={batchName}
                        batchIndex={batchIdx}
                        isEmpty={!batchId}
                        isActive={editMode && activeBatchId && !batchId}
                        onClick={() => handleCellClick(rowIdx, posIdx)}
                      />
                    );
                  })
                )}
              </div>

              {!editMode && (
                <span className="text-[10px] text-dark-500 mt-1">
                  {rowCellCount}/{cols * rowsCount}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Легенда батчей */}
      {batches.length > 0 && !editMode && (
        <div className="flex flex-wrap gap-3 text-xs">
          {batches.map((b, idx) => {
            const color = STRAIN_COLORS[idx % STRAIN_COLORS.length];
            const count = batchCellCounts[b._id] || 0;
            if (count === 0) return null;
            return (
              <div key={b._id} className="flex items-center gap-1.5">
                <span className={`w-2.5 h-2.5 rounded-full ${color.dot}`} />
                <span className="text-dark-300">{b.name || '—'}</span>
                <span className="text-dark-500">{count}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
