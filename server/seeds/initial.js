import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Permission from '../models/Permission.js';
import Role from '../models/Role.js';
import User from '../models/User.js';

dotenv.config();

const permissions = [
  // ── View (видимость разделов в меню) ──
  { name: 'overview:view', description: 'Видеть раздел «Обзор фермы»', module: 'view' },
  { name: 'active:view', description: 'Видеть раздел «Активные комнаты»', module: 'view' },
  { name: 'harvest:view', description: 'Видеть раздел «Сбор урожая»', module: 'view' },
  { name: 'clones:view', description: 'Видеть раздел «Клоны»', module: 'view' },
  { name: 'vegetation:view', description: 'Видеть раздел «Вегетация»', module: 'view' },
  { name: 'archive:view', description: 'Видеть раздел «Архив циклов»', module: 'view' },
  { name: 'stats:view', description: 'Видеть раздел «Статистика»', module: 'view' },
  { name: 'trim:view', description: 'Видеть раздел «Трим»', module: 'view' },

  // ── Rooms (комнаты) ──
  { name: 'rooms:edit', description: 'Редактировать настройки комнат (освещение, площадь, карта)', module: 'rooms' },
  { name: 'rooms:start_cycle', description: 'Запускать новый цикл в комнате', module: 'rooms' },
  { name: 'rooms:notes', description: 'Добавлять заметки к комнатам', module: 'rooms' },

  // ── Tasks (задачи) ──
  { name: 'tasks:create', description: 'Создавать задачи для комнат', module: 'tasks' },
  { name: 'tasks:complete', description: 'Выполнять (отмечать) задачи', module: 'tasks' },
  { name: 'tasks:delete', description: 'Удалять задачи', module: 'tasks' },

  // ── Clones (клоны) ──
  { name: 'clones:create', description: 'Создавать нарезки клонов', module: 'clones' },
  { name: 'clones:edit', description: 'Редактировать записи клонов', module: 'clones' },
  { name: 'clones:delete', description: 'Удалять записи клонов', module: 'clones' },
  { name: 'clones:send_to_veg', description: 'Отправлять клоны в вегетацию', module: 'clones' },

  // ── Vegetation (вегетация) ──
  { name: 'vegetation:create', description: 'Создавать бэтчи вегетации', module: 'vegetation' },
  { name: 'vegetation:edit', description: 'Редактировать бэтчи вегетации', module: 'vegetation' },
  { name: 'vegetation:delete', description: 'Удалять бэтчи вегетации', module: 'vegetation' },
  { name: 'vegetation:send_to_flower', description: 'Отправлять растения в цветение', module: 'vegetation' },

  // ── Harvest (сбор урожая) ──
  { name: 'harvest:record', description: 'Записывать вес при сборе урожая', module: 'harvest' },
  { name: 'harvest:complete', description: 'Завершать сессию сбора урожая (архивировать цикл)', module: 'harvest' },
  { name: 'harvest:edit_weights', description: 'Редактировать веса после записи', module: 'harvest' },

  // ── Trim (трим) ──
  { name: 'trim:create', description: 'Добавлять записи трима (вес за день)', module: 'trim' },
  { name: 'trim:edit', description: 'Редактировать записи трима', module: 'trim' },
  { name: 'trim:complete', description: 'Завершать трим (вводить сухой вес, попкорн)', module: 'trim' },

  // ── Archive (архив) ──
  { name: 'archive:edit', description: 'Редактировать данные архивных циклов', module: 'archive' },
  { name: 'archive:delete', description: 'Удалять архивные циклы', module: 'archive' },

  // ── Cycles (циклы) ──
  { name: 'cycles:edit_name', description: 'Редактировать названия циклов', module: 'cycles' },
  { name: 'cycles:plan', description: 'Создавать и редактировать планы циклов', module: 'cycles' },

  // ── Templates (шаблоны) ──
  { name: 'templates:manage', description: 'Создавать и удалять шаблоны комнат', module: 'templates' },

  // ── Users (пользователи) ──
  { name: 'users:read', description: 'Просмотр пользователей и ролей', module: 'users' },
  { name: 'users:create', description: 'Создание пользователей', module: 'users' },
  { name: 'users:update', description: 'Редактирование пользователей и настройка ролей', module: 'users' },
  { name: 'users:delete', description: 'Удаление пользователей', module: 'users' },
  { name: 'audit:read', description: 'Просмотр лога действий и корзины', module: 'users' },

  // ── System (система) ──
  { name: '*', description: 'Полный доступ ко всем функциям (суперадмин)', module: 'system' }
];

