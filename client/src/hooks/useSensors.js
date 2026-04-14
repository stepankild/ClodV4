import { useState, useEffect } from 'react';
import { connectScale, onScaleEvent } from '../services/scaleSocket';
import api from '../services/api';

/**
 * Module-level cache — survives component unmount/remount and page navigation.
 * All useSensors() instances share the same cache + single socket listener.
 */
let _cache = {};
let _subscribers = new Set();
let _listenerAttached = false;
let _fetchingRest = false;

function _updateCache(updater) {
  const next = typeof updater === 'function' ? updater(_cache) : updater;
  _cache = next;
  _subscribers.forEach(cb => cb(next));
}

/**
 * Fetch zone data via REST API (fallback when socket has no data)
 */
async function _fetchZonesViaRest() {
  if (_fetchingRest) return;
  _fetchingRest = true;
  try {
    const token = localStorage.getItem('accessToken');
    if (!token) return;
    const resp = await api.get('/zones');
    const zones = resp.data;
    if (!zones?.length) return;

    _updateCache(prev => {
      const merged = { ...prev };
      for (const zone of zones) {
        const existing = prev[zone.zoneId];
        const newData = zone.lastData;
        const hasNewData = newData && JSON.stringify(newData) !== JSON.stringify(existing?.lastData);
        merged[zone.zoneId] = {
          ...existing,
          online: zone.piStatus?.online ?? false,
          lastData: newData || existing?.lastData || null,
          // Update lastSeen to NOW if we got new data, otherwise keep server's value
          lastSeen: hasNewData ? new Date().toISOString() : (zone.piStatus?.lastSeen || existing?.lastSeen || null),
        };
      }
      return merged;
    });
  } catch (e) {
    // Ignore — REST fetch is best-effort fallback
  } finally {
    _fetchingRest = false;
  }
}

function _attachListener() {
  if (_listenerAttached) return;
  _listenerAttached = true;

  connectScale();

  // Immediately fetch via REST so cards appear before socket delivers data
  _fetchZonesViaRest();

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

      case 'socketConnected':
        // Socket reconnected — fetch latest from REST in case we missed data
        _fetchZonesViaRest();
        break;

      case 'socketDisconnected':
        // Socket lost — refetch via REST after short delay (server might still be up)
        setTimeout(_fetchZonesViaRest, 3000);
        break;
    }
  });
}

/**
 * React hook для получения live-данных с IoT сенсоров через Socket.io.
 * Uses a shared module-level cache so data persists across page navigation.
 * Falls back to REST API when socket has no data or disconnects.
 *
 * @returns {Object} zones — { 'zone-1': { online, lastData, lastSeen }, ... }
 */
// Periodic REST polling as ultimate fallback (every 30s)
let _pollingInterval = null;

function _startPolling() {
  if (_pollingInterval) return;
  _pollingInterval = setInterval(_fetchZonesViaRest, 30000);
}

export function useSensors() {
  const [zones, setZones] = useState(_cache);

  useEffect(() => {
    _attachListener();
    _startPolling(); // Always poll as backup, regardless of socket state

    // Sync from cache on mount
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
