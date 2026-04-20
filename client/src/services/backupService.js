import api from './api';

export const backupService = {
  async list(params = {}) {
    const { data } = await api.get('/backups', { params });
    return data;
  },

  async agentStatus() {
    const { data } = await api.get('/backups/agent-status');
    return data;
  },

  async run(type) {
    const { data } = await api.post('/backups/run', { type });
    return data;
  },
};
