import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { roomTemplateService } from '../../services/roomTemplateService';

export default function RoomMapSetup({ currentRows, plantsCount, onApply }) {
  const { t } = useTranslation();
  const [customRows, setCustomRows] = useState(
    currentRows && currentRows.length > 0
      ? currentRows.map(r => ({
          name: r.name || '',
          cols: r.cols || r.positions || 4,
          rows: r.rows || 1,
          fillDirection: r.fillDirection || 'topDown'
        }))
      : [{ name: t('roomMap.rowDefault', { num: 1 }), cols: 4, rows: 1, fillDirection: 'topDown' }]
  );

  const [templates, setTemplates] = useState([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [showSaveInput, setShowSaveInput] = useState(false);
  const [templateMsg, setTemplateMsg] = useState('');
  const [templateMsgIsError, setTemplateMsgIsError] = useState(false);

  const totalPositions = customRows.reduce((sum, r) => sum + (r.cols || 1) * (r.rows || 1), 0);
  const diff = totalPositions - (plantsCount || 0);

  useEffect(() => {
    loadTemplates();
  }, []);

  const loadTemplates = async () => {
    setLoadingTemplates(true);
    try {
      const data = await roomTemplateService.getTemplates();
      setTemplates(data);
    } catch (err) {
      console.error('Failed to load templates:', err);
    } finally {
      setLoadingTemplates(false);
    }
  };

  const handleLoadTemplate = (templateId) => {
    const tpl = templates.find(tpl => tpl._id === templateId);
    if (!tpl) return;
    const rows = tpl.customRows.map(r => ({
      name: r.name || '',
      cols: r.cols || 4,
      rows: r.rows || 1,
      fillDirection: r.fillDirection || 'topDown'
    }));
    setCustomRows(rows);
  };

  const handleSaveAsTemplate = async () => {
    if (!templateName.trim()) return;
    setSavingTemplate(true);
    try {
      await roomTemplateService.createTemplate({
        name: templateName.trim(),
        customRows
      });
      setTemplateName('');
      setShowSaveInput(false);
      setTemplateMsg(t('roomMap.templateSaved'));
      setTemplateMsgIsError(false);
      setTimeout(() => setTemplateMsg(''), 3000);
      await loadTemplates();
    } catch (err) {
      setTemplateMsg(err.response?.data?.message || t('roomMap.templateSaveError'));
      setTemplateMsgIsError(true);
      setTimeout(() => setTemplateMsg(''), 3000);
    } finally {
      setSavingTemplate(false);
    }
  };

  const handleDeleteTemplate = async (id, e) => {
    e.stopPropagation();
    try {
      await roomTemplateService.deleteTemplate(id);
      await loadTemplates();
    } catch (err) {
      console.error('Failed to delete template:', err);
    }
  };

  const updateRow = (idx, field, value) => {
    setCustomRows(prev => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], [field]: value };
      return updated;
    });
  };

  const addRow = () => {
    setCustomRows(prev => [...prev, { name: t('roomMap.rowDefault', { num: prev.length + 1 }), cols: 4, rows: 1, fillDirection: 'topDown' }]);
  };

  const removeRow = (idx) => {
    if (customRows.length <= 1) return;
    setCustomRows(prev => prev.filter((_, i) => i !== idx));
  };

  return (
    <div className="bg-dark-800 border border-dark-700 rounded-lg p-4">
      <h3 className="text-white font-semibold text-sm mb-3">{t('roomMap.setupTitle')}</h3>

      {/* Шаблоны */}
      {(templates.length > 0 || loadingTemplates) && (
        <div className="mb-3 space-y-2">
          <select
            className="w-full bg-dark-700 border border-dark-600 rounded-lg px-2 py-1.5 text-white text-sm"
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) handleLoadTemplate(e.target.value);
              e.target.value = '';
            }}
          >
            <option value="" disabled>
              {loadingTemplates ? t('roomMap.loadingTemplates') : t('roomMap.loadFromTemplate')}
            </option>
            {templates.map(tpl => {
              const spots = tpl.customRows.reduce((s, r) => s + (r.cols || 1) * (r.rows || 1), 0);
              return (
                <option key={tpl._id} value={tpl._id}>
                  {tpl.name} ({t('roomMap.templateRowsSpots', { rows: tpl.customRows.length, spots })})
                </option>
              );
            })}
          </select>
          <div className="flex flex-wrap gap-1">
            {templates.map(tpl => (
              <span key={tpl._id} className="inline-flex items-center gap-1 bg-dark-700/50 rounded px-1.5 py-0.5 text-xs">
                <span className="text-dark-400">{tpl.name}</span>
                <button
                  type="button"
                  onClick={(e) => handleDeleteTemplate(tpl._id, e)}
                  className="text-dark-600 hover:text-red-400 text-xs leading-none ml-0.5"
                  title={t('roomMap.deleteTemplate')}
                >&#10005;</button>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2 mb-3">
        {customRows.map((row, idx) => {
          const positions = (row.cols || 1) * (row.rows || 1);
          return (
            <div key={idx} className="bg-dark-700/30 rounded-lg p-2.5 space-y-1.5">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={row.name}
                  onChange={(e) => updateRow(idx, 'name', e.target.value)}
                  placeholder={t('roomMap.rowDefault', { num: idx + 1 })}
                  className="flex-1 min-w-0 bg-dark-700 border border-dark-600 rounded-lg px-3 py-1.5 text-white text-sm"
                />
                {customRows.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeRow(idx)}
                    className="text-dark-500 hover:text-red-400 text-lg leading-none px-1 shrink-0"
                    title={t('roomMap.deleteRowTitle')}
                  >
                    &#10005;
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs">
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={row.cols}
                    onChange={(e) => updateRow(idx, 'cols', Math.max(1, Math.min(30, parseInt(e.target.value) || 1)))}
                    className="w-12 bg-dark-700 border border-dark-600 rounded px-1.5 py-1 text-white text-xs text-center"
                  />
                  <span className="text-dark-500">{t('roomMap.horizontal')}</span>
                </div>
                <span className="text-dark-600">×</span>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={row.rows}
                    onChange={(e) => updateRow(idx, 'rows', Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))}
                    className="w-12 bg-dark-700 border border-dark-600 rounded px-1.5 py-1 text-white text-xs text-center"
                  />
                  <span className="text-dark-500">{t('roomMap.vertical')}</span>
                </div>
                <span className="text-dark-400 ml-auto">= <span className="text-white font-medium">{positions}</span> {t('roomMap.spots')}</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-dark-500">{t('roomMap.numbering')}</span>
                <button
                  type="button"
                  onClick={() => updateRow(idx, 'fillDirection', row.fillDirection === 'bottomUp' ? 'topDown' : 'bottomUp')}
                  className={`px-2 py-0.5 rounded text-xs transition ${
                    row.fillDirection === 'bottomUp'
                      ? 'bg-primary-600/30 text-primary-400 border border-primary-600/50'
                      : 'bg-dark-700 text-dark-400 border border-dark-600'
                  }`}
                >
                  {row.fillDirection === 'bottomUp' ? t('roomMap.fillBottomUpBtn') : t('roomMap.fillTopDownBtn')}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={addRow}
        className="text-sm text-primary-400 hover:text-primary-300 mb-3 block"
      >
        {t('roomMap.addRowBtn')}
      </button>

      <div className="text-dark-400 text-xs mb-3">
        <span className="text-white font-medium">{customRows.length}</span> {t('roomMap.rowsSummary')}, <span className="text-white font-medium">{totalPositions}</span> {t('roomMap.spotsTotal')}
        {plantsCount > 0 && (
          <>
            {' '}{t('roomMap.forPlants')} <span className="text-primary-400 font-medium">{plantsCount}</span> {t('roomMap.plantsWord')}
            {diff > 0 && <span className="text-dark-500"> {t('roomMap.freeSpots', { count: diff })}</span>}
            {diff < 0 && <span className="text-red-400"> {t('roomMap.missingSpots', { count: Math.abs(diff) })}</span>}
          </>
        )}
      </div>

      {/* Кнопки действий */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => onApply(customRows)}
          className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-500 transition"
        >
          {t('roomMap.apply')}
        </button>

        {showSaveInput ? (
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              placeholder={t('roomMap.templateNamePlaceholder')}
              className="bg-dark-700 border border-dark-600 rounded-lg px-2 py-1.5 text-white text-sm w-40"
              onKeyDown={(e) => e.key === 'Enter' && handleSaveAsTemplate()}
              autoFocus
            />
            <button
              type="button"
              onClick={handleSaveAsTemplate}
              disabled={savingTemplate || !templateName.trim()}
              className="px-3 py-1.5 bg-dark-600 text-white rounded-lg text-sm hover:bg-dark-500 disabled:opacity-50 transition"
            >
              {savingTemplate ? '...' : 'OK'}
            </button>
            <button
              type="button"
              onClick={() => { setShowSaveInput(false); setTemplateName(''); }}
              className="text-dark-500 hover:text-dark-300 text-sm px-1"
            >✕</button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowSaveInput(true)}
            className="px-3 py-2 text-dark-400 hover:text-dark-200 text-sm transition"
          >
            {t('roomMap.saveAsTemplate')}
          </button>
        )}
      </div>

      {/* Тост-сообщение */}
      {templateMsg && (
        <div className={`text-xs mt-2 ${templateMsgIsError ? 'text-red-400' : 'text-green-400'}`}>
          {templateMsg}
        </div>
      )}
    </div>
  );
}
