import api from './api';

export const trimService = {
  async getActiveArchives() {
    const response = await api.get('/trim/active');
    return response.data;
  },

  async addLog(archiveId, weight, date) {
    const response = await api.post('/trim/log', { archiveId, weight, date });
    return response.data;
  },

  async getLogs(archiveId) {
    const response = await api.get(`/trim/logs/${archiveId}`);
    return response.data;
  },

  async deleteLog(logId) {
    const response = await api.delete(`/trim/log/${logId}`);
    return response.data;
  },

  async updateArchive(archiveId, data) {
    const response = await api.put(`/trim/archive/${archiveId}`, data);
    return response.data;
  },

  async completeTrim(archiveId) {
    const response = await api.post(`/trim/complete/${archiveId}`);
    return response.data;
  }
};
