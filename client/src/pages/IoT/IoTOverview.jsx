import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { iotService } from '../../services/iotService';
import { useSensors } from '../../hooks/useSensors';
import IrrigationPanel from '../../components/IoT/IrrigationPanel';

const IoTOverview = () => {
  const { t } = useTranslation();
  const [zones, setZones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tick, setTick] = useState(0);
  const liveData = useSensors();

  useEffect(() => {
    loadZones();
  }, []);

  // Force re-render every 15s to keep "X min ago" text accurate
  useEffect(() => {
    const timer = setInterval(() => setTick(t => t + 1), 15000);
    return () => clearInterval(timer);
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

  const getData = (zone) => {
    const live = liveData[zone.zoneId];
    return live?.lastData || zone.lastData;
  };

  const getAllTemperatures = (zone) => {
    const data = getData(zone);
    if (!data) return [];
    const temps = [];

    // DS18B20 sensors from temperatures array
    if (data.temperatures?.length > 0) {
      data.temperatures.forEach(temp => {
        temps.push({
          label: temp.location ? t(`iot.${temp.location}`, temp.location) : `DS18B20`,
          value: temp.value,
          sensorId: temp.sensorId,
        });
      });
    }

    // Ambient temperature from STCC4/SCD41/SHT (if not already in DS18B20 list)
    if (data.temperature != null) {
      temps.push({
        label: t('iot.ambient'),
        value: data.temperature,
        sensorId: '_ambient',
      });
    }

    return temps;
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

  const co2Color = (val) => {
    if (val > 1500) return 'text-red-400';
    if (val > 1000) return 'text-yellow-400';
    return 'text-green-400';
  };

  // VPD = SVP × (1 - RH/100), using SHT45 air temp preferred
  const calcVpd = (zone) => {
    const data = getData(zone);
    if (!data) return null;
    const rh = data.humidity_sht45 ?? data.humidity;
    if (rh == null) return null;
    const sht45Temp = data.temperatures?.find(t => t.sensorId === 'sht45' || t.location?.includes('sht45'))?.value;
    const airTemp = sht45Temp ?? data.temperature;
    if (airTemp == null) return null;
    const svp = 0.6108 * Math.exp(17.27 * airTemp / (airTemp + 237.3));
    return Math.max(0, svp * (1 - rh / 100));
  };

  const vpdColor = (val) => {
    if (val < 0.4) return 'text-blue-400';     // too low
    if (val <= 0.8) return 'text-green-400';    // seedling/clone
    if (val <= 1.2) return 'text-green-500';    // veg ideal
    if (val <= 1.6) return 'text-yellow-400';   // flower
    return 'text-red-400';                       // too high
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
          {zones.map(zone => {
            const data = getData(zone);
            const temps = getAllTemperatures(zone);
            const humidity = data?.humidity ?? null;
            const humiditySht45 = data?.humidity_sht45 ?? null;
            const co2 = data?.co2 ?? null;
            const vpd = calcVpd(zone);
            const online = isOnline(zone);

            return (
              <Link
                key={zone.zoneId}
                to={`/iot/${zone.zoneId}`}
                className="bg-dark-800 border border-dark-700 rounded-lg p-5 hover:border-dark-500 transition-colors"
              >
                {/* Header */}
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-semibold text-dark-100">{zone.name}</h3>
                  <div className="flex items-center gap-2">
                    <div className={`w-2.5 h-2.5 rounded-full ${online ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
                    <span className={`text-xs ${online ? 'text-green-400' : 'text-red-400'}`}>
                      {online ? t('iot.online') : t('iot.offline')}
                    </span>
                  </div>
                </div>

                {/* Temperature sensors */}
                {temps.length > 0 && (
                  <div className="space-y-1.5 mb-3">
                    {temps.map((temp) => (
                      <div key={temp.sensorId} className="flex items-center justify-between">
                        <span className="text-sm text-dark-400 flex items-center gap-1.5">
                          <svg className="w-3.5 h-3.5 text-amber-500" fill="currentColor" viewBox="0 0 20 20">
                            <path d="M10 2a3 3 0 00-3 3v5.268a4 4 0 106 0V5a3 3 0 00-3-3zm0 14a2 2 0 100-4 2 2 0 000 4z" />
                          </svg>
                          {temp.label}
                        </span>
                        <span className="text-lg font-bold text-dark-100">
                          {temp.value != null ? `${temp.value.toFixed(1)}°` : '—'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Humidity + CO2 row */}
                <div className="flex items-center justify-between pt-2 border-t border-dark-700">
                  <div className="flex flex-col gap-1">
                    {humidity != null && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-dark-500">STCC4</span>
                        <span className="text-sm font-semibold text-blue-400">
                          {humidity.toFixed(0)}%
                        </span>
                      </div>
                    )}
                    {humiditySht45 != null && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-dark-500">SHT45</span>
                        <span className="text-sm font-semibold text-cyan-400">
                          {humiditySht45.toFixed(0)}%
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-1 items-end">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm text-dark-400">CO₂</span>
                      <span className={`text-sm font-semibold ${co2 != null ? co2Color(co2) : 'text-dark-400'}`}>
                        {co2 != null ? `${co2.toFixed(0)}` : '—'}
                      </span>
                    </div>
                    {vpd != null && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm text-dark-400">VPD</span>
                        <span className={`text-sm font-semibold ${vpdColor(vpd)}`}>
                          {vpd.toFixed(2)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Humidifier indicator */}
                {zone.config?.humidifierMode && zone.config.humidifierMode !== 'manual_off' && (
                  <div className="mt-2 flex items-center gap-1.5 text-xs">
                    <span>💧</span>
                    <span className={zone.config.humidifierMode === 'auto' ? 'text-cyan-400' : 'text-green-400'}>
                      {zone.config.humidifierMode === 'auto' ? t('iot.humidifierAuto') : t('iot.humidifierOn')}
                    </span>
                    {zone.config.humidifierMode === 'auto' && (
                      <span className="text-dark-500">{zone.config.rhLow ?? 60}-{zone.config.rhHigh ?? 70}%</span>
                    )}
                  </div>
                )}

                {/* Last seen */}
                <div className="mt-2 text-xs text-dark-500">
                  {getLastSeen(zone) ? `${t('iot.lastUpdate')}: ${getLastSeen(zone)}` : t('iot.noData')}
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {/* Irrigation - separate section (Материнская) */}
      <div className="mt-8">
        <h2 className="text-lg font-semibold text-dark-200 mb-4">🌱 Материнская</h2>
        <IrrigationPanel zoneId="zone-1" />
      </div>
    </div>
  );
};

export default IoTOverview;
