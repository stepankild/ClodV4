/**
 * Добавление пермишенов для модуля обработок (treatments).
 * Upsert — безопасно запускать повторно.
 *
 * Запуск:  node server/scripts/addTreatmentPermissions.js
 */

import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

import connectDB from '../config/db.js';
import Permission from '../models/Permission.js';
import Role from '../models/Role.js';

const newPermissions = [
  { name: 'treatments:view', description: 'Видеть раздел «Обработки»', module: 'treatments' },
  { name: 'treatments:create', description: 'Создавать записи обработок', module: 'treatments' },
  { name: 'treatments:edit', description: 'Редактировать записи обработок', module: 'treatments' },
  { name: 'treatments:delete', description: 'Удалять записи обработок', module: 'treatments' },
  { name: 'treatments:products', description: 'Управлять базой препаратов', module: 'treatments' }
];

// Какие пермишены получает каждая роль
const rolePermissions = {
  Admin: ['treatments:view', 'treatments:create', 'treatments:edit', 'treatments:delete', 'treatments:products'],
  Grower: ['treatments:view', 'treatments:create', 'treatments:edit', 'treatments:products'],
  Worker: ['treatments:view', 'treatments:create'],
  Viewer: ['treatments:view']
};

const run = async () => {
  try {
    await connectDB();
    console.log('Connected to MongoDB');

    // 1. Upsert permissions
    const permIds = {};
    for (const perm of newPermissions) {
      const doc = await Permission.findOneAndUpdate(
        { name: perm.name },
        { $setOnInsert: perm },
        { upsert: true, new: true }
      );
      permIds[perm.name] = doc._id;
      console.log(`  Permission: ${perm.name} → ${doc._id}`);
    }

    // 2. Assign to roles
    for (const [roleName, permNames] of Object.entries(rolePermissions)) {
      const role = await Role.findOne({ name: roleName });
      if (!role) {
        console.log(`  Role "${roleName}" not found — skipping`);
        continue;
      }
      const idsToAdd = permNames.map(n => permIds[n]).filter(Boolean);
      const existingSet = new Set(role.permissions.map(p => p.toString()));
      const newIds = idsToAdd.filter(id => !existingSet.has(id.toString()));
      if (newIds.length > 0) {
        role.permissions.push(...newIds);
        await role.save();
        console.log(`  Role "${roleName}": added ${newIds.length} permissions`);
      } else {
        console.log(`  Role "${roleName}": already up to date`);
      }
    }

    console.log('\n✅ Treatment permissions added successfully');
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
};

run();
