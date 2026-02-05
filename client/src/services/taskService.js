import api from './api';

export const TASK_LABELS = {
  spray: 'Опрыскивание',
  net: 'Натяжка сетки',
  trim: 'Подрезка (нед.2)',
  defoliation: 'Убрать листики (нед.4)',
  feed: 'Подкормка',
  water: 'Полив',
  flush: 'Промывка',
  training: 'Тренировка',
  transplant: 'Пересадка',
  pest_check: 'Проверка на вредителей',
  ph_check: 'Проверка pH',
  custom: 'Другое'
};

export const taskTypes = Object.entries(TASK_LABELS).map(([value, label]) => ({ value, label }));

export const taskService = {
  async getTaskTypes() {
    const response = await api.get('/tasks/types');
    return response.data;
  },

  async getRoomTasks(roomId, completed = undefined) {
    const params = completed !== undefined ? { completed: String(completed) } : {};
    const response = await api.get(`/tasks/room/${roomId}`, { params });
    return response.data;
  },

  async quickAddTask(roomId, { type, completedAt, product, dosage, description }) {
    const body = { roomId, type };
    if (completedAt) body.completedAt = completedAt;
    if (product) body.product = product;
    if (dosage) body.dosage = dosage;
    if (description) body.description = description;
    const response = await api.post('/tasks/quick', body);
    return response.data;
  },

  async deleteTask(taskId) {
    await api.delete(`/tasks/${taskId}`);
  }
};
