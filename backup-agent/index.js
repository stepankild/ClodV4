// ClodV4 Backup Agent
//
// Подключается к Railway-порталу по Socket.io с API-ключом (deviceType='backup').
// Слушает событие 'backup:request' — спавнит соответствующий PowerShell-скрипт
// (scripts/backup-weekly.ps1 или backup-monthly.ps1) с флагом -BackupLogId,
// чтобы скрипт сам отчитался в /api/backups/report о финальном статусе.
//
// Запуск: node index.js (или через Task Scheduler at-user-logon, см. install.ps1)

import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import dotenv from 'dotenv';
import { io as ioClient } from 'socket.io-client';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

// Конфиг
const SERVER_URL   = process.env.SERVER_URL;
const API_KEY      = process.env.BACKUP_API_KEY;
const PROJECT_ROOT = process.env.PROJECT_ROOT
  || path.resolve(__dirname, '..'); // по умолчанию агент лежит внутри проекта

if (!SERVER_URL || !API_KEY) {
  console.error('SERVER_URL и BACKUP_API_KEY обязательны в backup-agent/.env');
  process.exit(1);
}

const SCRIPTS_DIR = path.join(PROJECT_ROOT, 'scripts');
const SCRIPT_MAP = {
  weekly:  path.join(SCRIPTS_DIR, 'backup-weekly.ps1'),
  monthly: path.join(SCRIPTS_DIR, 'backup-monthly.ps1'),
};

// Проверка путей при старте
for (const [type, p] of Object.entries(SCRIPT_MAP)) {
  if (!existsSync(p)) {
    console.warn(`Warning: script for ${type} not found at ${p}`);
  }
}

console.log(`ClodV4 backup agent starting`);
console.log(`  server:       ${SERVER_URL}`);
console.log(`  project root: ${PROJECT_ROOT}`);
console.log(`  scripts:      ${SCRIPTS_DIR}`);
console.log(`  hostname:     ${os.hostname()}`);

let currentChild = null;

const socket = ioClient(SERVER_URL, {
  auth: {
    apiKey: API_KEY,
    deviceType: 'backup',
    host: os.hostname(),
  },
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionDelay: 2000,
  reconnectionDelayMax: 30000,
  timeout: 15000,
});

socket.on('connect', () => {
  console.log(`[${new Date().toISOString()}] connected (${socket.id})`);
});

socket.on('disconnect', (reason) => {
  console.log(`[${new Date().toISOString()}] disconnected: ${reason}`);
});

socket.on('connect_error', (err) => {
  console.warn(`[${new Date().toISOString()}] connect_error: ${err.message}`);
});

socket.on('backup:request', (msg) => {
  const { backupLogId, type } = msg || {};
  console.log(`[${new Date().toISOString()}] backup:request type=${type} logId=${backupLogId}`);

  if (!['weekly', 'monthly'].includes(type)) {
    console.warn(`  ignored: unknown type '${type}'`);
    return;
  }
  if (currentChild) {
    console.warn(`  ignored: another backup is running (pid ${currentChild.pid})`);
    return;
  }
  const script = SCRIPT_MAP[type];
  if (!existsSync(script)) {
    console.error(`  script not found: ${script}`);
    return;
  }

  const args = [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', script,
    '-BackupLogId', backupLogId,
  ];
  console.log(`  spawn: powershell ${args.join(' ')}`);

  const child = spawn('powershell.exe', args, {
    cwd: PROJECT_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  currentChild = child;

  child.stdout.on('data', (b) => process.stdout.write(b));
  child.stderr.on('data', (b) => process.stderr.write(b));

  child.on('exit', (code, signal) => {
    currentChild = null;
    console.log(`[${new Date().toISOString()}] script exit code=${code} signal=${signal}`);
    // Скрипт сам отправляет /report со статусом ok/failed, ничего не эмитим.
  });
  child.on('error', (err) => {
    currentChild = null;
    console.error('spawn error:', err);
  });
});

// graceful shutdown
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`caught ${sig}, shutting down`);
    if (currentChild) {
      console.log('  waiting for running script to finish (up to 60s)');
      const killAt = setTimeout(() => currentChild?.kill('SIGKILL'), 60000);
      currentChild.on('exit', () => clearTimeout(killAt));
    }
    socket.close();
    // даём пару секунд на closing, потом exit
    setTimeout(() => process.exit(0), 2000);
  });
}
