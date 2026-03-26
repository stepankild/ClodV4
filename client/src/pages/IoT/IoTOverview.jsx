import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { iotService } from '../../services/iotService';
import { useSensors } from '../../hooks/useSensors';

const IoTOverview = () => {
  const { t } = useTranslation();
  const [zones, setZones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const liveData = useSensors();

  useEffect(() => {
    loadZones();
  }, []);

  const loadZones = async () => {
    try {
      setLoading(true);
      const data = await iotService.getZones();
      setZones(data);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load zones');
    } finally {
      setLoading(false);
    }
  };

  const getTemperature = (zone) => {
    const live = liveData[zone.zoneId];
    const data = live?.lastData || zone.lastData;
    if (!data) return null;

    // From DS18B20 temperatures array
    if (data.temperatures?.length > 0) {
      return data.temperatures[0].value;
    }
    // From SHT/SCD temperature
    if (data.temperature != null) return data.temperature;
    return null;
  };

  const getHumidity = (zone) => {
    const live = liveData[zone.zoneId];
    const data = live?.lastData || zone.lastData;
    return data?.humidity ?? null;
  };

  const getCo2 = (zone) => {
    const live = liveData[zone.zoneId];
    const data = live?.lastData || zone.lastData;
    return data?.co2 ?? null;
  };

  const isOnline = (zone) => {
    const live = liveData[zone.zoneId];
    return live?.online ?? zone.piStatus?.online ?? false;
  };

  const getLastSeen = (zone) => {
    const live = liveData[zone.zoneId];
    const ts = live?.lastSeen || zone.piStatus?.lastSeen;
    if (!ts) return null;
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now - d;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return t('iot.justNow');
    if (diffMin < 60) return `${diffMin} ${t('iot.minAgo')}`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH} ${t('iot.hAgo')}`;
    return d.toLocaleDateString();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400">
        {error}
        <button onClick={loadZones} className="ml-4 text-primary-400 hover:underline">
          {t('common.retry')}
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-dark-100">{t('iot.title')}</h1>
      </div>

      {zones.length === 0 ? (
        <div className="bg-dark-800 border border-dark-700 rounded-lg p-8 text-center text-dark-400">
          {t('iot.noZones')}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {zones.map(zone => (
            <Link
              key={zone.zoneId}
              to={`/iot/${zone.zoneId}`}
              className="bg-dark-800 border border-dark-700 rounded-lg p-5 hover:border-dark-500 transition-colors"
            >
              {/* Header */}
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-dark-100">{zone.name}</h3>
                <div className="flex items-center gap-2">
                  <div className={`w-2.5 h-2.5 rounded-full ${isOnline(zone) ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
                  <span className={`text-xs ${isOnline(zone) ? 'text-green-400' : 'text-red-400'}`}>
                    {isOnline(zone) ? t('iot.online') : t('iot.offline')}
                  </span>
                </div>
              </div>

              {/* Values */}
              <div className="grid grid-cols-3 gap-3">
                {/* Temperature */}
                <div className="text-center">
                  <div className="text-2xl font-bold text-dark-100">
                    {getTemperature(zone) != null ? `${getTemperature(zone).toFixed(1)}°` : '—'}
                  </div>
                  <div className="text-xs text-dark-500 mt-1">{t('iot.temperature')}</div>
                </div>

                {/* Humidity */}
                <div className="text-center">
                  <div className="text-2xl font-bold text-dark-100">
                    {getHumidity(zone) != null ? `${getHumidity(zone).toFixed(0)}%` : '—'}
                  </div>
                  <div className="text-xs text-dark-500 mt-1">{t('iot.humidity')}</div>
                </div>

                {/* CO2 */}
                <div className="text-center">
                  <div className="text-2xl font-bold text-dark-100">
                    {getCo2(zone) != null ? getCo2(zone).toFixed(0) : '—'}
                  </div>
                  <div className="text-xs text-dark-500 mt-1">CO₂ ppm</div>
                </div>
              </div>

              {/* Last seen */}
              <div className="mt-4 text-xs text-dark-500">
                {getLastSeen(zone) ? `${t('iot.lastUpdate')}: ${getLastSeen(zone)}` : t('iot.noData')}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
};

export default IoTOverview;
