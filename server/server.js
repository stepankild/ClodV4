console.log('=== SERVER STARTING ===');
console.log('Node version:', process.version);
console.log('CWD:', process.cwd());
console.log('ENV PORT:', process.env.PORT);
console.log('ENV MONGODB_URI:', process.env.MONGODB_URI ? 'SET' : 'NOT SET');

import express from 'express';
import { createServer } from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import connectDB from './config/db.js';
import { initializeSocket } from './socket/index.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import roomRoutes from './routes/rooms.js';
import archiveRoutes from './routes/archive.js';
import taskRoutes from './routes/tasks.js';
import harvestRoutes from './routes/harvest.js';
import cloneCutRoutes from './routes/cloneCuts.js';
import vegBatchRoutes from './routes/vegBatches.js';
import vegMapRoutes from './routes/vegMap.js';
import auditLogRoutes from './routes/auditLogs.js';
import trimRoutes from './routes/trim.js';
import strainRoutes from './routes/strains.js';
import treatmentRoutes from './routes/treatments.js';
import treatmentProductRoutes from './routes/treatmentProducts.js';
import treatmentRecordRoutes from './routes/treatmentRecords.js';
import motherRoomRoutes from './routes/motherRoom.js';
import zoneRoutes from './routes/zones.js';
import sensorIngestRoutes from './routes/sensorIngest.js';
import { detectLanguage } from './middleware/lang.js';

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
import './models/Strain.js';
import './models/TreatmentProduct.js';
import './models/TreatmentProtocol.js';
import './models/RoomTreatmentSchedule.js';
import './models/TreatmentRecord.js';
import './models/MotherPlant.js';
import './models/MotherRoomMap.js';
import './models/Zone.js';
import './models/SensorReading.js';
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

// Trust proxy (Railway / Cloudflare / nginx) — needed for correct req.ip
app.set('trust proxy', 1);

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
    // Разрешаем запросы без origin (same-origin, curl, mobile apps)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    // На Railway домен может быть динамическим
    if (origin.endsWith('.railway.app')) return callback(null, true);
    console.warn(`CORS blocked origin: ${origin}`);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));
app.use(express.json({ limit: '2mb' }));

// Security headers
app.use(helmet({
  contentSecurityPolicy: false, // SPA обслуживается отсюда же, CSP усложнит
  crossOriginEmbedderPolicy: false // Не ломать загрузку SVG/шрифтов
}));

// Rate limiting — глобальный лимит
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 минут
  max: 500,                  // 500 запросов на IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Слишком много запросов, попробуйте позже' }
});
app.use('/api', globalLimiter);

// Жёсткий лимит на auth endpoints (защита от брутфорса)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 минут
  max: 20,                   // 20 попыток на IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Слишком много попыток входа, подождите 15 минут' }
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

// Language detection
app.use('/api', detectLanguage);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api/archive', archiveRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/harvest', harvestRoutes);
app.use('/api/clone-cuts', cloneCutRoutes);
app.use('/api/veg-batches', vegBatchRoutes);
app.use('/api/veg-map', vegMapRoutes);
app.use('/api/audit-logs', auditLogRoutes);
app.use('/api/trim', trimRoutes);
app.use('/api/strains', strainRoutes);
app.use('/api/treatments', treatmentRoutes);
app.use('/api/treatment-products', treatmentProductRoutes);
app.use('/api/treatments', treatmentRecordRoutes);
app.use('/api/mother-room', motherRoomRoutes);
app.use('/api/zones', zoneRoutes);
app.use('/api/sensor-data', sensorIngestRoutes);

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

// HTTP server (needed for Socket.io)
const server = createServer(app);

// Initialize Socket.io for real-time scale data
const io = initializeSocket(server, allowedOrigins);
app.set('io', io);

// Initialize MQTT client for IoT sensor data
import { initializeMqtt } from './mqtt/index.js';
initializeMqtt(io);

// Listen first so Railway gets a response (no 502). DB connects after.
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT} (frontend: ${hasFrontend ? 'yes' : 'no'})`);
  connectDB().then(async () => {
    // One-time migration: remove test room + cleanup empty archives
    try {
      const FlowerRoom = (await import('./models/FlowerRoom.js')).default;
      const CycleArchive = (await import('./models/CycleArchive.js')).default;

      // 1. Delete test room
      const testRoom = await FlowerRoom.findOne({ isTestRoom: true });
      if (testRoom) {
        await CycleArchive.deleteMany({ room: testRoom._id });
        await FlowerRoom.deleteOne({ _id: testRoom._id });
        console.log('Migration: deleted test room and its archives');
      }

      // 2. Delete archives without a real harvest (wetWeight=0 AND dryWeight=0 AND no plant weights)
      const emptyArchives = await CycleArchive.deleteMany({
        'harvestData.wetWeight': { $in: [0, null] },
        'harvestData.dryWeight': { $in: [0, null] },
        $or: [
          { 'harvestMapData.plants': { $size: 0 } },
          { 'harvestMapData.plants': { $exists: false } },
          { 'harvestMapData.plants': { $not: { $elemMatch: { wetWeight: { $gt: 0 } } } } }
        ]
      });
      if (emptyArchives.deletedCount > 0) {
        console.log(`Migration: deleted ${emptyArchives.deletedCount} empty archive(s) without harvest data`);
      }

      // 3. Delete harvest sessions without plants (empty/test sessions)
      const HarvestSession = (await import('./models/HarvestSession.js')).default;
      const emptySessions = await HarvestSession.deleteMany({
        $or: [
          { plants: { $size: 0 } },
          { plants: { $exists: false } }
        ]
      });
      if (emptySessions.deletedCount > 0) {
        console.log(`Migration: deleted ${emptySessions.deletedCount} empty harvest session(s)`);
      }
    } catch (e) { console.error('Migration error:', e.message); }
  }).catch((err) => {
    console.error('MongoDB connection failed:', err.message);
    // Don't exit — server stays up; API will return errors until DB is fixed
  });
});
