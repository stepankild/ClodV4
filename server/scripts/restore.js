/**
 * Восстановление MongoDB из бэкапа (JSON файлы).
 *
 * Запуск:  node server/scripts/restore.js backups/2026-03-03_14-30
 * Или:     cd server && npm run restore -- ../backups/2026-03-03_14-30
 *
 * ⚠️  ВНИМАНИЕ: Полностью заменяет данные в базе!
 * Нужен MONGODB_URI в .env (в корне или в server).
 */

import mongoose from 'mongoose';
import path from 'path';
import fs from 'fs';
import readline from 'readline';
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

// Путь к папке бэкапа из аргумента
const backupPath = process.argv[2];
if (!backupPath) {
  console.error('❌ Укажите путь к папке бэкапа.');
  console.error('   Пример: node server/scripts/restore.js backups/2026-03-03_14-30');
  process.exit(1);
}

const backupDir = path.resolve(backupPath);
if (!fs.existsSync(backupDir)) {
  console.error(`❌ Папка не найдена: ${backupDir}`);
  process.exit(1);
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => { rl.close(); resolve(answer); });
  });
}

async function restore() {
  // Найти JSON файлы (кроме _meta.json)
  const files = fs.readdirSync(backupDir)
    .filter(f => f.endsWith('.json') && f !== '_meta.json')
    .sort();

  if (files.length === 0) {
    console.error('❌ JSON файлы не найдены в папке бэкапа.');
    process.exit(1);
  }

  // Показать мета-информацию если есть
  const metaPath = path.join(backupDir, '_meta.json');
  if (fs.existsSync(metaPath)) {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    console.log(`\n📦 Бэкап от: ${meta.timestamp}`);
    console.log(`   БД: ${meta.database} @ ${meta.host}`);
    console.log(`   Документов: ${meta.totalDocuments}, Размер: ${meta.totalSizeKB} KB`);
  }

  console.log(`\n📂 Папка: ${backupDir}`);
  console.log(`   Коллекций для восстановления: ${files.length}`);
  files.forEach(f => {
    const data = JSON.parse(fs.readFileSync(path.join(backupDir, f), 'utf-8'));
    const name = f.replace('.json', '');
    console.log(`   • ${name.padEnd(25)} ${data.length} док.`);
  });

  console.log(`\n⚠️  ВНИМАНИЕ: Все текущие данные в базе будут ЗАМЕНЕНЫ!`);
  console.log(`   MongoDB: ${MONGODB_URI.replace(/\/\/[^@]+@/, '//***@')}`);
  const answer = await ask('\n   Продолжить? (yes/да): ');
  if (!['yes', 'да', 'y'].includes(answer.trim().toLowerCase())) {
    console.log('❌ Отменено.');
    process.exit(0);
  }

  console.log('\n🔌 Подключение к MongoDB...');
  await mongoose.connect(MONGODB_URI);
  console.log(`✅ Подключено: ${mongoose.connection.host}`);

  const db = mongoose.connection.db;
  console.log('─'.repeat(50));

  let totalRestored = 0;

  for (const file of files) {
    const name = file.replace('.json', '');
    const filePath = path.join(backupDir, file);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

    const collection = db.collection(name);

    // Очистить коллекцию
    const deleteResult = await collection.deleteMany({});

    // Вставить данные
    if (data.length > 0) {
      await collection.insertMany(data);
    }

    totalRestored += data.length;
    const status = data.length > 0 ? '✅' : '⚪';
    console.log(`  ${status} ${name.padEnd(25)} удалено: ${String(deleteResult.deletedCount).padStart(5)}, вставлено: ${String(data.length).padStart(5)}`);
  }

  console.log('─'.repeat(50));
  console.log(`📊 Итого восстановлено: ${totalRestored} документов`);

  await mongoose.disconnect();
  console.log('\n✅ Восстановление завершено!');
}

restore().catch(err => {
  console.error('❌ Ошибка восстановления:', err.message);
  process.exit(1);
});
