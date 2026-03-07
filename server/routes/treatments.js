import express from 'express';
import {
  getProducts, createProduct, updateProduct, deleteProduct,
  getProtocols, getProtocol, createProtocol, updateProtocol, deleteProtocol, setDefaultProtocol,
  getSchedule, applyProtocol, updateSchedule, completeTreatment, getUpcoming
} from '../controllers/treatmentController.js';
import { protect } from '../middleware/auth.js';
import { checkPermission } from '../middleware/rbac.js';

const router = express.Router();

router.use(protect);

// Препараты
router.get('/products', getProducts);
router.post('/products', checkPermission('treatments:manage'), createProduct);
router.put('/products/:id', checkPermission('treatments:manage'), updateProduct);
router.delete('/products/:id', checkPermission('treatments:manage'), deleteProduct);

// Протоколы
router.get('/protocols', getProtocols);
router.get('/protocols/:id', getProtocol);
router.post('/protocols', checkPermission('treatments:manage'), createProtocol);
router.put('/protocols/:id', checkPermission('treatments:manage'), updateProtocol);
router.delete('/protocols/:id', checkPermission('treatments:manage'), deleteProtocol);
router.post('/protocols/:id/set-default', checkPermission('treatments:manage'), setDefaultProtocol);

// Расписания
router.get('/schedule/:targetType/:targetId', getSchedule);
router.post('/schedule/apply', checkPermission('treatments:apply'), applyProtocol);
router.put('/schedule/:id', checkPermission('treatments:apply'), updateSchedule);
router.post('/schedule/:id/complete', checkPermission('tasks:create'), completeTreatment);
router.get('/schedule/:id/upcoming', getUpcoming);

export default router;
