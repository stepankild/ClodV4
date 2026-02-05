import api from './api';

export const selectionService = {
  async getAll(params = {}) {
    const response = await api.get('/selection', { params });
    return response.data;
  },

  async getOne(id) {
    const response = await api.get(`/selection/${id}`);
    return response.data;
  },

  async create(data) {
    const response = await api.post('/selection', data);
    return response.data;
  },

  async update(id, data) {
    const response = await api.put(`/selection/${id}`, data);
    return response.data;
  },

  async delete(id) {
    const response = await api.delete(`/selection/${id}`);
    return response.data;
  }
};
