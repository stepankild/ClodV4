import api from './api';

export const treatmentProductService = {
  async getAll() {
    const response = await api.get('/treatment-products');
    return response.data;
  },

  async create(data) {
    const response = await api.post('/treatment-products', data);
    return response.data;
  },

  async update(id, data) {
    const response = await api.put(`/treatment-products/${id}`, data);
    return response.data;
  },

  async delete(id) {
    await api.delete(`/treatment-products/${id}`);
  },

  async getDeleted() {
    const response = await api.get('/treatment-products/deleted');
    return response.data;
  },

  async restore(id) {
    const response = await api.post(`/treatment-products/deleted/${id}/restore`);
    return response.data;
  }
};
