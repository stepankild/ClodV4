console.log('=== SERVER STARTING ===');
console.log('Node version:', process.version);
console.log('CWD:', process.cwd());
console.log('ENV PORT:', process.env.PORT);
console.log('ENV MONGODB_URI:', process.env.MONGODB_URI ? 'SET' : 'NOT SET');

import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import cors from 'cors';
import dotenv from 'dotenv';
import connectDB from './config/db.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import roomRoutes from './routes/rooms.js';
import archiveRoutes from './routes/archive.js';
import taskRoutes from './routes/tasks.js';
import harvestRoutes from './routes/harvest.js';
import cloneCutRoutes from './routes/cloneCuts.js';
import vegBatchRoutes from './routes/vegBatches.js';
import auditLogRoutes from './routes/auditLogs.js';
import trimRoutes from './routes/trim.js';

console.log('=== IMPORTS DONE ===');

// Import all models to register schemas
import './models/AuditLog.js';
import './models/Permission.js';
import './models/Role.js';
import './models/User.js';
import './models/FlowerRoom.js';
import './models/RoomTask.js';
import './models/CycleArchive.js';
import './models/HarvestSession.js';
import './models/PlannedCycle.js';
import './models/CloneCut.js';
import './models/VegBatch.js';
import './models/TrimLog.js';
import './models/RoomTemplate.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Load .env from server folder (Railway uses Variables, so MONGODB_URI must be set there)
dotenv.config({ path: path.join(__dirname, '.env') });

process.on('uncaughtException', (err) => {
  console.error('uncaughtException:', err);
});
process.on('unhandledRejection', (reason, p) => {
  console.error('unhandledRejection:', reason, p);
});

const app = express();

// Middleware
// На Railway фронтенд и бэкенд на одном домене, поэтому разрешаем same-origin
// Для локальной разработки разрешаем localhost
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:5000',
  process.env.CLIENT_URL,
  process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : null
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Разрешаем запросы без origin (same-origin, curl, etc)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    // На Railway домен может быть динамическим
    if (origin.endsWith('.railway.app')) return callback(null, true);
    callback(null, true); // Разрешаем все для упрощения отладки
  },
  credentials: true
}));
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api/archive', archiveRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/harvest', harvestRoutes);
app.use('/api/clone-cuts', cloneCutRoutes);
app.use('/api/veg-batches', vegBatchRoutes);
app.use('/api/audit-logs', auditLogRoutes);
app.use('/api/trim', trimRoutes);

