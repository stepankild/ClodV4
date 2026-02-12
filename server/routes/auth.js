import express from 'express';
import { body } from 'express-validator';
import { register, login, refreshToken, logout, getMe, changePassword } from '../controllers/authController.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

// Регистрация (публичный endpoint)
router.post('/register', [
  body('email').isEmail().withMessage('Введите корректный email'),
  body('password').isLength({ min: 6 }).withMessage('Пароль должен быть минимум 6 символов'),
  body('name').notEmpty().withMessage('Введите имя')
], register);

router.post('/login', [
  body('email').isEmail().withMessage('Введите корректный email'),
  body('password').notEmpty().withMessage('Введите пароль')
], login);

router.post('/refresh', refreshToken);

router.post('/logout', protect, logout);

router.post('/change-password', protect, [
  body('currentPassword').notEmpty().withMessage('Введите текущий пароль'),
  body('newPassword').isLength({ min: 6 }).withMessage('Новый пароль минимум 6 символов')
], changePassword);

router.get('/me', protect, getMe);

export default router;
