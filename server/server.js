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
