import express from 'express';
import path from 'path';
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config();

const app = express();

// Connect to database
connectDB();

// Middleware
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
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

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Production: serve frontend build (one server for API + SPA)
if (process.env.NODE_ENV === 'production') {
  const clientDist = path.join(__dirname, '../client/dist');
  app.use(express.static(clientDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Внутренняя ошибка сервера' });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
