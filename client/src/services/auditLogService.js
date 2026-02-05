import api from './api';

export const auditLogService = {
  async getLogs(params = {}) {
    const response = await api.get('/audit-logs', { params });
    return response.data;
  }
};
