import { useState, useEffect, useCallback } from 'react';
import { connectScale, onScaleEvent } from '../services/scaleSocket';

/**
 * Module-level cache — survives component unmount/remount and page navigation.
 * All useSensors() instances share the same cache + single socket listener.
 */
let _cache = {};
let _subscribers = new Set();
let _listenerAttached = false;

function _updateCache(updater) {
  const next = typeof updater === 'function' ? updater(_cache) : updater;
  _cache = next;
  _subscribers.forEach(cb => cb(next));
}

function _attachListener() {
  if (_listenerAttached) return;
  _listenerAttached = true;

  connectScale();

  onScaleEvent((event, data) => {
    switch (event) {
      case 'sensor_zones':
        // Merge server state with cache (server may have less data after restart)
        _updateCache(prev => {
          const merged = { ...prev };
          Object.entries(data).forEach(([zoneId, incoming]) => {
            const existing = prev[zoneId];
            merged[zoneId] = {
              ...existing,
              ...incoming,
              lastData: incoming.lastData || existing?.lastData || null,
            };
          });
          return merged;
        });
        break;

      case 'sensor_data':
        _updateCache(prev => {
          // Merge: keep previous non-null values when new reading has null
          const prevData = prev[data.zoneId]?.lastData || {};
          const merged = {
            ...prevData,
            zoneId: data.zoneId,
            timestamp: data.timestamp,
            temperatures: (data.temperatures?.length ? data.temperatures : prevData.temperatures) || [],
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
        _updateCache(prev => ({
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
}

/**
 * React hook для получения live-данных с IoT сенсоров через Socket.io.
 * Uses a shared module-level cache so data persists across page navigation.
 *
 * @returns {Object} zones — { 'zone-1': { online, lastData, lastSeen }, ... }
 */
export function useSensors() {
  const [zones, setZones] = useState(_cache);

  useEffect(() => {
    _attachListener();

    // Sync from cache on mount (in case cache was updated before this component mounted)
    if (Object.keys(_cache).length > 0 && Object.keys(zones).length === 0) {
      setZones(_cache);
    }

    // Subscribe to future updates
    const sub = (next) => setZones(next);
    _subscribers.add(sub);
    return () => _subscribers.delete(sub);
  }, []);

  return zones;
}