const seedDatabase = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    // Clear existing data
    await Permission.deleteMany({});
    await Role.deleteMany({});
    await User.deleteMany({});
    console.log('Cleared existing data');

    // Create permissions
    const createdPermissions = await Permission.insertMany(permissions);
    console.log(`Created ${createdPermissions.length} permissions`);

    const permissionMap = {};
    createdPermissions.forEach(p => {
      permissionMap[p.name] = p._id;
    });

    // Helper: resolve permission IDs from names
    const resolve = (...names) => names.map(n => permissionMap[n]).filter(Boolean);

    // View permissions (все разделы)
    const viewPerms = resolve(
      'overview:view', 'active:view', 'harvest:view', 'clones:view',
      'vegetation:view', 'archive:view', 'stats:view', 'trim:view'
    );

    // Create roles
    const roles = [
      {
        name: 'SuperAdmin',
        description: 'Полный доступ ко всей системе',
        permissions: resolve('*'),
        isSystem: true
      },
      {
        name: 'Admin',
        description: 'Администратор: все разделы и все действия',
        permissions: [
          ...viewPerms,
          ...resolve(
            // Rooms
            'rooms:edit', 'rooms:start_cycle', 'rooms:notes',
            // Tasks
            'tasks:create', 'tasks:complete', 'tasks:delete',
            // Clones
            'clones:create', 'clones:edit', 'clones:delete', 'clones:send_to_veg',
            // Vegetation
            'vegetation:create', 'vegetation:edit', 'vegetation:delete', 'vegetation:send_to_flower',
            // Harvest
            'harvest:record', 'harvest:complete', 'harvest:edit_weights',
            // Trim
            'trim:create', 'trim:edit', 'trim:complete',
            // Archive
            'archive:edit', 'archive:delete',
            // Cycles
            'cycles:edit_name', 'cycles:plan',
            // Templates
            'templates:manage',
            // Users
            'users:read', 'users:create', 'users:update', 'users:delete',
            'audit:read'
          )
        ],
        isSystem: true
      },
      {
        name: 'Grower',
        description: 'Гровер: управление растениями, задачами и сбором урожая',
        permissions: [
          ...viewPerms,
          ...resolve(
            // Rooms
            'rooms:edit', 'rooms:start_cycle', 'rooms:notes',
            // Tasks
            'tasks:create', 'tasks:complete', 'tasks:delete',
            // Clones
            'clones:create', 'clones:edit', 'clones:send_to_veg',
            // Vegetation
            'vegetation:create', 'vegetation:edit', 'vegetation:send_to_flower',
            // Harvest
            'harvest:record', 'harvest:complete', 'harvest:edit_weights',
            // Trim
            'trim:create', 'trim:edit', 'trim:complete',
            // Cycles
            'cycles:edit_name', 'cycles:plan'
          )
        ],
        isSystem: true
      },
      {
        name: 'Worker',
        description: 'Работник: выполнение задач, запись весов, трим',
        permissions: [
          ...viewPerms,
          ...resolve(
            // Rooms
            'rooms:notes',
            // Tasks
            'tasks:complete',
            // Harvest
            'harvest:record',
            // Trim
            'trim:create'
          )
        ],
        isSystem: true
      },
      {
        name: 'Viewer',
        description: 'Наблюдатель: только просмотр всех разделов',
        permissions: [...viewPerms],
        isSystem: true
      }
    ];

    const createdRoles = await Role.insertMany(roles);
    console.log(`Created ${createdRoles.length} roles`);

    const roleMap = {};
    createdRoles.forEach(r => {
      roleMap[r.name] = r._id;
    });

    // Create admin user
    const adminUser = new User({
      email: 'admin@farm.com',
      password: 'admin123',
      name: 'Администратор',
      roles: [roleMap['SuperAdmin']],
      isActive: true
    });

    await adminUser.save();
    console.log('Created admin user');

    console.log('\n=== Seed completed successfully ===');
    console.log(`Permissions: ${createdPermissions.length}`);
    console.log(`Roles: ${createdRoles.length} (SuperAdmin, Admin, Grower, Worker, Viewer)`);
    console.log('Admin credentials:');
    console.log('Email: admin@farm.com');
    console.log('Password: admin123');

    process.exit(0);
  } catch (error) {
    console.error('Seed error:', error);
    process.exit(1);
  }
};

seedDatabase();
