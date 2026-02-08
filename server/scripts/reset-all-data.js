/**
 * Сброс всех данных, кроме пользователей и ролей.
 * Удаляются: аудит, трим, архивы, сессии урожая, задачи, логи комнат,
 * клоны, вегетация, планы, комнаты цветения. Пользователи и роли не трогаются.
 *
 * Запуск из корня:  node server/scripts/reset-all-data.js
 * Или из server:    npm run reset-all
 *
 * Нужен MONGODB_URI в .env (в корне или в server).
 */

import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env') });

import AuditLog from '../models/AuditLog.js';
import CloneCut from '../models/CloneCut.js';
import CycleArchive from '../models/CycleArchive.js';
import FlowerRoom from '../models/FlowerRoom.js';
import HarvestSession from '../models/HarvestSession.js';
import PlannedCycle from '../models/PlannedCycle.js';
import RoomLog from '../models/RoomLog.js';
import RoomTask from '../models/RoomTask.js';
import TrimLog from '../models/TrimLog.js';
import VegBatch from '../models/VegBatch.js';

async function resetAll() {
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI не задан. Задайте в .env в корне или в server.');
    process.exit(1);
  }

  console.log('Подключение к MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Подключено.\n');

  try {
    console.log('Удаление данных (пользователи и роли не трогаем)...');
    await TrimLog.deleteMany({});
    await CycleArchive.deleteMany({});
    await HarvestSession.deleteMany({});
    await RoomTask.deleteMany({});
    await RoomLog.deleteMany({});
    await CloneCut.deleteMany({});
    await VegBatch.deleteMany({});
    await PlannedCycle.deleteMany({});
    await AuditLog.deleteMany({});
    await FlowerRoom.deleteMany({});
    console.log('Готово.\n');
    console.log('=== Сброс завершён. Пользователи и роли сохранены. ===');
  } catch (err) {
    console.error('Ошибка:', err);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('Соединение с БД закрыто.');
    process.exit(0);
  }
}

resetAll();
