import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Permission from '../models/Permission.js';
import Role from '../models/Role.js';
import User from '../models/User.js';

dotenv.config();

const permissions = [
  // Users module
  { name: 'users:read', description: 'Просмотр пользователей и ролей', module: 'users' },
  { name: 'users:create', description: 'Создание пользователей', module: 'users' },
  { name: 'users:update', description: 'Редактирование пользователей и настройка ролей', module: 'users' },
  { name: 'users:delete', description: 'Удаление пользователей', module: 'users' },
  { name: 'audit:read', description: 'Просмотр лога действий пользователей', module: 'users' },

  // View permissions (кто что видит в меню)
  { name: 'overview:view', description: 'Видеть раздел «Обзор фермы»', module: 'view' },
  { name: 'active:view', description: 'Видеть раздел «Активные комнаты»', module: 'view' },
  { name: 'harvest:view', description: 'Видеть раздел «Сбор урожая»', module: 'view' },
  { name: 'clones:view', description: 'Видеть раздел «Клоны»', module: 'view' },
  { name: 'vegetation:view', description: 'Видеть раздел «Вегетация»', module: 'view' },
  { name: 'archive:view', description: 'Видеть раздел «Архив циклов»', module: 'view' },
  { name: 'stats:view', description: 'Видеть раздел «Статистика»', module: 'view' },

  // Dashboard module (legacy)
  { name: 'dashboard:view', description: 'Просмотр дашборда', module: 'dashboard' },

  // Harvest
  { name: 'harvest:do', description: 'Может собирать урожай (завершать цикл, архивировать)', module: 'harvest' },
  { name: 'harvest:edit_weights', description: 'Редактирование весов при сборе урожая', module: 'harvest' },

  // Rooms / cycles
  { name: 'cycles:edit_name', description: 'Редактирование названий циклов', module: 'rooms' },

  // Clones (просмотр = clones:view, создание/редактирование = clones:create)
  { name: 'clones:create', description: 'Создавать нарезки клонов и отправлять бэтчи в вегетацию', module: 'clones' },

  // Vegetation (просмотр = vegetation:view, создание = vegetation:create)
  { name: 'vegetation:create', description: 'Создавать бэтчи вегетации и отправлять в цветение', module: 'vegetation' },

  // Trim
  { name: 'trim:view', description: 'Видеть раздел «Трим»', module: 'view' },
  { name: 'trim:create', description: 'Добавлять записи трима (вес за день)', module: 'trim' },
  { name: 'trim:edit', description: 'Редактировать сухой вес, попкорн, завершать трим', module: 'trim' },

  // SuperAdmin permission
  { name: '*', description: 'Полный доступ ко всем функциям', module: 'system' }
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
    console.log('Created permissions');

    const permissionMap = {};
    createdPermissions.forEach(p => {
      permissionMap[p.name] = p._id;
    });

    // Create roles
    const viewPerms = [
      permissionMap['overview:view'],
      permissionMap['active:view'],
      permissionMap['harvest:view'],
      permissionMap['clones:view'],
      permissionMap['vegetation:view'],
      permissionMap['archive:view'],
      permissionMap['stats:view'],
      permissionMap['trim:view']
    ];
    const roles = [
      {
        name: 'SuperAdmin',
        description: 'Полный доступ ко всей системе',
        permissions: [permissionMap['*']],
        isSystem: true
      },
      {
        name: 'Admin',
        description: 'Администратор: все разделы и все действия',
        permissions: [
          permissionMap['users:read'],
          permissionMap['users:create'],
          permissionMap['users:update'],
          permissionMap['users:delete'],
          permissionMap['audit:read'],
          permissionMap['dashboard:view'],
          permissionMap['harvest:do'],
          permissionMap['harvest:edit_weights'],
          permissionMap['cycles:edit_name'],
          permissionMap['clones:create'],
          permissionMap['vegetation:create'],
          permissionMap['trim:create'],
          permissionMap['trim:edit'],
          ...viewPerms
        ],
        isSystem: true
      },
      {
        name: 'User',
        description: 'Работник: только просмотр разделов (без сбора урожая, без редактирования клонов и вегетации)',
        permissions: [
          permissionMap['dashboard:view'],
          ...viewPerms
        ],
        isSystem: true
      }
    ];

    const createdRoles = await Role.insertMany(roles);
    console.log('Created roles');

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
