import express from 'express';
import { body } from 'express-validator';
import { register, login, refreshToken, logout, getMe, changePassword, heartbeat } from '../controllers/authController.js';
import { protect } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const router = express.Router();

// Регистрация (публичный endpoint)
router.post('/register', [
  body('email').isEmail().withMessage('Введите корректный email'),
  body('password').isLength({ min: 6 }).withMessage('Пароль должен быть минимум 6 символов'),
  body('name').notEmpty().trim().escape().withMessage('Введите имя')
], validate, register);

router.post('/login', [
  body('email').isEmail().withMessage('Введите корректный email'),
  body('password').notEmpty().withMessage('Введите пароль')
], validate, login);

router.post('/refresh', refreshToken);

router.post('/logout', protect, logout);

router.post('/change-password', protect, [
  body('currentPassword').notEmpty().withMessage('Введите текущий пароль'),
  body('newPassword').isLength({ min: 6 }).withMessage('Новый пароль минимум 6 символов')
], validate, changePassword);

router.get('/me', protect, getMe);

router.post('/heartbeat', protect, heartbeat);

export default router;
