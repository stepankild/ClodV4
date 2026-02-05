import express from 'express';
import { body } from 'express-validator';
import {
  getUsers,
  getUser,
  createUser,
  updateUser,
  deleteUser,
  getRoles,
  getPermissions,
  updateRole,
  createRole,
  deleteRole,
  approveUser
} from '../controllers/userController.js';
import { protect } from '../middleware/auth.js';
import { checkPermission } from '../middleware/rbac.js';

const router = express.Router();

// All routes require authentication
router.use(protect);

// Get roles (for dropdown in user form)
router.get('/roles', checkPermission('users:read'), getRoles);
// Get all permissions (for role editor)
router.get('/permissions', checkPermission('users:read'), getPermissions);

// Role management (create, update, delete)
router.post('/roles', checkPermission('users:update'), createRole);
router.put('/roles/:id', checkPermission('users:update'), updateRole);
router.delete('/roles/:id', checkPermission('users:update'), deleteRole);

// User CRUD
router.get('/', checkPermission('users:read'), getUsers);

router.get('/:id', checkPermission('users:read'), getUser);

router.post('/', [
  checkPermission('users:create'),
  body('email').isEmail().withMessage('Введите корректный email'),
  body('password').isLength({ min: 6 }).withMessage('Пароль должен быть минимум 6 символов'),
  body('name').notEmpty().withMessage('Введите имя')
], createUser);

router.put('/:id', [
  checkPermission('users:update'),
  body('email').optional().isEmail().withMessage('Введите корректный email'),
  body('password').optional().isLength({ min: 6 }).withMessage('Пароль должен быть минимум 6 символов'),
  body('name').optional().notEmpty().withMessage('Введите имя')
], updateUser);

router.delete('/:id', checkPermission('users:delete'), deleteUser);

// Approve user registration
router.post('/:id/approve', checkPermission('users:update'), approveUser);

export default router;
