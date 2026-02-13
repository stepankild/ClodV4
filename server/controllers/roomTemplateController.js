import RoomTemplate from '../models/RoomTemplate.js';
import { createAuditLog } from '../utils/auditLog.js';
import { notDeleted } from '../utils/softDelete.js';

export const getTemplates = async (req, res) => {
  try {
    const templates = await RoomTemplate.find({ ...notDeleted }).sort({ name: 1 });
    res.json(templates);
  } catch (error) {
    console.error('Get templates error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

export const createTemplate = async (req, res) => {
  try {
    const { name, customRows } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Укажите название шаблона' });
    }
    if (!customRows || !Array.isArray(customRows) || customRows.length === 0) {
      return res.status(400).json({ message: 'Шаблон должен содержать хотя бы один ряд' });
    }

    const sanitizedRows = customRows.map(r => ({
      name: r.name || '',
      cols: Math.max(1, Math.min(30, parseInt(r.cols, 10) || 4)),
      rows: Math.max(1, Math.min(100, parseInt(r.rows, 10) || 1)),
      fillDirection: r.fillDirection === 'bottomUp' ? 'bottomUp' : 'topDown'
    }));

    const template = await RoomTemplate.create({
      name: name.trim(),
      customRows: sanitizedRows
    });

    await createAuditLog(req, {
      action: 'roomTemplate.create',
      entityType: 'RoomTemplate',
      entityId: template._id,
      details: { name: template.name, rowCount: sanitizedRows.length }
    });

    res.status(201).json(template);
  } catch (error) {
    console.error('Create template error:', error);
    res.status(500).json({ message: error.message || 'Ошибка сервера' });
  }
};

export const deleteTemplate = async (req, res) => {
  try {
    const template = await RoomTemplate.findOne({ _id: req.params.id, ...notDeleted });
    if (!template) {
      return res.status(404).json({ message: 'Шаблон не найден' });
    }

    await createAuditLog(req, {
      action: 'roomTemplate.delete',
      entityType: 'RoomTemplate',
      entityId: req.params.id,
      details: { name: template.name }
    });

    template.deletedAt = new Date();
    await template.save();

    res.json({ message: 'Шаблон удалён' });
  } catch (error) {
    console.error('Delete template error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};
