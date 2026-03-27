import { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { iotService } from '../../services/iotService';
import { useSensors } from '../../hooks/useSensors';

const RANGES = [
  { key: '6h', hours: 6 },
  { key: '24h', hours: 24 },
  { key: '7d', hours: 24 * 7 },
  { key: '30d', hours: 24 * 30 },
];

const TEMP_COLORS = ['#ef4444', '#f97316', '#a855f7', '#ec4899', '#14b8a6'];
const SERIES_COLORS = {
  temperature: '#f59e0b',
  humidity: '#3b82f6',
  co2: '#10b981',
  light: '#eab308',
};

const loadChartPrefs = (zoneId) => {
  try {
    const saved = localStorage.getItem(`iot-chart-${zoneId}`);
    return saved ? JSON.parse(saved) : null;
  } catch { return null; }
};

const saveChartPrefs = (zoneId, prefs) => {
  try {
    localStorage.setItem(`iot-chart-${zoneId}`, JSON.stringify(prefs));
  } catch { /* ignore */ }
};

// VPD: leafTemp (canopy) + airTemp + humidity → kPa
const calcVpd = (leafTemp, airTemp, rh) => {
  if (leafTemp == null || airTemp == null || rh == null) return null;
  const svpLeaf = 0.6108 * Math.exp(17.27 * leafTemp / (leafTemp + 237.3));
  const svpAir = 0.6108 * Math.exp(17.27 * airTemp / (airTemp + 237.3));
  return Math.max(0, svpLeaf - svpAir * rh / 100);
};

const vpdColor = (val) => {
  if (val < 0.4) return 'text-blue-400';
  if (val <= 0.8) return 'text-green-400';
  if (val <= 1.2) return 'text-green-500';
  if (val <= 1.6) return 'text-yellow-400';
  return 'text-red-400';
};

const ZoneDetail = () => {
  const { zoneId } = useParams();
  const { t, i18n } = useTranslation();
  const [zone, setZone] = useState(null);
  const [readings, setReadings] = useState([]);
  const [range, setRange] = useState('24h');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [visibleSeries, setVisibleSeries] = useState({});
  const [editingSensor, setEditingSensor] = useState(null);
  const [editName, setEditName] = useState('');
  const [savingName, setSavingName] = useState(false);
  const liveData = useSensors();

  useEffect(() => {
    loadZone();
  }, [zoneId]);

  useEffect(() => {
    loadReadings();
  }, [zoneId, range]);

  const loadZone = async () => {
    try {
      const data = await iotService.getZone(zoneId);
      setZone(data);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load zone');
    }
  };

  const loadReadings = async () => {
    try {
      setLoading(true);
      const r = RANGES.find(r => r.key === range);
      const from = new Date(Date.now() - r.hours * 3600 * 1000).toISOString();
      const data = await iotService.getReadings(zoneId, { from });
      setReadings(data);
    } catch (err) {
      console.error('Load readings error:', err);
    } finally {
      setLoading(false);
    }
  };

  const live = liveData[zoneId];
  const isOnline = live?.online ?? zone?.piStatus?.online ?? false;
  const lastData = live?.lastData || zone?.lastData;

  const currentTemps = useMemo(() => {
    if (!lastData?.temperatures?.length) return [];
    return lastData.temperatures;
  }, [lastData]);

  // Build list of all available chart series from readings
  const availableSeries = useMemo(() => {
    const series = [];
    const sensorIds = new Set();

    // Scan readings for available per-sensor temperatures
    readings.forEach(r => {
      if (r.temperatures?.length) {
        r.temperatures.forEach(temp => {
          if (!sensorIds.has(temp.sensorId)) {
            sensorIds.add(temp.sensorId);
            series.push({
              key: `temp-${temp.sensorId}`,
              label: temp.location ? t(`iot.${temp.location}`, temp.location) : `DS18B20`,
              color: TEMP_COLORS[sensorIds.size - 1] || TEMP_COLORS[0],
              yAxisId: 'left',
              unit: '°C',
            });
          }
        });
      }
    });

    // Ambient temperature (STCC4/SCD41/SHT)
    if (readings.some(r => r.temperature != null)) {
      series.push({
        key: 'temperature',
        label: t('iot.ambient'),
        color: SERIES_COLORS.temperature,
        yAxisId: 'left',
        unit: '°C',
      });
    }

    if (readings.some(r => r.humidity != null)) {
      series.push({
        key: 'humidity',
        label: `${t('iot.humidity')} (STCC4)`,
        color: SERIES_COLORS.humidity,
        yAxisId: 'left',
        unit: '%',
      });
    }

    if (readings.some(r => r.humidity_sht45 != null)) {
      series.push({
        key: 'humidity_sht45',
        label: `${t('iot.humidity')} (SHT45)`,
        color: '#06b6d4', // cyan
        yAxisId: 'left',
        unit: '%',
      });
    }

    if (readings.some(r => r.co2 != null)) {
      series.push({
        key: 'co2',
        label: 'CO₂',
        color: SERIES_COLORS.co2,
        yAxisId: 'right',
        unit: ' ppm',
      });
    }

    // VPD (computed from canopy temp + air temp + humidity)
    const hasVpdData = readings.some(r => {
      const canopy = r.temperatures?.find(t => t.location === 'canopy')?.value;
      const airT = r.temperature;
      const rh = r.humidity_sht45 ?? r.humidity;
      return canopy != null && airT != null && rh != null;
    });
    if (hasVpdData) {
      series.push({
        key: 'vpd',
        label: 'VPD',
        color: '#8b5cf6', // purple
        yAxisId: 'right',
        unit: ' kPa',
      });
    }

    if (readings.some(r => r.light != null)) {
      series.push({
        key: 'light',
        label: t('iot.light'),
        color: SERIES_COLORS.light,
        yAxisId: 'right',
        unit: ' lux',
      });
    }

    return series;
  }, [readings, t]);

  // Initialize visible series from localStorage or defaults
  useEffect(() => {
    if (availableSeries.length === 0) return;
    const saved = loadChartPrefs(zoneId);
    if (saved) {
      setVisibleSeries(saved);
    } else {
      // Default: all visible
      const defaults = {};
      availableSeries.forEach(s => { defaults[s.key] = true; });
      setVisibleSeries(defaults);
    }
  }, [availableSeries, zoneId]);

  const toggleSeries = useCallback((key) => {
    setVisibleSeries(prev => {
      const next = { ...prev, [key]: !prev[key] };
      saveChartPrefs(zoneId, next);
      return next;
    });
  }, [zoneId]);

  // Build chart data with per-sensor columns
  const chartData = useMemo(() => {
    return readings.map(r => {
      const point = {
        time: new Date(r.timestamp).getTime(),
        temperature: r.temperature ?? null,
        humidity: r.humidity ?? null,
        humidity_sht45: r.humidity_sht45 ?? null,
        co2: r.co2 ?? null,
        light: r.light ?? null,
      };
      // Per-sensor temperatures
      if (r.temperatures?.length) {
        r.temperatures.forEach(temp => {
          point[`temp-${temp.sensorId}`] = temp.value;
        });
      }
      // Compute VPD from canopy + air temp + humidity
      const canopyT = r.temperatures?.find(t => t.location === 'canopy')?.value;
      const airT = r.temperature;
      const rh = r.humidity_sht45 ?? r.humidity;
      point.vpd = calcVpd(canopyT, airT, rh);
      return point;
    });
  }, [readings]);

  // Light cycle stats (day/night hours) from last 24h readings
  const lightCycle = useMemo(() => {
    if (!readings.length) return null;
    const LIGHT_THRESHOLD = 10; // lux — below = night
    const withLight = readings.filter(r => r.light != null);
    if (withLight.length < 2) return null;

    let dayCount = 0;
    let nightCount = 0;
    withLight.forEach(r => {
      if (r.light > LIGHT_THRESHOLD) dayCount++;
      else nightCount++;
    });

    const total = dayCount + nightCount;
    const rangeH = RANGES.find(r => r.key === range)?.hours || 24;
    const dayHours = (dayCount / total) * rangeH;
    const nightHours = (nightCount / total) * rangeH;

    return { dayHours, nightHours, dayPct: (dayCount / total) * 100 };
  }, [readings, range]);

  // Check if right Y-axis is needed
  const hasRightAxis = useMemo(() => {
    return availableSeries.some(s => s.yAxisId === 'right' && visibleSeries[s.key]);
  }, [availableSeries, visibleSeries]);

  const formatTime = (ts) => {
    const d = new Date(ts);
    if (range === '6h' || range === '24h') {
      return d.toLocaleTimeString(i18n.language === 'en' ? 'en-US' : 'ru-RU', { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString(i18n.language === 'en' ? 'en-US' : 'ru-RU', { day: '2-digit', month: '2-digit' });
  };

  const handleSaveSensorName = async (sensorIndex) => {
    if (!editName.trim() || !zone) return;
    setSavingName(true);
    try {
      const updatedSensors = zone.sensors.map((s, i) =>
        i === sensorIndex ? { ...s, location: editName.trim() } : s
      );
      const updated = await iotService.updateZone(zoneId, { sensors: updatedSensors });
      setZone(updated);
      setEditingSensor(null);
      setEditName('');
    } catch (err) {
      console.error('Save sensor name error:', err);
    } finally {
      setSavingName(false);
    }
  };

  if (error) {
    return (
      <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400">
        {error}
        <Link to="/iot" className="ml-4 text-primary-400 hover:underline">{t('common.back')}</Link>
      </div>
    );
  }

  if (!zone) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500"></div>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Link to="/iot" className="text-dark-400 hover:text-dark-200">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <h1 className="text-2xl font-bold text-dark-100">{zone.name}</h1>
        <div className={`w-3 h-3 rounded-full ${isOnline ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
        <span className={`text-sm ${isOnline ? 'text-green-400' : 'text-red-400'}`}>
          {isOnline ? t('iot.online') : t('iot.offline')}
        </span>
      </div>

      {/* Live values */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {currentTemps.map((temp, i) => (
          <div key={temp.sensorId || i} className="bg-dark-800 border border-dark-700 rounded-lg p-4 text-center">
            <div className="text-3xl font-bold text-dark-100">
              {temp.value != null ? `${temp.value.toFixed(1)}°C` : '—'}
            </div>
            <div className="text-xs text-dark-500 mt-1">
              {temp.location ? t(`iot.${temp.location}`, temp.location) : `DS18B20 #${i + 1}`}
            </div>
          </div>
        ))}

        {/* Ambient temperature from STCC4/SCD41 */}
        {lastData?.temperature != null && (
          <div className="bg-dark-800 border border-dark-700 rounded-lg p-4 text-center">
            <div className="text-3xl font-bold text-amber-400">{lastData.temperature.toFixed(1)}°C</div>
            <div className="text-xs text-dark-500 mt-1">{t('iot.ambient')}</div>
          </div>
        )}

        {lastData?.humidity != null && (
          <div className="bg-dark-800 border border-dark-700 rounded-lg p-4 text-center">
            <div className="text-3xl font-bold text-blue-400">{lastData.humidity.toFixed(1)}%</div>
            <div className="text-xs text-dark-500 mt-1">{t('iot.humidity')} (STCC4)</div>
          </div>
        )}

        {lastData?.humidity_sht45 != null && (
          <div className="bg-dark-800 border border-dark-700 rounded-lg p-4 text-center">
            <div className="text-3xl font-bold text-cyan-400">{lastData.humidity_sht45.toFixed(1)}%</div>
            <div className="text-xs text-dark-500 mt-1">{t('iot.humidity')} (SHT45)</div>
          </div>
        )}

        {lastData?.co2 != null && (
          <div className="bg-dark-800 border border-dark-700 rounded-lg p-4 text-center">
            <div className={`text-3xl font-bold ${lastData.co2 > 1500 ? 'text-red-400' : lastData.co2 > 1000 ? 'text-yellow-400' : 'text-green-400'}`}>
              {lastData.co2.toFixed(0)}
            </div>
            <div className="text-xs text-dark-500 mt-1">CO₂ ppm</div>
          </div>
        )}

        {lastData?.light != null && (
          <div className="bg-dark-800 border border-dark-700 rounded-lg p-4 text-center">
            <div className="text-3xl font-bold text-yellow-400">{lastData.light.toFixed(0)}</div>
            <div className="text-xs text-dark-500 mt-1">{t('iot.light')} lux</div>
          </div>
        )}

        {(() => {
          const canopyT = lastData?.temperatures?.find(t => t.location === 'canopy')?.value;
          const airT = lastData?.temperature;
          const rh = lastData?.humidity_sht45 ?? lastData?.humidity;
          const vpd = calcVpd(canopyT, airT, rh);
          if (vpd == null) return null;
          return (
            <div className="bg-dark-800 border border-dark-700 rounded-lg p-4 text-center">
              <div className={`text-3xl font-bold ${vpdColor(vpd)}`}>{vpd.toFixed(2)}</div>
              <div className="text-xs text-dark-500 mt-1">VPD kPa</div>
            </div>
          );
        })()}
      </div>

      {/* Light cycle (photoperiod) */}
      {lightCycle && (
        <div className="bg-dark-800 border border-dark-700 rounded-lg p-4 mb-6">
          <h2 className="text-lg font-semibold text-dark-200 mb-3">☀️ Фотопериод ({range})</h2>
          <div className="flex items-center gap-4">
            {/* Day/Night bar */}
            <div className="flex-1">
              <div className="flex h-6 rounded-full overflow-hidden bg-dark-700">
                <div
                  className="bg-yellow-400 flex items-center justify-center text-xs font-bold text-dark-900 transition-all"
                  style={{ width: `${lightCycle.dayPct}%`, minWidth: lightCycle.dayPct > 5 ? 'auto' : '0' }}
                >
                  {lightCycle.dayPct > 10 ? `${lightCycle.dayHours.toFixed(1)}ч` : ''}
                </div>
                <div
                  className="bg-indigo-900 flex items-center justify-center text-xs font-bold text-indigo-300 transition-all"
                  style={{ width: `${100 - lightCycle.dayPct}%`, minWidth: (100 - lightCycle.dayPct) > 5 ? 'auto' : '0' }}
                >
                  {(100 - lightCycle.dayPct) > 10 ? `${lightCycle.nightHours.toFixed(1)}ч` : ''}
                </div>
              </div>
            </div>
            {/* Summary */}
            <div className="text-sm text-dark-300 whitespace-nowrap">
              <span className="text-yellow-400 font-bold">{lightCycle.dayHours.toFixed(1)}</span>
              <span className="text-dark-500">/</span>
              <span className="text-indigo-400 font-bold">{lightCycle.nightHours.toFixed(1)}</span>
              <span className="text-dark-500 ml-1">ч</span>
            </div>
          </div>
        </div>
      )}

      {/* Chart */}
      <div className="bg-dark-800 border border-dark-700 rounded-lg p-4 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-dark-200">{t('iot.history')}</h2>
          <div className="flex gap-1">
            {RANGES.map(r => (
              <button
                key={r.key}
                onClick={() => setRange(r.key)}
                className={`px-3 py-1 text-xs rounded ${
                  range === r.key
                    ? 'bg-primary-600 text-white'
                    : 'bg-dark-700 text-dark-400 hover:text-dark-200'
                }`}
              >
                {t(`iot.chart${r.key}`)}
              </button>
            ))}
          </div>
        </div>

        {/* Series toggles */}
        {availableSeries.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {availableSeries.map(s => (
              <button
                key={s.key}
                onClick={() => toggleSeries(s.key)}
                className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                  visibleSeries[s.key]
                    ? 'border-transparent text-white'
                    : 'border-dark-600 text-dark-500 bg-transparent'
                }`}
                style={visibleSeries[s.key] ? { backgroundColor: s.color + '33', borderColor: s.color, color: s.color } : {}}
              >
                <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ backgroundColor: s.color, opacity: visibleSeries[s.key] ? 1 : 0.3 }} />
                {s.label}
              </button>
            ))}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-500"></div>
          </div>
        ) : chartData.length === 0 ? (
          <div className="flex items-center justify-center h-64 text-dark-500">
            {t('iot.noData')}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis
                dataKey="time"
                tickFormatter={formatTime}
                stroke="#6B7280"
                fontSize={11}
              />
              <YAxis yAxisId="left" stroke="#6B7280" fontSize={11} />
              {hasRightAxis && (
                <YAxis yAxisId="right" orientation="right" stroke="#6B7280" fontSize={11} />
              )}
              <Tooltip
                contentStyle={{ backgroundColor: '#1e1e2e', border: '1px solid #374151', borderRadius: '8px' }}
                labelFormatter={(v) => new Date(v).toLocaleString(i18n.language === 'en' ? 'en-US' : 'ru-RU')}
                formatter={(value, name) => {
                  const s = availableSeries.find(s => s.label === name);
                  return [value != null ? `${value}${s?.unit || ''}` : '—', name];
                }}
              />
              <Legend />
              {availableSeries.filter(s => visibleSeries[s.key]).map(s => (
                <Line
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.label}
                  stroke={s.color}
                  yAxisId={s.yAxisId}
                  dot={false}
                  strokeWidth={2}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Sensors list with inline editing */}
      {zone.sensors?.length > 0 && (
        <div className="bg-dark-800 border border-dark-700 rounded-lg p-4">
          <h2 className="text-lg font-semibold text-dark-200 mb-3">{t('iot.sensors')}</h2>
          <div className="space-y-2">
            {zone.sensors.map((s, i) => (
              <div key={i} className="flex items-center justify-between py-2 border-b border-dark-700 last:border-0">
                <div className="flex items-center gap-2">
                  <span className="text-dark-200 font-medium">{s.type}</span>
                  {editingSensor === i ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveSensorName(i);
                          if (e.key === 'Escape') { setEditingSensor(null); setEditName(''); }
                        }}
                        className="bg-dark-700 border border-dark-600 rounded px-2 py-1 text-sm text-dark-200 focus:outline-none focus:border-primary-500 w-32"
                        autoFocus
                      />
                      <button
                        onClick={() => handleSaveSensorName(i)}
                        disabled={savingName}
                        className="text-xs text-primary-400 hover:text-primary-300"
                      >
                        {savingName ? '...' : '✓'}
                      </button>
                      <button
                        onClick={() => { setEditingSensor(null); setEditName(''); }}
                        className="text-xs text-dark-500 hover:text-dark-300"
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <>
                      {s.location && <span className="text-dark-500">({t(`iot.${s.location}`, s.location)})</span>}
                      <button
                        onClick={() => { setEditingSensor(i); setEditName(s.location || ''); }}
                        className="text-dark-600 hover:text-dark-400 ml-1"
                        title={t('iot.editSensorName')}
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                      </button>
                    </>
                  )}
                </div>
                <div className="text-dark-500 text-sm font-mono">{s.sensorId}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default ZoneDetail;
