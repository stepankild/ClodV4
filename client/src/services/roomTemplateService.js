import api from './api';

export const roomTemplateService = {
  async getTemplates() {
    const response = await api.get('/rooms/templates');
    return response.data;
  },

  async createTemplate(data) {
    const response = await api.post('/rooms/templates', data);
    return response.data;
  },

  async deleteTemplate(id) {
    const response = await api.delete(`/rooms/templates/${id}`);
    return response.data;
  }
};
