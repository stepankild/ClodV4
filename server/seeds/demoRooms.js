/**
 * Демо-данные: 5 активных комнат в разных стадиях цикла + обработки (образец для обзора фермы).
 * Запуск: node seeds/demoRooms.js
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import FlowerRoom from '../models/FlowerRoom.js';
import RoomTask from '../models/RoomTask.js';
import User from '../models/User.js';

dotenv.config();

const DAY_MS = 24 * 60 * 60 * 1000;

const seedDemoRooms = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    const user = await User.findOne();
    if (!user) {
      console.error('Сначала выполните seed: node seeds/initial.js');
      process.exit(1);
    }

    const now = new Date();
    const roomsConfig = [
      { roomNumber: 1, name: 'Комната 1', cycleName: 'Образец-1', strain: 'Сорт А', weeksAgo: 1 },   // неделя 1
      { roomNumber: 2, name: 'Комната 2', cycleName: 'Образец-2', strain: 'Сорт Б', weeksAgo: 2 },   // неделя 2
      { roomNumber: 3, name: 'Комната 3', cycleName: 'Образец-3', strain: 'Сорт В', weeksAgo: 3 },   // неделя 3
      { roomNumber: 4, name: 'Комната 4', cycleName: 'Образец-4', strain: 'Сорт Г', weeksAgo: 4 },   // неделя 4
      { roomNumber: 5, name: 'Комната 5', cycleName: 'Образец-5', strain: 'Сорт Д', weeksAgo: 5 },   // неделя 5
    ];

    const plantsCount = 12;
    const floweringDays = 56;

    for (const config of roomsConfig) {
      const startDate = new Date(now.getTime() - config.weeksAgo * 7 * DAY_MS);
      let room = await FlowerRoom.findOne({ roomNumber: config.roomNumber });
      if (!room) {
        room = await FlowerRoom.create({
          roomNumber: config.roomNumber,
          name: config.name,
          strain: '',
          plantsCount: 0,
          floweringDays: 56,
          isActive: false
        });
      }
      room.cycleName = config.cycleName;
      room.strain = config.strain;
      room.plantsCount = plantsCount;
      room.floweringDays = floweringDays;
      room.startDate = startDate;
      room.isActive = true;
      room.currentCycleId = new mongoose.Types.ObjectId();
      room.notes = '';
      await room.save();

      await RoomTask.deleteMany({ room: room._id });

      const tasksToCreate = [];
      const week = config.weeksAgo;
      const baseDay = week * 7;

      // Комната 1 (нед.1): только опрыскивание
      if (config.roomNumber === 1) {
        tasksToCreate.push({ type: 'spray', title: 'Опрыскивание', dayOfCycle: 5, sprayProduct: 'Профилактика' });
      }
      // Комната 2 (нед.2): подрезка нед.2 сделана
      if (config.roomNumber === 2) {
        tasksToCreate.push({ type: 'trim', title: 'Подрезка (нед.2)', dayOfCycle: 10 });
        tasksToCreate.push({ type: 'spray', title: 'Опрыскивание', dayOfCycle: 8, sprayProduct: 'Средство X' });
      }
      // Комната 3 (нед.3): подрезка сделана, листики ещё нет
      if (config.roomNumber === 3) {
        tasksToCreate.push({ type: 'trim', title: 'Подрезка (нед.2)', dayOfCycle: 10 });
        tasksToCreate.push({ type: 'spray', title: 'Опрыскивание', dayOfCycle: 15 });
        tasksToCreate.push({ type: 'feed', title: 'Подкормка', dayOfCycle: 18, feedProduct: 'Bloom', feedDosage: '1мл/л' });
      }
      // Комната 4 (нед.4): подрезка + убрать листики нед.4
      if (config.roomNumber === 4) {
        tasksToCreate.push({ type: 'trim', title: 'Подрезка (нед.2)', dayOfCycle: 10 });
        tasksToCreate.push({ type: 'defoliation', title: 'Убрать листики (нед.4)', dayOfCycle: 25 });
        tasksToCreate.push({ type: 'spray', title: 'Опрыскивание', dayOfCycle: 22, sprayProduct: 'Средство Y' });
      }
      // Комната 5 (нед.5): всё сделано
      if (config.roomNumber === 5) {
        tasksToCreate.push({ type: 'trim', title: 'Подрезка (нед.2)', dayOfCycle: 10 });
        tasksToCreate.push({ type: 'defoliation', title: 'Убрать листики (нед.4)', dayOfCycle: 25 });
        tasksToCreate.push({ type: 'spray', title: 'Опрыскивание', dayOfCycle: 5, sprayProduct: 'Профилактика' });
        tasksToCreate.push({ type: 'spray', title: 'Опрыскивание', dayOfCycle: 30, sprayProduct: 'Финальная неделя' });
        tasksToCreate.push({ type: 'feed', title: 'Подкормка', dayOfCycle: 28, feedProduct: 'Bloom', feedDosage: '0.5мл/л' });
      }

      const completedAtBase = startDate.getTime();
      for (const t of tasksToCreate) {
        const completedAt = new Date(completedAtBase + (t.dayOfCycle || 1) * DAY_MS);
        await RoomTask.create({
          room: room._id,
          cycleId: room.currentCycleId,
          type: t.type,
          title: t.title,
          completed: true,
          completedAt,
          completedBy: user._id,
          dayOfCycle: t.dayOfCycle,
          sprayProduct: t.sprayProduct || '',
          feedProduct: t.feedProduct || '',
          feedDosage: t.feedDosage || ''
        });
      }
      console.log(`Room ${config.roomNumber} (${config.name}): ${tasksToCreate.length} tasks`);
    }

    console.log('\n=== Demo rooms seed completed ===');
    console.log('5 комнат активны в разных стадиях (нед.1–5). Обновите дашборд.');
    process.exit(0);
  } catch (error) {
    console.error('Seed error:', error);
    process.exit(1);
  }
};

seedDemoRooms();
