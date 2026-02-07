/**
 * Очистка всех пользовательских данных: архивы, трим, клоны, вега, комнаты (сброс),
 * задачи, логи, планы, аудит. Пользователи и роли не трогаем — вход в систему остаётся.
 *
 * Запуск из корня проекта:
 *   node server/scripts/clearUserData.js
 *
 * Или из папки server (нужен MONGODB_URI в .env или в окружении):
 *   node scripts/clearUserData.js
 */

import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

import connectDB from '../config/db.js';
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

async function clearUserData() {
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI не задан. Задайте в .env в папке server или в окружении.');
    process.exit(1);
  }

  console.log('Подключение к MongoDB...');
  await connectDB();

  const results = { deleted: {}, updated: 0 };

  try {
    console.log('Удаление записей трима...');
    results.deleted.trimLogs = (await TrimLog.deleteMany({})).deletedCount;

    console.log('Удаление архивов циклов...');
    results.deleted.cycleArchives = (await CycleArchive.deleteMany({})).deletedCount;

    console.log('Удаление сессий сбора урожая...');
    results.deleted.harvestSessions = (await HarvestSession.deleteMany({})).deletedCount;

    console.log('Удаление задач комнат...');
    results.deleted.roomTasks = (await RoomTask.deleteMany({})).deletedCount;

    console.log('Удаление логов комнат...');
    results.deleted.roomLogs = (await RoomLog.deleteMany({})).deletedCount;

    console.log('Удаление нарезок клонов...');
    results.deleted.cloneCuts = (await CloneCut.deleteMany({})).deletedCount;

    console.log('Удаление бэтчей вегетации...');
    results.deleted.vegBatches = (await VegBatch.deleteMany({})).deletedCount;

    console.log('Удаление планов циклов...');
    results.deleted.plannedCycles = (await PlannedCycle.deleteMany({})).deletedCount;

    console.log('Удаление записей аудит-лога...');
    results.deleted.auditLogs = (await AuditLog.deleteMany({})).deletedCount;

    console.log('Сброс состояния комнат (без удаления самих комнат)...');
    const roomResult = await FlowerRoom.updateMany(
      {},
      {
        $set: {
          cycleName: '',
          strain: '',
          plantsCount: 0,
          startDate: null,
          expectedHarvestDate: null,
          notes: '',
          isActive: false,
          currentCycleId: null,
          totalCycles: 0
        }
      }
    );
    results.updated = roomResult.modifiedCount;

    console.log('\n--- Итог ---');
    console.log('Удалено:', results.deleted);
    console.log('Комнат сброшено:', results.updated);
    console.log('\nПользователи и роли не изменялись. Сайт как новый без записей.');
  } catch (err) {
    console.error('Ошибка:', err);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('Соединение с БД закрыто.');
    process.exit(0);
  }
}

clearUserData();
