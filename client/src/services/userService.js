import api from './api';

export const userService = {
  async getUsers() {
    const response = await api.get('/users');
    return response.data;
  },

  async getUser(id) {
    const response = await api.get(`/users/${id}`);
    return response.data;
  },

  async createUser(userData) {
    const response = await api.post('/users', userData);
    return response.data;
  },

  async updateUser(id, userData) {
    const response = await api.put(`/users/${id}`, userData);
    return response.data;
  },

  async deleteUser(id) {
    const response = await api.delete(`/users/${id}`);
    return response.data;
  },

  async getRoles() {
    const response = await api.get('/users/roles');
    return response.data;
  },

  async getPermissions() {
    const response = await api.get('/users/permissions');
    return response.data;
  },

  async updateRole(id, data) {
    const response = await api.put(`/users/roles/${id}`, data);
    return response.data;
  },

  async createRole(data) {
    const response = await api.post('/users/roles', data);
    return response.data;
  },

  async deleteRole(id) {
    const response = await api.delete(`/users/roles/${id}`);
    return response.data;
  },

  async approveUser(id) {
    const response = await api.post(`/users/${id}/approve`);
    return response.data;
  },

  async getDeletedUsers() {
    const response = await api.get('/users/deleted');
    return response.data;
  },

  async restoreUser(id) {
    const response = await api.post(`/users/deleted/${id}/restore`);
    return response.data;
  },

  async getDeletedRoles() {
    const response = await api.get('/users/roles/deleted');
    return response.data;
  },

  async restoreRole(id) {
    const response = await api.post(`/users/roles/deleted/${id}/restore`);
    return response.data;
  }
};
