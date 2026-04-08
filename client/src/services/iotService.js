import api from './api';

export const iotService = {
  async getZones() {
    const response = await api.get('/zones');
    return response.data;
  },

  async getZone(zoneId) {
    const response = await api.get(`/zones/${zoneId}`);
    return response.data;
  },

  async createZone(data) {
    const response = await api.post('/zones', data);
    return response.data;
  },

  async updateZone(zoneId, data) {
    const response = await api.put(`/zones/${zoneId}`, data);
    return response.data;
  },

  async deleteZone(zoneId) {
    const response = await api.delete(`/zones/${zoneId}`);
    return response.data;
  },

  async getReadings(zoneId, params = {}) {
    const response = await api.get(`/zones/${zoneId}/readings`, { params });
    return response.data;
  },

  async getLatestReading(zoneId) {
    const response = await api.get(`/zones/${zoneId}/readings/latest`);
    return response.data;
  },

  async getHumidifierStatus(zoneId) {
    const response = await api.get(`/zones/${zoneId}/humidifier/status`);
    return response.data;
  },

  async controlHumidifier(zoneId, data) {
    const response = await api.post(`/zones/${zoneId}/humidifier`, data);
    return response.data;
  },

  async getHumidifierLog(zoneId, params = {}) {
    const response = await api.get(`/zones/${zoneId}/humidifier/log`, { params });
    return response.data;
  },

  // Irrigation
  async getIrrigationStatus(zoneId) {
    const response = await api.get(`/zones/${zoneId}/irrigation/status`);
    return response.data;
  },

  async controlIrrigation(zoneId, data) {
    const response = await api.post(`/zones/${zoneId}/irrigation`, data);
    return response.data;
  },

  async getIrrigationLog(zoneId, params = {}) {
    const response = await api.get(`/zones/${zoneId}/irrigation/log`, { params });
    return response.data;
  },

  // Alerts
  async getAlertConfig(zoneId) {
    const response = await api.get(`/zones/${zoneId}/alerts`);
    return response.data;
  },

  async updateAlertConfig(zoneId, data) {
    const response = await api.put(`/zones/${zoneId}/alerts`, data);
    return response.data;
  },

  async getAlertLog(zoneId, params = {}) {
    const response = await api.get(`/zones/${zoneId}/alerts/log`, { params });
    return response.data;
  },

  async testAlert(chatId) {
    const response = await api.post('/zones/alerts/test', { chatId });
    return response.data;
  }
};
