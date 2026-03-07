import TreatmentProduct from '../models/TreatmentProduct.js';
import { notDeleted, deletedOnly } from '../utils/softDelete.js';
import { createAuditLog } from '../utils/auditLog.js';
import { t } from '../utils/i18n.js';

// @desc    Get all products (active)
// @route   GET /api/treatment-products
export const getProducts = async (req, res) => {
  try {
    const products = await TreatmentProduct.find({ ...notDeleted }).sort({ name: 1 }).lean();
    res.json(products);
  } catch (error) {
    console.error('Get treatment products error:', error);
    res.status(500).json({ message: t('common.serverError', req.lang) });
  }
};

// @desc    Create product
// @route   POST /api/treatment-products
export const createProduct = async (req, res) => {
  try {
    const { name, type, activeIngredient, concentration, targetPests, safetyIntervalDays, instructions, notes } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ message: t('treatments.productNameRequired', req.lang) });
    }
    const trimmed = name.trim();

    // Проверка дубликата (case-insensitive)
    const nameRegex = new RegExp(`^${trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
    const existing = await TreatmentProduct.findOne({
      name: { $regex: nameRegex },
      ...notDeleted
    });
    if (existing) {
      return res.status(400).json({ message: t('treatments.productAlreadyExists', req.lang, { name: existing.name }) });
    }

    // Если soft-deleted с таким именем — восстановить
    const deletedExisting = await TreatmentProduct.findOne({
      name: { $regex: nameRegex },
      ...deletedOnly
    });
    let product;
    if (deletedExisting) {
      deletedExisting.deletedAt = null;
      deletedExisting.name = trimmed;
      if (type !== undefined) deletedExisting.type = type;
      if (activeIngredient !== undefined) deletedExisting.activeIngredient = activeIngredient;
      if (concentration !== undefined) deletedExisting.concentration = concentration;
      if (targetPests !== undefined) deletedExisting.targetPests = targetPests;
      if (safetyIntervalDays !== undefined) deletedExisting.safetyIntervalDays = safetyIntervalDays;
      if (instructions !== undefined) deletedExisting.instructions = instructions;
      if (notes !== undefined) deletedExisting.notes = notes;
      await deletedExisting.save();
      product = deletedExisting;
    } else {
      product = await TreatmentProduct.create({
        name: trimmed,
        type: type || 'other',
        activeIngredient: activeIngredient || '',
        concentration: concentration || '',
        targetPests: targetPests || [],
        safetyIntervalDays: safetyIntervalDays ?? null,
        instructions: instructions || '',
        notes: notes || ''
      });
    }

    await createAuditLog(req, {
      action: 'treatment_product.create',
      entityType: 'TreatmentProduct',
      entityId: product._id,
      details: { name: trimmed, type: product.type }
    });
    res.status(201).json(product);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: t('treatments.productDuplicate', req.lang) });
    }
    console.error('Create treatment product error:', error);
    res.status(500).json({ message: t('common.serverError', req.lang) });
  }
};

// @desc    Update product
// @route   PUT /api/treatment-products/:id
export const updateProduct = async (req, res) => {
  try {
    const { name, type, activeIngredient, concentration, targetPests, safetyIntervalDays, instructions, notes } = req.body;
    const product = await TreatmentProduct.findOne({ _id: req.params.id, ...notDeleted });
    if (!product) {
      return res.status(404).json({ message: t('treatments.productNotFound', req.lang) });
    }

    if (name !== undefined) {
      const trimmed = name.trim();
      if (!trimmed) return res.status(400).json({ message: t('treatments.productNameRequired', req.lang) });

      // Проверка дубликата (кроме себя)
      const existing = await TreatmentProduct.findOne({
        _id: { $ne: product._id },
        name: { $regex: new RegExp(`^${trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
        ...notDeleted
      });
      if (existing) {
        return res.status(400).json({ message: t('treatments.productAlreadyExists', req.lang, { name: existing.name }) });
      }
      product.name = trimmed;
    }

    if (type !== undefined) product.type = type;
    if (activeIngredient !== undefined) product.activeIngredient = activeIngredient;
    if (concentration !== undefined) product.concentration = concentration;
    if (targetPests !== undefined) product.targetPests = targetPests;
    if (safetyIntervalDays !== undefined) product.safetyIntervalDays = safetyIntervalDays;
    if (instructions !== undefined) product.instructions = instructions;
    if (notes !== undefined) product.notes = notes;

    await product.save();
    await createAuditLog(req, {
      action: 'treatment_product.update',
      entityType: 'TreatmentProduct',
      entityId: product._id,
      details: { name: product.name }
    });
    res.json(product);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: t('treatments.productDuplicate', req.lang) });
    }
    console.error('Update treatment product error:', error);
    res.status(500).json({ message: t('common.serverError', req.lang) });
  }
};

// @desc    Soft-delete product
// @route   DELETE /api/treatment-products/:id
export const deleteProduct = async (req, res) => {
  try {
    const product = await TreatmentProduct.findOne({ _id: req.params.id, ...notDeleted });
    if (!product) {
      return res.status(404).json({ message: t('treatments.productNotFound', req.lang) });
    }
    product.deletedAt = new Date();
    await product.save();
    await createAuditLog(req, {
      action: 'treatment_product.delete',
      entityType: 'TreatmentProduct',
      entityId: product._id,
      details: { name: product.name }
    });
    res.json({ message: t('treatments.productDeleted', req.lang) });
  } catch (error) {
    console.error('Delete treatment product error:', error);
    res.status(500).json({ message: t('common.serverError', req.lang) });
  }
};

// @desc    Get deleted products
// @route   GET /api/treatment-products/deleted
export const getDeletedProducts = async (req, res) => {
  try {
    const products = await TreatmentProduct.find({ ...deletedOnly }).sort({ deletedAt: -1 }).lean();
    res.json(products);
  } catch (error) {
    console.error('Get deleted treatment products error:', error);
    res.status(500).json({ message: t('common.serverError', req.lang) });
  }
};

// @desc    Restore deleted product
// @route   POST /api/treatment-products/deleted/:id/restore
export const restoreProduct = async (req, res) => {
  try {
    const product = await TreatmentProduct.findOne({ _id: req.params.id, ...deletedOnly });
    if (!product) {
      return res.status(404).json({ message: t('treatments.productNotFoundInArchive', req.lang) });
    }
    product.deletedAt = null;
    await product.save();
    await createAuditLog(req, {
      action: 'treatment_product.restore',
      entityType: 'TreatmentProduct',
      entityId: product._id,
      details: { name: product.name }
    });
    res.json(product);
  } catch (error) {
    console.error('Restore treatment product error:', error);
    res.status(500).json({ message: t('common.serverError', req.lang) });
  }
};
