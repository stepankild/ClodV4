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
  const [humidifier, setHumidifier] = useState({ mode: 'manual_off', rhLow: 60, rhHigh: 70, plugState: null });
  const [humidifierSaving, setHumidifierSaving] = useState(false);
  const [humidifierLog, setHumidifierLog] = useState({ logs: [], stats: {} });
  const [alertConfig, setAlertConfig] = useState(null);
  const [alertLog, setAlertLog] = useState([]);
  const [alertSaving, setAlertSaving] = useState(false);
  const [alertTestResult, setAlertTestResult] = useState(null);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const liveData = useSensors();

  useEffect(() => {
    loadZone();
  }, [zoneId]);

  useEffect(() => {
    loadReadings();
  }, [zoneId, range]);

  const loadHumidifierStatus = async () => {
    try {
      const status = await iotService.getHumidifierStatus(zoneId);
      setHumidifier(status);
    } catch (e) { /* ignore */ }
    try {
      const logData = await iotService.getHumidifierLog(zoneId);
      setHumidifierLog(logData);
    } catch (e) { /* ignore */ }
  };

  const loadAlertConfig = async () => {
    try {
      const config = await iotService.getAlertConfig(zoneId);
      setAlertConfig(config);
    } catch (e) { /* ignore */ }
    try {
      const { logs } = await iotService.getAlertLog(zoneId, { limit: 20 });
      setAlertLog(logs || []);
    } catch (e) { /* ignore */ }
  };

  const handleAlertSave = async () => {
    if (!alertConfig) return;
    setAlertSaving(true);
    try {
      const result = await iotService.updateAlertConfig(zoneId, {
        enabled: alertConfig.enabled,
        telegramChatId: alertConfig.telegramChatId,
        rules: alertConfig.rules
      });
      setAlertConfig(result);
    } catch (e) {
      console.error('Alert save error:', e);
    } finally {
      setAlertSaving(false);
    }
  };

  const handleAlertTest = async () => {
    setAlertTestResult(null);
    try {
      const result = await iotService.testAlert(alertConfig?.telegramChatId);
      setAlertTestResult(result.ok ? 'ok' : 'error');
    } catch (e) {
      setAlertTestResult('error');
    }
    setTimeout(() => setAlertTestResult(null), 5000);
  };

  const updateAlertRule = (metric, field, value) => {
    setAlertConfig(prev => ({
      ...prev,
      rules: prev.rules.map(r =>
        r.metric === metric ? { ...r, [field]: value } : r
      )
    }));
  };

  const handleHumidifierSave = async (updates) => {
    setHumidifierSaving(true);
    try {
      const result = await iotService.controlHumidifier(zoneId, updates);
      setHumidifier(prev => ({ ...prev, ...result }));
    } catch (e) {
      console.error('Humidifier save error:', e);
    } finally {
      setHumidifierSaving(false);
    }
  };

  const loadZone = async () => {
    try {
      const data = await iotService.getZone(zoneId);
      setZone(data);
      setError(null);
      loadHumidifierStatus();
      loadAlertConfig();
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

  // Per-sensor trend: compare current value vs 5-min-ago value
  const sensorTrends = useMemo(() => {
    if (!readings || readings.length < 2) return {};
    const trends = {};
    const recent = readings.slice(-10); // ~5 min at 30s interval
    const old = recent[0];
    const cur = recent[recent.length - 1];
    const calcTrend = (curVal, oldVal) => {
      if (curVal == null || oldVal == null) return null;
      const diff = curVal - oldVal;
      if (Math.abs(diff) < 0.05) return '→';
      return diff > 0 ? '↑' : '↓';
    };
    const trendColor = (t) => t === '↑' ? 'text-red-400' : t === '↓' ? 'text-blue-400' : 'text-dark-500';
    // Scalars
    trends.humidity = { arrow: calcTrend(cur?.humidity, old?.humidity), color: trendColor };
    trends.humidity_sht45 = { arrow: calcTrend(cur?.humidity_sht45, old?.humidity_sht45), color: trendColor };
    trends.co2 = { arrow: calcTrend(cur?.co2, old?.co2), color: trendColor };
    trends.light = { arrow: calcTrend(cur?.light, old?.light), color: trendColor };
    trends.temperature = { arrow: calcTrend(cur?.temperature, old?.temperature), color: trendColor };
    // Per-sensor temps
    cur?.temperatures?.forEach(t => {
      const oldT = old?.temperatures?.find(x => x.sensorId === t.sensorId)?.value;
      trends[`temp-${t.sensorId}`] = { arrow: calcTrend(t.value, oldT), color: trendColor };
    });
    return trends;
  }, [readings]);

  const TrendArrow = ({ sensorKey }) => {
    const trend = sensorTrends[sensorKey];
    if (!trend?.arrow || trend.arrow === '→') return null;
    const color = trend.arrow === '↑' ? 'text-red-400' : 'text-blue-400';
    return <span className={`text-xs ml-1 ${color}`}>{trend.arrow}</span>;
  };

  // Per-sensor last seen timestamps (from readings history)
  const sensorLastSeen = useMemo(() => {
    if (!readings.length) return {};
    const result = {};
    // Readings are sorted ascending — iterate from end to find most recent
    const findLast = (key, getter) => {
      for (let i = readings.length - 1; i >= 0; i--) {
        if (getter(readings[i]) != null) {
          result[key] = new Date(readings[i].timestamp).getTime();
          return;
        }
      }
    };
    findLast('humidity', r => r.humidity);
    findLast('humidity_sht45', r => r.humidity_sht45);
    findLast('co2', r => r.co2);
    findLast('light', r => r.light);
    findLast('temperature', r => r.temperature);
    // Per-sensor temperatures
    const allSensorIds = new Set();
    readings.forEach(r => r.temperatures?.forEach(t => allSensorIds.add(t.sensorId)));
    allSensorIds.forEach(sensorId => {
      findLast(`temp-${sensorId}`, r => r.temperatures?.find(x => x.sensorId === sensorId)?.value);
    });
    return result;
  }, [readings]);

  const getTimeAgo = (ts) => {
    if (!ts) return null;
    const diffSec = Math.floor((Date.now() - ts) / 1000);
    if (diffSec < 90) return t('iot.justNow');
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)} ${t('iot.minAgo')}`;
    return `${Math.floor(diffSec / 3600)} ${t('iot.hAgo')}`;
  };

  // Detect frozen sensors — value unchanged for last N readings
  const frozenSensors = useMemo(() => {
    if (!readings || readings.length < 5) return {};
    const frozen = {};
    const recent = readings.slice(-20); // last 20 readings
    // Check each scalar metric
    const checkFrozen = (key, label) => {
      const vals = recent.map(r => r[key]).filter(v => v != null);
      if (vals.length >= 5 && vals.every(v => v === vals[0])) {
        frozen[label] = true;
      }
    };
    checkFrozen('humidity', 'humidity');
    checkFrozen('humidity_sht45', 'humidity_sht45');
    checkFrozen('co2', 'co2');
    checkFrozen('light', 'light');
    checkFrozen('temperature', 'temperature');
    // Check per-sensor temperatures
    recent[0]?.temperatures?.forEach(t => {
      const vals = recent.map(r => r.temperatures?.find(x => x.sensorId === t.sensorId)?.value).filter(v => v != null);
      if (vals.length >= 5 && vals.every(v => v === vals[0])) {
        frozen[`temp-${t.sensorId}`] = true;
      }
    });
    return frozen;
  }, [readings]);

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
      {(() => {
        const lastSeen = live?.lastSeen || zone?.piStatus?.lastSeen;
        if (!lastSeen) return null;
        const d = new Date(lastSeen);
        const now = Date.now();
        const diffSec = Math.floor((now - d.getTime()) / 1000);
        let ago, stale;
        if (diffSec < 60) { ago = t('iot.justNow'); stale = false; }
        else if (diffSec < 3600) { ago = `${Math.floor(diffSec / 60)} ${t('iot.minAgo')}`; stale = diffSec > 300; }
        else { ago = `${Math.floor(diffSec / 3600)} ${t('iot.hAgo')}`; stale = true; }
        const timeStr = d.toLocaleTimeString(i18n.language === 'ru' ? 'ru-RU' : 'en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        return (
          <div className={`text-xs mb-2 flex items-center gap-2 ${stale ? 'text-yellow-500' : 'text-dark-500'}`}>
            <span>{t('iot.lastUpdate')}: {timeStr}</span>
            <span className="text-dark-600">({ago})</span>
            {stale && <span className="text-yellow-500">⚠</span>}
          </div>
        );
      })()}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {currentTemps.map((temp, i) => {
          const isFrozen = frozenSensors[`temp-${temp.sensorId}`];
          return (
            <div key={temp.sensorId || i} className={`bg-dark-800 border rounded-lg p-4 text-center relative ${isFrozen ? 'border-yellow-700' : 'border-dark-700'}`}>
              {!isFrozen && isOnline && <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-green-500 animate-pulse" />}
              <div className="text-3xl font-bold text-dark-100">
                {temp.value != null ? `${temp.value.toFixed(1)}°C` : '—'}
                <TrendArrow sensorKey={`temp-${temp.sensorId}`} />
              </div>
              <div className="text-xs text-dark-500 mt-1">
                {temp.location ? t(`iot.${temp.location}`, temp.location) : `DS18B20 #${i + 1}`}
              </div>
              {isFrozen && <div className="text-xs text-yellow-500 mt-0.5">⚠ не меняется</div>}
              {sensorLastSeen[`temp-${temp.sensorId}`] && (
                <div className="text-xs text-dark-600 mt-0.5">{getTimeAgo(sensorLastSeen[`temp-${temp.sensorId}`])}</div>
              )}
            </div>
          );
        })}

        {/* Ambient temperature from STCC4/SCD41 */}
        {lastData?.temperature != null && (
          <div className={`bg-dark-800 border rounded-lg p-4 text-center relative ${frozenSensors.temperature ? 'border-yellow-700' : 'border-dark-700'}`}>
            {!frozenSensors.temperature && isOnline && <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-green-500 animate-pulse" />}
            <div className="text-3xl font-bold text-amber-400">{lastData.temperature.toFixed(1)}°C<TrendArrow sensorKey="temperature" /></div>
            <div className="text-xs text-dark-500 mt-1">{t('iot.ambient')}</div>
            {frozenSensors.temperature && <div className="text-xs text-yellow-500 mt-0.5">⚠ не меняется</div>}
            {sensorLastSeen.temperature && <div className="text-xs text-dark-600 mt-0.5">{getTimeAgo(sensorLastSeen.temperature)}</div>}
          </div>
        )}

        {lastData?.humidity != null && (
          <div className={`bg-dark-800 border rounded-lg p-4 text-center relative ${frozenSensors.humidity ? 'border-yellow-700' : 'border-dark-700'}`}>
            {!frozenSensors.humidity && isOnline && <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-green-500 animate-pulse" />}
            <div className="text-3xl font-bold text-blue-400">{lastData.humidity.toFixed(1)}%<TrendArrow sensorKey="humidity" /></div>
            <div className="text-xs text-dark-500 mt-1">{t('iot.humidity')} (STCC4)</div>
            {frozenSensors.humidity && <div className="text-xs text-yellow-500 mt-0.5">⚠ не меняется</div>}
            {sensorLastSeen.humidity && <div className="text-xs text-dark-600 mt-0.5">{getTimeAgo(sensorLastSeen.humidity)}</div>}
          </div>
        )}

        {lastData?.humidity_sht45 != null && (
          <div className={`bg-dark-800 border rounded-lg p-4 text-center relative ${frozenSensors.humidity_sht45 ? 'border-yellow-700' : 'border-dark-700'}`}>
            {!frozenSensors.humidity_sht45 && isOnline && <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-green-500 animate-pulse" />}
            <div className="text-3xl font-bold text-cyan-400">{lastData.humidity_sht45.toFixed(1)}%<TrendArrow sensorKey="humidity_sht45" /></div>
            <div className="text-xs text-dark-500 mt-1">{t('iot.humidity')} (SHT45)</div>
            {frozenSensors.humidity_sht45 && <div className="text-xs text-yellow-500 mt-0.5">⚠ не меняется</div>}
            {sensorLastSeen.humidity_sht45 && <div className="text-xs text-dark-600 mt-0.5">{getTimeAgo(sensorLastSeen.humidity_sht45)}</div>}
          </div>
        )}

        {lastData?.co2 != null && (
          <div className={`bg-dark-800 border rounded-lg p-4 text-center relative ${frozenSensors.co2 ? 'border-yellow-700' : 'border-dark-700'}`}>
            {!frozenSensors.co2 && isOnline && <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-green-500 animate-pulse" />}
            <div className={`text-3xl font-bold ${lastData.co2 > 1500 ? 'text-red-400' : lastData.co2 > 1000 ? 'text-yellow-400' : 'text-green-400'}`}>
              {lastData.co2.toFixed(0)}<TrendArrow sensorKey="co2" />
            </div>
            <div className="text-xs text-dark-500 mt-1">CO₂ ppm</div>
            {frozenSensors.co2 && <div className="text-xs text-yellow-500 mt-0.5">⚠ не меняется</div>}
            {sensorLastSeen.co2 && <div className="text-xs text-dark-600 mt-0.5">{getTimeAgo(sensorLastSeen.co2)}</div>}
          </div>
        )}

        {lastData?.light != null && (
          <div className={`bg-dark-800 border rounded-lg p-4 text-center relative ${frozenSensors.light ? 'border-yellow-700' : 'border-dark-700'}`}>
            {!frozenSensors.light && isOnline && <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-green-500 animate-pulse" />}
            <div className="text-3xl font-bold text-yellow-400">{lastData.light.toFixed(0)}<TrendArrow sensorKey="light" /></div>
            <div className="text-xs text-dark-500 mt-1">{t('iot.light')} lux</div>
            {frozenSensors.light && <div className="text-xs text-yellow-500 mt-0.5">⚠ не меняется</div>}
            {sensorLastSeen.light && <div className="text-xs text-dark-600 mt-0.5">{getTimeAgo(sensorLastSeen.light)}</div>}
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

      {/* Humidifier control */}
      <div className="bg-dark-800 border border-dark-700 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-dark-200 font-medium flex items-center gap-2">
            <span className="text-lg">💧</span>
            {t('iot.humidifier')}
          </h3>
          <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium ${
            (lastData?.humidifierState === 'on' || humidifier.plugState === 'on') ? 'bg-green-900/30 text-green-400' : 'bg-dark-700 text-dark-400'
          }`}>
            <span className={`w-2 h-2 rounded-full ${(lastData?.humidifierState === 'on' || humidifier.plugState === 'on') ? 'bg-green-400 animate-pulse' : 'bg-dark-500'}`}></span>
            {(lastData?.humidifierState === 'on' || humidifier.plugState === 'on') ? t('iot.plugOn') : t('iot.plugOff')}
          </div>
        </div>

        {/* Mode selector */}
        <div className="flex gap-1 mb-4 bg-dark-900 rounded-lg p-1">
          {['auto', 'manual_on', 'manual_off'].map(mode => (
            <button
              key={mode}
              onClick={() => handleHumidifierSave({ mode, action: mode === 'manual_on' ? 'on' : mode === 'manual_off' ? 'off' : undefined })}
              disabled={humidifierSaving}
              className={`flex-1 py-1.5 px-3 rounded-md text-sm font-medium transition-colors ${
                humidifier.mode === mode
                  ? 'bg-primary-600 text-white'
                  : 'text-dark-400 hover:text-dark-200 hover:bg-dark-700'
              }`}
            >
              {mode === 'auto' ? t('iot.humidifierAuto') : mode === 'manual_on' ? t('iot.humidifierOn') : t('iot.humidifierOff')}
            </button>
          ))}
        </div>

        {/* Thresholds (only in auto mode) */}
        {humidifier.mode === 'auto' && (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <label className="text-sm text-dark-400 w-36">{t('iot.rhLow')}</label>
              <input
                type="number"
                min="30" max="90" step="1"
                value={humidifier.rhLow}
                onChange={e => setHumidifier(prev => ({ ...prev, rhLow: Number(e.target.value) }))}
                className="bg-dark-900 border border-dark-600 rounded px-2 py-1 text-dark-200 w-20 text-center"
              />
              <span className="text-dark-500 text-sm">%</span>
              <div className="flex-1 h-1.5 bg-dark-700 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 rounded-full" style={{ width: `${((humidifier.rhLow - 30) / 60) * 100}%` }}></div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <label className="text-sm text-dark-400 w-36">{t('iot.rhHigh')}</label>
              <input
                type="number"
                min="30" max="90" step="1"
                value={humidifier.rhHigh}
                onChange={e => setHumidifier(prev => ({ ...prev, rhHigh: Number(e.target.value) }))}
                className="bg-dark-900 border border-dark-600 rounded px-2 py-1 text-dark-200 w-20 text-center"
              />
              <span className="text-dark-500 text-sm">%</span>
              <div className="flex-1 h-1.5 bg-dark-700 rounded-full overflow-hidden">
                <div className="h-full bg-cyan-500 rounded-full" style={{ width: `${((humidifier.rhHigh - 30) / 60) * 100}%` }}></div>
              </div>
            </div>
            <button
              onClick={() => handleHumidifierSave({ mode: 'auto', rhLow: humidifier.rhLow, rhHigh: humidifier.rhHigh })}
              disabled={humidifierSaving}
              className="w-full mt-2 bg-primary-600 hover:bg-primary-700 text-white py-1.5 rounded-md text-sm font-medium transition-colors disabled:opacity-50"
            >
              {humidifierSaving ? t('iot.saving') : t('iot.save')}
            </button>
          </div>
        )}

        {/* Stats + Log */}
        <div className="mt-4 pt-3 border-t border-dark-700">
          {/* Today stats */}
          {humidifierLog.stats?.todayOnCount > 0 && (
            <div className="flex items-center gap-3 text-xs mb-3">
              <div className="flex items-center gap-1.5 bg-green-900/20 text-green-400 px-2 py-1 rounded">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400"></span>
                {humidifierLog.stats.todayOnCount}x вкл
              </div>
              <div className="flex items-center gap-1.5 bg-dark-700/50 text-dark-300 px-2 py-1 rounded">
                <span className="w-1.5 h-1.5 rounded-full bg-dark-500"></span>
                {humidifierLog.stats.todayOffCount}x выкл
              </div>
              <div className="flex items-center gap-1.5 bg-cyan-900/20 text-cyan-400 px-2 py-1 rounded">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                {humidifierLog.stats.todayOnMinutes >= 60
                  ? `${Math.floor(humidifierLog.stats.todayOnMinutes / 60)}ч ${humidifierLog.stats.todayOnMinutes % 60}м`
                  : `${humidifierLog.stats.todayOnMinutes}м`}
              </div>
            </div>
          )}

          {/* Recent log entries */}
          {humidifierLog.logs?.length > 0 && (
            <div className="space-y-0 max-h-40 overflow-y-auto rounded border border-dark-700">
              <div className="grid grid-cols-[44px_36px_auto] gap-x-3 px-3 py-1.5 bg-dark-700/50 text-[10px] text-dark-500 uppercase tracking-wider sticky top-0">
                <span>Время</span>
                <span></span>
                <span>Влажность</span>
              </div>
              {humidifierLog.logs.slice(0, 15).map((log, i) => {
                const d = new Date(log.timestamp);
                const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', hour12: false });
                const today = new Date();
                const isToday = d.toDateString() === today.toDateString();
                const isYesterday = d.toDateString() === new Date(today - 86400000).toDateString();
                const dateLabel = isToday ? '' : isYesterday ? 'вчера ' : d.toLocaleDateString('ru-RU', { day: 'numeric', month: '2-digit' }) + ' ';
                const isOn = log.action === 'on';
                return (
                  <div key={log._id || i} className={`grid grid-cols-[44px_36px_auto] gap-x-3 px-3 py-1 text-xs items-center ${i % 2 === 0 ? 'bg-dark-800' : 'bg-dark-800/50'}`}>
                    <span className="text-dark-400 font-mono tabular-nums">{dateLabel}{time}</span>
                    <span className={`font-medium ${isOn ? 'text-green-400' : 'text-dark-500'}`}>
                      {isOn ? 'ON' : 'OFF'}
                    </span>
                    <span className="text-dark-400">
                      {log.humidity != null && <span className="text-blue-400">{log.humidity.toFixed(0)}%</span>}
                      {log.trigger === 'auto' && <span className="text-dark-600 ml-1.5">авто</span>}
                      {log.trigger === 'manual' && <span className="text-yellow-600 ml-1.5">вручную</span>}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Alert settings */}
      <div className="bg-dark-800 border border-dark-700 rounded-lg">
        <button
          onClick={() => setAlertsOpen(!alertsOpen)}
          className="w-full flex items-center justify-between p-4 text-left"
        >
          <h2 className="text-lg font-semibold text-dark-200 flex items-center gap-2">
            <span className="text-lg">🔔</span> Оповещения Telegram
            {alertConfig?.enabled && alertConfig?.rules?.some(r => r.enabled) && (
              <span className="text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full font-normal">
                {alertConfig.rules.filter(r => r.enabled).length} активных
              </span>
            )}
          </h2>
          <svg className={`w-5 h-5 text-dark-400 transition-transform ${alertsOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {alertsOpen && alertConfig && (
          <div className="px-4 pb-4 space-y-4 border-t border-dark-700 pt-3">
            {/* Global toggle */}
            <div className="flex items-center justify-between">
              <span className="text-sm text-dark-300">Алерты включены</span>
              <button
                onClick={() => setAlertConfig(prev => ({ ...prev, enabled: !prev.enabled }))}
                className={`w-11 h-6 rounded-full transition-colors relative ${alertConfig.enabled ? 'bg-green-500' : 'bg-dark-600'}`}
              >
                <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-transform ${alertConfig.enabled ? 'left-[22px]' : 'left-0.5'}`} />
              </button>
            </div>

            {alertConfig.enabled && (
              <>
                {/* Per-metric rules */}
                <div className="space-y-2">
                  {alertConfig.rules.map(rule => {
                    const labels = {
                      temperature: { icon: '🌡', name: 'Температура', unit: '°C' },
                      humidity: { icon: '💧', name: 'Влажность', unit: '%' },
                      co2: { icon: '🫧', name: 'CO2', unit: 'ppm' },
                      light: { icon: '☀️', name: 'Свет', unit: 'lux' },
                      vpd: { icon: '🌱', name: 'VPD', unit: 'kPa' },
                      offline: { icon: '🔌', name: 'Офлайн', unit: '' }
                    };
                    const l = labels[rule.metric] || { icon: '', name: rule.metric, unit: '' };
                    const isOffline = rule.metric === 'offline';

                    return (
                      <div key={rule.metric} className={`flex items-center gap-3 p-2 rounded-md ${rule.enabled ? 'bg-dark-700/50' : ''}`}>
                        <button
                          onClick={() => updateAlertRule(rule.metric, 'enabled', !rule.enabled)}
                          className={`w-9 h-5 rounded-full transition-colors relative flex-shrink-0 ${rule.enabled ? 'bg-green-500' : 'bg-dark-600'}`}
                        >
                          <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${rule.enabled ? 'left-[18px]' : 'left-0.5'}`} />
                        </button>
                        <span className="text-sm w-28 flex-shrink-0">{l.icon} {l.name}</span>
                        {!isOffline && rule.enabled && (
                          <div className="flex items-center gap-2 text-xs">
                            <span className="text-dark-500">мин</span>
                            <input
                              type="number"
                              value={rule.min ?? ''}
                              onChange={e => updateAlertRule(rule.metric, 'min', e.target.value === '' ? null : Number(e.target.value))}
                              placeholder="—"
                              className="bg-dark-900 border border-dark-600 rounded px-1.5 py-0.5 text-dark-200 w-16 text-center text-xs"
                            />
                            <span className="text-dark-500">макс</span>
                            <input
                              type="number"
                              value={rule.max ?? ''}
                              onChange={e => updateAlertRule(rule.metric, 'max', e.target.value === '' ? null : Number(e.target.value))}
                              placeholder="—"
                              className="bg-dark-900 border border-dark-600 rounded px-1.5 py-0.5 text-dark-200 w-16 text-center text-xs"
                            />
                            <span className="text-dark-600 text-[10px]">{l.unit}</span>
                          </div>
                        )}
                        {isOffline && rule.enabled && (
                          <span className="text-xs text-dark-500">срабатывает если данных нет >5 мин</span>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Save + Test */}
                <div className="flex items-center gap-3 pt-2">
                  <button
                    onClick={handleAlertSave}
                    disabled={alertSaving}
                    className="bg-primary-600 hover:bg-primary-700 text-white py-1.5 px-4 rounded-md text-sm font-medium transition-colors disabled:opacity-50"
                  >
                    {alertSaving ? 'Сохранение...' : 'Сохранить'}
                  </button>
                  <button
                    onClick={handleAlertTest}
                    className="bg-dark-700 hover:bg-dark-600 text-dark-300 py-1.5 px-4 rounded-md text-sm transition-colors"
                  >
                    Тест
                  </button>
                  {alertTestResult === 'ok' && <span className="text-green-400 text-sm">✓ Отправлено</span>}
                  {alertTestResult === 'error' && <span className="text-red-400 text-sm">✕ Ошибка (проверь токен)</span>}
                </div>

                {/* Alert log */}
                {alertLog.length > 0 && (
                  <div className="pt-2 border-t border-dark-700">
                    <h3 className="text-xs text-dark-500 uppercase mb-2">Последние оповещения</h3>
                    <div className="space-y-0 max-h-32 overflow-y-auto rounded border border-dark-700">
                      {alertLog.map((log, i) => {
                        const d = new Date(log.timestamp);
                        const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', hour12: false });
                        const today = new Date();
                        const isToday = d.toDateString() === today.toDateString();
                        const dateLabel = isToday ? '' : d.toLocaleDateString('ru-RU', { day: 'numeric', month: '2-digit' }) + ' ';
                        const isAlert = log.type === 'alert';
                        return (
                          <div key={log._id || i} className={`flex items-center gap-2 px-3 py-1 text-xs ${i % 2 === 0 ? 'bg-dark-800' : 'bg-dark-800/50'}`}>
                            <span className={isAlert ? 'text-yellow-400' : 'text-green-400'}>{isAlert ? '⚠️' : '✅'}</span>
                            <span className="text-dark-400 font-mono tabular-nums w-24">{dateLabel}{time}</span>
                            <span className="text-dark-300 truncate">{log.metric}{log.value != null ? `: ${log.value}` : ''} {log.threshold || ''}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
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
