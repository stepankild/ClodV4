import { useState, useEffect } from 'react';
import { connectScale, onScaleEvent } from '../services/scaleSocket';

/**
 * React hook для получения live-данных с IoT сенсоров через Socket.io.
 * Возвращает Map-like объект зон с текущими данными.
 *
 * @returns {Object} zones — { 'zone-1': { online, lastData, lastSeen }, ... }
 */
export function useSensors() {
  const [zones, setZones] = useState({});

  useEffect(() => {
    connectScale();

    const unsubscribe = onScaleEvent((event, data) => {
      switch (event) {
        case 'sensor_zones':
          // Merge server state with current browser state:
          // server state may have freshly restarted in-memory with less data than browser has cached
          setZones(prev => {
            const merged = { ...prev };
            Object.entries(data).forEach(([zoneId, incoming]) => {
              const existing = prev[zoneId];
              merged[zoneId] = {
                ...existing,
                ...incoming,
                // Prefer existing lastData if incoming is null/empty (server restart)
                lastData: incoming.lastData || existing?.lastData || null,
              };
            });
            return merged;
          });
          break;
        case 'sensor_data':
          setZones(prev => {
            // Merge: keep previous non-null values when new reading has null
            // This prevents cards from disappearing on occasional sensor read failures
            const prevData = prev[data.zoneId]?.lastData || {};
            const merged = {
              ...prevData,
              zoneId: data.zoneId,
              timestamp: data.timestamp,
              // Temperatures: use new array if non-empty, else keep old
              temperatures: (data.temperatures?.length ? data.temperatures : prevData.temperatures) || [],
              // Scalar sensors: only overwrite if new value is non-null
              humidity:       data.humidity       != null ? data.humidity       : prevData.humidity,
              humidity_sht45: data.humidity_sht45 != null ? data.humidity_sht45 : prevData.humidity_sht45,
              temperature:    data.temperature    != null ? data.temperature    : prevData.temperature,
              co2:            data.co2            != null ? data.co2            : prevData.co2,
              light:          data.light          != null ? data.light          : prevData.light,
              humidifierState: data.humidifierState ?? prevData.humidifierState,
            };
            return {
              ...prev,
              [data.zoneId]: {
                ...prev[data.zoneId],
                online: true,
                lastData: merged,
                lastSeen: new Date().toISOString(),
              }
            };
          });
          break;
        case 'sensor_status':
          setZones(prev => ({
            ...prev,
            [data.zoneId]: {
              ...prev[data.zoneId],
              online: data.online,
              lastSeen: new Date().toISOString()
            }
          }));
          break;
      }
    });

    return () => unsubscribe();
  }, []);

  return zones;
}
