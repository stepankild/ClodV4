/**
 * Синхронизация прав в продакшн БД.
 * НЕ удаляет пользователей, роли, данные.
 *
 * Что делает:
 * 1. Добавляет новые permissions (если их нет)
 * 2. Удаляет старые permissions (которых нет в новом списке)
 * 3. Обновляет описания существующих permissions
 * 4. Чистит из ролей ссылки на удалённые permissions
 *
 * Запуск: node server/seeds/sync-permissions.js
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Permission from '../models/Permission.js';
import Role from '../models/Role.js';

dotenv.config();

// Актуальный список прав (копия из initial.js)
const PERMISSIONS = [
  // View
  { name: 'overview:view', description: 'Видеть раздел «Обзор фермы»', module: 'view' },
  { name: 'active:view', description: 'Видеть раздел «Активные комнаты»', module: 'view' },
  { name: 'harvest:view', description: 'Видеть раздел «Сбор урожая»', module: 'view' },
  { name: 'clones:view', description: 'Видеть раздел «Клоны»', module: 'view' },
  { name: 'vegetation:view', description: 'Видеть раздел «Вегетация»', module: 'view' },
  { name: 'archive:view', description: 'Видеть раздел «Архив циклов»', module: 'view' },
  { name: 'stats:view', description: 'Видеть раздел «Статистика»', module: 'view' },
  { name: 'trim:view', description: 'Видеть раздел «Трим»', module: 'view' },

  // Rooms
  { name: 'rooms:edit', description: 'Редактировать настройки комнат (освещение, площадь, карта)', module: 'rooms' },
  { name: 'rooms:start_cycle', description: 'Запускать новый цикл в комнате', module: 'rooms' },
  { name: 'rooms:notes', description: 'Добавлять заметки к комнатам', module: 'rooms' },

  // Tasks
  { name: 'tasks:create', description: 'Создавать задачи для комнат', module: 'tasks' },
  { name: 'tasks:complete', description: 'Выполнять (отмечать) задачи', module: 'tasks' },
  { name: 'tasks:delete', description: 'Удалять задачи', module: 'tasks' },

  // Clones
  { name: 'clones:create', description: 'Создавать нарезки клонов', module: 'clones' },
  { name: 'clones:edit', description: 'Редактировать записи клонов', module: 'clones' },
  { name: 'clones:delete', description: 'Удалять записи клонов', module: 'clones' },
  { name: 'clones:send_to_veg', description: 'Отправлять клоны в вегетацию', module: 'clones' },

  // Vegetation
  { name: 'vegetation:create', description: 'Создавать бэтчи вегетации', module: 'vegetation' },
  { name: 'vegetation:edit', description: 'Редактировать бэтчи вегетации', module: 'vegetation' },
  { name: 'vegetation:delete', description: 'Удалять бэтчи вегетации', module: 'vegetation' },
  { name: 'vegetation:send_to_flower', description: 'Отправлять растения в цветение', module: 'vegetation' },

  // Harvest
  { name: 'harvest:record', description: 'Записывать вес при сборе урожая', module: 'harvest' },
  { name: 'harvest:complete', description: 'Завершать сессию сбора урожая (архивировать цикл)', module: 'harvest' },
  { name: 'harvest:edit_weights', description: 'Редактировать веса после записи', module: 'harvest' },

  // Trim
  { name: 'trim:create', description: 'Добавлять записи трима (вес за день)', module: 'trim' },
  { name: 'trim:edit', description: 'Редактировать записи трима', module: 'trim' },
  { name: 'trim:complete', description: 'Завершать трим (вводить сухой вес, попкорн)', module: 'trim' },

  // Archive
  { name: 'archive:edit', description: 'Редактировать данные архивных циклов', module: 'archive' },
  { name: 'archive:delete', description: 'Удалять архивные циклы', module: 'archive' },

  // Cycles
  { name: 'cycles:edit_name', description: 'Редактировать названия циклов', module: 'cycles' },
  { name: 'cycles:plan', description: 'Создавать и редактировать планы циклов', module: 'cycles' },

  // Templates
  { name: 'templates:manage', description: 'Создавать и удалять шаблоны комнат', module: 'templates' },

  // Users
  { name: 'users:read', description: 'Просмотр пользователей и ролей', module: 'users' },
  { name: 'users:create', description: 'Создание пользователей', module: 'users' },
  { name: 'users:update', description: 'Редактирование пользователей и настройка ролей', module: 'users' },
  { name: 'users:delete', description: 'Удаление пользователей', module: 'users' },
  { name: 'audit:read', description: 'Просмотр лога действий и корзины', module: 'users' },

  // System
  { name: '*', description: 'Полный доступ ко всем функциям (суперадмин)', module: 'system' }
];

// Маппинг старых прав на новые (для миграции ролей)
const MIGRATION_MAP = {
  'harvest:do': ['harvest:record', 'harvest:complete'],
  'dashboard:view': []  // удалить, view-пермишены заменяют
};

async function syncPermissions() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB\n');

    const existingPerms = await Permission.find({});
    const existingNames = new Set(existingPerms.map(p => p.name));
    const newNames = new Set(PERMISSIONS.map(p => p.name));

    let added = 0;
    let updated = 0;
    let removed = 0;

    // 1. Добавить новые / обновить существующие
    for (const perm of PERMISSIONS) {
      if (!existingNames.has(perm.name)) {
        await Permission.create(perm);
        console.log(`  ✅ Добавлено: ${perm.name} — ${perm.description}`);
        added++;
      } else {
        // Обновить описание и модуль
        await Permission.updateOne(
          { name: perm.name },
          { $set: { description: perm.description, module: perm.module } }
        );
        updated++;
      }
    }

    // 2. Найти устаревшие и мигрировать роли
    const obsoletePerms = existingPerms.filter(p => !newNames.has(p.name));

    if (obsoletePerms.length > 0) {
      console.log('\n  Устаревшие права:');

      for (const oldPerm of obsoletePerms) {
        const replacements = MIGRATION_MAP[oldPerm.name] || [];

        // Найти роли с этим правом
        const roles = await Role.find({ permissions: oldPerm._id });

        if (roles.length > 0) {
          // Получить ID новых прав для замены
          const newPermIds = [];
          for (const newName of replacements) {
            const newPerm = await Permission.findOne({ name: newName });
            if (newPerm) newPermIds.push(newPerm._id);
          }

          for (const role of roles) {
            // Убрать старое право
            role.permissions = role.permissions.filter(
              pid => pid.toString() !== oldPerm._id.toString()
            );
            // Добавить новые (без дубликатов)
            for (const newId of newPermIds) {
              if (!role.permissions.some(pid => pid.toString() === newId.toString())) {
                role.permissions.push(newId);
              }
            }
            await role.save();
            console.log(`    🔄 Роль «${role.name}»: ${oldPerm.name} → [${replacements.join(', ') || 'удалено'}]`);
          }
        }

        // Удалить устаревшее право
        await Permission.deleteOne({ _id: oldPerm._id });
        console.log(`  ❌ Удалено: ${oldPerm.name}`);
        removed++;
      }
    }

    // 3. Итог
    console.log('\n=== Синхронизация завершена ===');
    console.log(`  Добавлено: ${added}`);
    console.log(`  Обновлено: ${updated}`);
    console.log(`  Удалено: ${removed}`);

    // Показать текущее состояние
    const allPerms = await Permission.find({}).sort('module name');
    console.log(`\n  Всего прав в БД: ${allPerms.length}`);

    const roles = await Role.find({}).populate('permissions', 'name');
    console.log(`  Ролей: ${roles.length}`);
    for (const role of roles) {
      const permNames = role.permissions.map(p => p.name);
      console.log(`    • ${role.name} (${permNames.length} прав)${permNames.includes('*') ? ' [SUPER]' : ''}`);
    }

    process.exit(0);
  } catch (error) {
    console.error('Sync error:', error);
    process.exit(1);
  }
}

syncPermissions();
