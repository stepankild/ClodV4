/**
 * Full MongoDB backup to JSON files
 * Usage: MONGODB_URI="..." node scripts/backup-db.js [output-dir]
 */
import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('MONGODB_URI not set');
  process.exit(1);
}

const outputDir = process.argv[2] || path.join(__dirname, '..', '..', '..', '..', '..', 'Desktop', `db-backup-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${Date.now()}`);

async function backup() {
  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB');

  const db = mongoose.connection.db;
  const collections = await db.listCollections().toArray();

  fs.mkdirSync(outputDir, { recursive: true });

  let totalDocs = 0;

  for (const col of collections) {
    const name = col.name;
    const docs = await db.collection(name).find({}).toArray();
    const filePath = path.join(outputDir, `${name}.json`);
    fs.writeFileSync(filePath, JSON.stringify(docs, null, 2), 'utf8');
    console.log(`  ${name}: ${docs.length} docs`);
    totalDocs += docs.length;
  }

  console.log(`\n✅ Backup complete: ${collections.length} collections, ${totalDocs} documents`);
  console.log(`📁 ${outputDir}`);

  await mongoose.disconnect();
}

backup().catch(err => {
  console.error('Backup failed:', err.message);
  process.exit(1);
});
