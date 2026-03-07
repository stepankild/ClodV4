/**
 * Полный бэкап MongoDB — все коллекции в JSON файлы.
 *
 * Запуск:  node server/scripts/backup.js
 * Или:     cd server && npm run backup
 *
 * Нужен MONGODB_URI в .env (в корне или в server).
 * Бэкап сохраняется в backups/YYYY-MM-DD_HH-mm/
 */

import mongoose from 'mongoose';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI не задан. Укажите в .env или как переменную окружения.');
  process.exit(1);
}

async function backup() {
  console.log('🔌 Подключение к MongoDB...');
  await mongoose.connect(MONGODB_URI);
  console.log(`✅ Подключено: ${mongoose.connection.host}`);

  const db = mongoose.connection.db;

  // Создаём папку для бэкапа
  const now = new Date();
  const timestamp = now.toISOString().replace(/T/, '_').replace(/:/g, '-').slice(0, 16);
  const backupDir = path.join(__dirname, '..', '..', 'backups', timestamp);
  fs.mkdirSync(backupDir, { recursive: true });

  // Получаем все коллекции
  const collections = await db.listCollections().toArray();
  const collectionNames = collections.map(c => c.name).sort();

  console.log(`\n📦 Найдено коллекций: ${collectionNames.length}`);
  console.log('─'.repeat(50));

  let totalDocs = 0;
  let totalSize = 0;
  const summary = [];

  for (const name of collectionNames) {
    const collection = db.collection(name);
    const docs = await collection.find({}).toArray();
    const json = JSON.stringify(docs, null, 2);
    const filePath = path.join(backupDir, `${name}.json`);
    fs.writeFileSync(filePath, json, 'utf-8');

    const sizeKB = (Buffer.byteLength(json, 'utf-8') / 1024).toFixed(1);
    totalDocs += docs.length;
    totalSize += Buffer.byteLength(json, 'utf-8');

    const status = docs.length > 0 ? '✅' : '⚪';
    console.log(`  ${status} ${name.padEnd(25)} ${String(docs.length).padStart(6)} док.  ${String(sizeKB).padStart(8)} KB`);
    summary.push({ name, count: docs.length, sizeKB: parseFloat(sizeKB) });
  }

  // Сохраняем мета-информацию
  const meta = {
    timestamp: now.toISOString(),
    host: mongoose.connection.host,
    database: mongoose.connection.name,
    collections: summary,
    totalDocuments: totalDocs,
    totalSizeKB: (totalSize / 1024).toFixed(1)
  };
  fs.writeFileSync(path.join(backupDir, '_meta.json'), JSON.stringify(meta, null, 2), 'utf-8');

  console.log('─'.repeat(50));
  console.log(`📊 Итого: ${totalDocs} документов, ${(totalSize / 1024).toFixed(1)} KB`);
  console.log(`📁 Бэкап сохранён: ${backupDir}`);

  await mongoose.disconnect();
  console.log('\n✅ Бэкап завершён!');
}

backup().catch(err => {
  console.error('❌ Ошибка бэкапа:', err.message);
  process.exit(1);
});
