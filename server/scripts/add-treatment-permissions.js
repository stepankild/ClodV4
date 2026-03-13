/**
 * Migration: Add treatment permissions to existing database
 * Run: node server/scripts/add-treatment-permissions.js
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const TREATMENT_PERMISSIONS = [
  { name: 'treatments:view', description: 'Видеть раздел «Обработка»', module: 'treatments' },
  { name: 'treatments:manage', description: 'Создавать/редактировать протоколы и препараты', module: 'treatments' },
  { name: 'treatments:apply', description: 'Назначать протоколы комнатам', module: 'treatments' },
  { name: 'treatments:create', description: 'Создавать записи обработок', module: 'treatments' },
  { name: 'treatments:edit', description: 'Редактировать записи обработок', module: 'treatments' },
  { name: 'treatments:delete', description: 'Удалять записи обработок', module: 'treatments' },
  { name: 'treatments:products', description: 'Управлять базой препаратов', module: 'treatments' },
];

// Role -> permissions to add
const ROLE_PERMISSIONS = {
  Admin: ['treatments:view', 'treatments:manage', 'treatments:apply', 'treatments:create', 'treatments:edit', 'treatments:delete', 'treatments:products'],
  Grower: ['treatments:view', 'treatments:apply', 'treatments:create', 'treatments:edit', 'treatments:products'],
  Worker: ['treatments:view', 'treatments:create'],
  Viewer: ['treatments:view'],
};

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  const Permission = mongoose.model('Permission', new mongoose.Schema({
    name: String, description: String, module: String
  }));
  const Role = mongoose.model('Role', new mongoose.Schema({
    name: String, permissions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Permission' }]
  }));

  // Upsert permissions
  const permMap = {};
  for (const p of TREATMENT_PERMISSIONS) {
    let existing = await Permission.findOne({ name: p.name });
    if (!existing) {
      existing = await Permission.create(p);
      console.log(`  Created permission: ${p.name}`);
    } else {
      console.log(`  Already exists: ${p.name}`);
    }
    permMap[p.name] = existing._id;
  }

  // Add to roles
  for (const [roleName, permNames] of Object.entries(ROLE_PERMISSIONS)) {
    const role = await Role.findOne({ name: roleName });
    if (!role) {
      console.log(`  Role "${roleName}" not found, skipping`);
      continue;
    }
    const existingIds = role.permissions.map(id => id.toString());
    let added = 0;
    for (const pn of permNames) {
      const pid = permMap[pn];
      if (pid && !existingIds.includes(pid.toString())) {
        role.permissions.push(pid);
        added++;
      }
    }
    if (added > 0) {
      await role.save();
      console.log(`  Role "${roleName}": added ${added} permission(s)`);
    } else {
      console.log(`  Role "${roleName}": already up to date`);
    }
  }

  console.log('\nDone!');
  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
