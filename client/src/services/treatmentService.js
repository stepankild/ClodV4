import api from './api';

export const treatmentService = {
  // Products
  async getProducts(type) {
    const params = type ? { type } : {};
    const response = await api.get('/treatments/products', { params });
    return response.data;
  },

  async createProduct(data) {
    const response = await api.post('/treatments/products', data);
    return response.data;
  },

  async updateProduct(id, data) {
    const response = await api.put(`/treatments/products/${id}`, data);
    return response.data;
  },

  async deleteProduct(id) {
    const response = await api.delete(`/treatments/products/${id}`);
    return response.data;
  },

  // Protocols
  async getProtocols(phase) {
    const params = phase ? { phase } : {};
    const response = await api.get('/treatments/protocols', { params });
    return response.data;
  },

  async getProtocol(id) {
    const response = await api.get(`/treatments/protocols/${id}`);
    return response.data;
  },

  async createProtocol(data) {
    const response = await api.post('/treatments/protocols', data);
    return response.data;
  },

  async updateProtocol(id, data) {
    const response = await api.put(`/treatments/protocols/${id}`, data);
    return response.data;
  },

  async deleteProtocol(id) {
    const response = await api.delete(`/treatments/protocols/${id}`);
    return response.data;
  },

  async setDefaultProtocol(id) {
    const response = await api.post(`/treatments/protocols/${id}/set-default`);
    return response.data;
  },

  // Schedules
  async getSchedule(targetType, targetId) {
    const response = await api.get(`/treatments/schedule/${targetType}/${targetId}`);
    return response.data;
  },

  async applyProtocol(data) {
    const response = await api.post('/treatments/schedule/apply', data);
    return response.data;
  },

  async updateSchedule(id, data) {
    const response = await api.put(`/treatments/schedule/${id}`, data);
    return response.data;
  },

  async completeTreatment(scheduleId, data) {
    const response = await api.post(`/treatments/schedule/${scheduleId}/complete`, data);
    return response.data;
  },

  async getUpcoming(scheduleId) {
    const response = await api.get(`/treatments/schedule/${scheduleId}/upcoming`);
    return response.data;
  }
};
