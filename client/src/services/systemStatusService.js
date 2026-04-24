import api from './api';

export const systemStatusService = {
  async getLatest() {
    const { data } = await api.get('/system-status/latest');
    return data;
  },
  async getHistory(limit = 50) {
    const { data } = await api.get('/system-status/history', { params: { limit } });
    return data;
  },
  async refresh() {
    const { data } = await api.post('/system-status/refresh');
    return data;
  },
};
