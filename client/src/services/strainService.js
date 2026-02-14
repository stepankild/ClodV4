import api from './api';

export const strainService = {
  async getAll() {
    const response = await api.get('/strains');
    return response.data;
  },

  async create(data) {
    const response = await api.post('/strains', data);
    return response.data;
  },

  async update(id, data) {
    const response = await api.put(`/strains/${id}`, data);
    return response.data;
  },

  async delete(id) {
    const response = await api.delete(`/strains/${id}`);
    return response.data;
  },

  async getDeleted() {
    const response = await api.get('/strains/deleted');
    return response.data;
  },

  async restore(id) {
    const response = await api.post(`/strains/deleted/${id}/restore`);
    return response.data;
  },

  async migrate() {
    const response = await api.post('/strains/migrate');
    return response.data;
  },

  async merge(sourceNames, targetName) {
    const response = await api.post('/strains/merge', { sourceNames, targetName });
    return response.data;
  }
};
