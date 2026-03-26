import { useState, useEffect, useMemo } from 'react';
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

const ZoneDetail = () => {
  const { zoneId } = useParams();
  const { t, i18n } = useTranslation();
  const [zone, setZone] = useState(null);
  const [readings, setReadings] = useState([]);
  const [range, setRange] = useState('24h');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
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

  const chartData = useMemo(() => {
    return readings.map(r => ({
      time: new Date(r.timestamp).getTime(),
      temperature: r.temperatures?.[0]?.value ?? r.temperature ?? null,
      humidity: r.humidity,
      co2: r.co2,
    }));
  }, [readings]);

  const formatTime = (ts) => {
    const d = new Date(ts);
    if (range === '6h' || range === '24h') {
      return d.toLocaleTimeString(i18n.language === 'en' ? 'en-US' : 'ru-RU', { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString(i18n.language === 'en' ? 'en-US' : 'ru-RU', { day: '2-digit', month: '2-digit' });
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
          <div key={i} className="bg-dark-800 border border-dark-700 rounded-lg p-4 text-center">
            <div className="text-3xl font-bold text-dark-100">
              {temp.value != null ? `${temp.value.toFixed(1)}°C` : '—'}
            </div>
            <div className="text-xs text-dark-500 mt-1">
              {temp.location ? t(`iot.${temp.location}`, temp.location) : `DS18B20 #${i + 1}`}
            </div>
          </div>
        ))}

        {lastData?.humidity != null && (
          <div className="bg-dark-800 border border-dark-700 rounded-lg p-4 text-center">
            <div className="text-3xl font-bold text-blue-400">{lastData.humidity.toFixed(1)}%</div>
            <div className="text-xs text-dark-500 mt-1">{t('iot.humidity')}</div>
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
      </div>

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
              <YAxis stroke="#6B7280" fontSize={11} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1e1e2e', border: '1px solid #374151', borderRadius: '8px' }}
                labelFormatter={(v) => new Date(v).toLocaleString(i18n.language === 'en' ? 'en-US' : 'ru-RU')}
              />
              <Legend />
              <Line
                type="monotone"
                dataKey="temperature"
                name={t('iot.temperature')}
                stroke="#f59e0b"
                dot={false}
                strokeWidth={2}
              />
              {chartData.some(d => d.humidity != null) && (
                <Line
                  type="monotone"
                  dataKey="humidity"
                  name={t('iot.humidity')}
                  stroke="#3b82f6"
                  dot={false}
                  strokeWidth={2}
                />
              )}
              {chartData.some(d => d.co2 != null) && (
                <Line
                  type="monotone"
                  dataKey="co2"
                  name="CO₂"
                  stroke="#10b981"
                  dot={false}
                  strokeWidth={2}
                  yAxisId="right"
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Sensors list */}
      {zone.sensors?.length > 0 && (
        <div className="bg-dark-800 border border-dark-700 rounded-lg p-4">
          <h2 className="text-lg font-semibold text-dark-200 mb-3">{t('iot.sensors')}</h2>
          <div className="space-y-2">
            {zone.sensors.map((s, i) => (
              <div key={i} className="flex items-center justify-between py-2 border-b border-dark-700 last:border-0">
                <div>
                  <span className="text-dark-200 font-medium">{s.type}</span>
                  {s.location && <span className="text-dark-500 ml-2">({s.location})</span>}
                </div>
                <div className="text-dark-500 text-sm">{s.sensorId}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default ZoneDetail;