// Health check (Railway and load balancers ping this or /)
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// TEMPORARY: Sync permissions endpoint
import Permission from './models/Permission.js';
import Role from './models/Role.js';
app.post('/api/sync-permissions', async (req, res) => {
  if (req.headers['x-sync-secret'] !== 'sync-perms-2025') {
    return res.status(403).json({ message: 'Forbidden' });
  }
  try {
    const PERMISSIONS = [
      { name: 'overview:view', description: 'Видеть раздел «Обзор фермы»', module: 'view' },
      { name: 'active:view', description: 'Видеть раздел «Активные комнаты»', module: 'view' },
      { name: 'harvest:view', description: 'Видеть раздел «Сбор урожая»', module: 'view' },
      { name: 'clones:view', description: 'Видеть раздел «Клоны»', module: 'view' },
      { name: 'vegetation:view', description: 'Видеть раздел «Вегетация»', module: 'view' },
      { name: 'archive:view', description: 'Видеть раздел «Архив циклов»', module: 'view' },
      { name: 'stats:view', description: 'Видеть раздел «Статистика»', module: 'view' },
      { name: 'trim:view', description: 'Видеть раздел «Трим»', module: 'view' },
      { name: 'rooms:edit', description: 'Редактировать настройки комнат', module: 'rooms' },
      { name: 'rooms:start_cycle', description: 'Запускать новый цикл', module: 'rooms' },
      { name: 'rooms:notes', description: 'Добавлять заметки', module: 'rooms' },
      { name: 'tasks:create', description: 'Создавать задачи', module: 'tasks' },
      { name: 'tasks:complete', description: 'Выполнять задачи', module: 'tasks' },
      { name: 'tasks:delete', description: 'Удалять задачи', module: 'tasks' },
      { name: 'clones:create', description: 'Создавать клоны', module: 'clones' },
      { name: 'clones:edit', description: 'Редактировать клоны', module: 'clones' },
      { name: 'clones:delete', description: 'Удалять клоны', module: 'clones' },
      { name: 'clones:send_to_veg', description: 'Отправлять в вегетацию', module: 'clones' },
      { name: 'vegetation:create', description: 'Создавать бэтчи вегетации', module: 'vegetation' },
      { name: 'vegetation:edit', description: 'Редактировать бэтчи', module: 'vegetation' },
      { name: 'vegetation:delete', description: 'Удалять бэтчи', module: 'vegetation' },
      { name: 'vegetation:send_to_flower', description: 'Отправлять в цветение', module: 'vegetation' },
      { name: 'harvest:record', description: 'Записывать вес', module: 'harvest' },
      { name: 'harvest:complete', description: 'Завершать сбор', module: 'harvest' },
      { name: 'harvest:edit_weights', description: 'Редактировать веса', module: 'harvest' },
      { name: 'trim:create', description: 'Добавлять трим', module: 'trim' },
      { name: 'trim:edit', description: 'Редактировать трим', module: 'trim' },
      { name: 'trim:complete', description: 'Завершать трим', module: 'trim' },
      { name: 'archive:edit', description: 'Редактировать архив', module: 'archive' },
      { name: 'archive:delete', description: 'Удалять архив', module: 'archive' },
      { name: 'cycles:edit_name', description: 'Редактировать названия циклов', module: 'cycles' },
      { name: 'cycles:plan', description: 'Создавать планы', module: 'cycles' },
      { name: 'templates:manage', description: 'Управлять шаблонами', module: 'templates' },
      { name: 'users:read', description: 'Просмотр пользователей', module: 'users' },
      { name: 'users:create', description: 'Создание пользователей', module: 'users' },
      { name: 'users:update', description: 'Редактирование пользователей', module: 'users' },
      { name: 'users:delete', description: 'Удаление пользователей', module: 'users' },
      { name: 'audit:read', description: 'Просмотр лога действий', module: 'users' },
      { name: '*', description: 'Полный доступ (суперадмин)', module: 'system' }
    ];
    const MIGRATION_MAP = {
      'harvest:do': ['harvest:record', 'harvest:complete'],
      'dashboard:view': []
    };

    const existingPerms = await Permission.find({});
    const existingNames = new Set(existingPerms.map(p => p.name));
    const newNames = new Set(PERMISSIONS.map(p => p.name));
    const log = [];
    let added = 0, updated = 0, removed = 0;

    for (const perm of PERMISSIONS) {
      if (!existingNames.has(perm.name)) {
        await Permission.create(perm);
        log.push(`Added: ${perm.name}`);
        added++;
      } else {
        await Permission.updateOne({ name: perm.name }, { $set: { description: perm.description, module: perm.module } });
        updated++;
      }
    }

    const obsoletePerms = existingPerms.filter(p => !newNames.has(p.name));
    for (const oldPerm of obsoletePerms) {
      const replacements = MIGRATION_MAP[oldPerm.name] || [];
      const roles = await Role.find({ permissions: oldPerm._id });
      for (const role of roles) {
        const newPermIds = [];
        for (const newName of replacements) {
          const newPerm = await Permission.findOne({ name: newName });
          if (newPerm) newPermIds.push(newPerm._id);
        }
        role.permissions = role.permissions.filter(pid => pid.toString() !== oldPerm._id.toString());
        for (const newId of newPermIds) {
          if (!role.permissions.some(pid => pid.toString() === newId.toString())) {
            role.permissions.push(newId);
          }
        }
        await role.save();
        log.push(`Migrated role ${role.name}: ${oldPerm.name} -> [${replacements.join(', ')}]`);
      }
      await Permission.deleteOne({ _id: oldPerm._id });
      log.push(`Removed: ${oldPerm.name}`);
      removed++;
    }

    const totalPerms = await Permission.countDocuments();
    const allRoles = await Role.find({}).populate('permissions', 'name');
    const rolesSummary = allRoles.map(r => ({
      name: r.name,
      permsCount: r.permissions.length,
      isSuper: r.permissions.some(p => p.name === '*')
    }));

    res.json({ added, updated, removed, totalPerms, roles: rolesSummary, log });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});


const clientDist = path.join(__dirname, '../client/dist');
const indexPath = path.join(clientDist, 'index.html');
let hasFrontend = false;
try {
  hasFrontend = fs.existsSync(clientDist) && fs.existsSync(indexPath);
  console.log('Frontend check:', { clientDist, indexPath, hasFrontend });
  if (hasFrontend) {
    console.log('dist contents:', fs.readdirSync(clientDist));
  }
} catch (e) {
  console.warn('Frontend check failed:', e.message);
}
if (!hasFrontend) console.log('No client/dist found at', clientDist, '- serving API only');

// Always respond to GET / so Railway sees the app as alive
app.get('/', (req, res) => {
  if (hasFrontend) {
    res.sendFile(indexPath, (err) => {
      if (err) res.status(200).type('html').send('<h1>Farm Portal</h1><p>API is up. Frontend file error.</p>');
    });
  } else {
    res.status(200).type('html').send('<h1>Farm Portal</h1><p>API is running. Frontend not built or missing dist.</p>');
  }
});

if (hasFrontend) {
  app.use(express.static(clientDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(indexPath, (err) => { if (err) next(); });
  });
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Внутренняя ошибка сервера' });
});

const PORT = process.env.PORT || 5000;

// Listen first so Railway gets a response (no 502). DB connects after.
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT} (frontend: ${hasFrontend ? 'yes' : 'no'})`);
  connectDB().catch((err) => {
    console.error('MongoDB connection failed:', err.message);
    // Don't exit — server stays up; API will return errors until DB is fixed
  });
});
