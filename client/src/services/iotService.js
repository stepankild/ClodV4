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
  }
};
