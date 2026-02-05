import express from 'express';
import { body } from 'express-validator';
import { login, refreshToken, logout, getMe } from '../controllers/authController.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

router.post('/login', [
  body('email').isEmail().withMessage('Введите корректный email'),
  body('password').notEmpty().withMessage('Введите пароль')
], login);

router.post('/refresh', refreshToken);

router.post('/logout', protect, logout);

router.get('/me', protect, getMe);

export default router;
