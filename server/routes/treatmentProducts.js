import express from 'express';
import {
  getProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  getDeletedProducts,
  restoreProduct
} from '../controllers/treatmentProductController.js';
import { protect } from '../middleware/auth.js';
import { checkPermission } from '../middleware/rbac.js';

const router = express.Router();

router.use(protect);

// Чтение — доступно всем авторизованным
router.get('/', getProducts);

// Удалённые / восстановление
router.get('/deleted', checkPermission('treatments:delete'), getDeletedProducts);
router.post('/deleted/:id/restore', checkPermission('treatments:delete'), restoreProduct);

// CRUD
router.post('/', checkPermission('treatments:products'), createProduct);
router.put('/:id', checkPermission('treatments:products'), updateProduct);
router.delete('/:id', checkPermission('treatments:products'), deleteProduct);

export default router;
