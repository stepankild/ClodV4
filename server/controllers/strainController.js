import mongoose from 'mongoose';
import Strain from '../models/Strain.js';
import { notDeleted, deletedOnly } from '../utils/softDelete.js';
import { createAuditLog } from '../utils/auditLog.js';

// @desc    Get all strains (active)
// @route   GET /api/strains
export const getStrains = async (req, res) => {
  try {
    const strains = await Strain.find({ ...notDeleted }).sort({ name: 1 }).lean();
    res.json(strains);
  } catch (error) {
    console.error('Get strains error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

// @desc    Create strain
// @route   POST /api/strains
export const createStrain = async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Название сорта обязательно' });
    }
    const trimmed = name.trim();

    // Проверка дубликата (case-insensitive)
    const existing = await Strain.findOne({
      name: { $regex: new RegExp(`^${trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
      ...notDeleted
    });
    if (existing) {
      return res.status(400).json({ message: `Сорт «${existing.name}» уже существует` });
    }

    const strain = await Strain.create({ name: trimmed });
    await createAuditLog(req, {
      action: 'strain.create',
      entityType: 'Strain',
      entityId: strain._id,
      details: { name: trimmed }
    });
    res.status(201).json(strain);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: 'Такой сорт уже существует' });
    }
    console.error('Create strain error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

// @desc    Update strain
// @route   PUT /api/strains/:id
export const updateStrain = async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Название сорта обязательно' });
    }
    const trimmed = name.trim();
    const strain = await Strain.findOne({ _id: req.params.id, ...notDeleted });
    if (!strain) {
      return res.status(404).json({ message: 'Сорт не найден' });
    }

    // Проверка дубликата (кроме себя)
    const existing = await Strain.findOne({
      _id: { $ne: strain._id },
      name: { $regex: new RegExp(`^${trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
      ...notDeleted
    });
    if (existing) {
      return res.status(400).json({ message: `Сорт «${existing.name}» уже существует` });
    }

    const oldName = strain.name;
    strain.name = trimmed;
    await strain.save();
    await createAuditLog(req, {
      action: 'strain.update',
      entityType: 'Strain',
      entityId: strain._id,
      details: { oldName, newName: trimmed }
    });
    res.json(strain);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: 'Такой сорт уже существует' });
    }
    console.error('Update strain error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

// @desc    Soft-delete strain
// @route   DELETE /api/strains/:id
export const deleteStrain = async (req, res) => {
  try {
    const strain = await Strain.findOne({ _id: req.params.id, ...notDeleted });
    if (!strain) {
      return res.status(404).json({ message: 'Сорт не найден' });
    }
    strain.deletedAt = new Date();
    await strain.save();
    await createAuditLog(req, {
      action: 'strain.delete',
      entityType: 'Strain',
      entityId: strain._id,
      details: { name: strain.name }
    });
    res.json({ message: 'Сорт удалён' });
  } catch (error) {
    console.error('Delete strain error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

// @desc    Get deleted strains
// @route   GET /api/strains/deleted
export const getDeletedStrains = async (req, res) => {
  try {
    const strains = await Strain.find({ ...deletedOnly }).sort({ deletedAt: -1 }).lean();
    res.json(strains);
  } catch (error) {
    console.error('Get deleted strains error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

// @desc    Migrate existing strain names from all collections into Strain library
// @route   POST /api/strains/migrate
export const migrateStrains = async (req, res) => {
  try {
    const db = mongoose.connection.db;

    // Collect strain names from all collections
    const allNames = new Set();

    // 1. CloneCut: strain + strains[].strain
    const cloneCuts = await db.collection('clonecuts').find({}).project({ strain: 1, strains: 1 }).toArray();
    for (const doc of cloneCuts) {
      if (doc.strain && typeof doc.strain === 'string' && doc.strain.trim()) allNames.add(doc.strain.trim());
      if (Array.isArray(doc.strains)) {
        for (const s of doc.strains) {
          if (s.strain && typeof s.strain === 'string' && s.strain.trim()) allNames.add(s.strain.trim());
        }
      }
    }

    // 2. VegBatch: strain + strains[].strain + diedStrains[].strain + notGrownStrains[].strain + sentToFlowerStrains[].strain
    const vegBatches = await db.collection('vegbatches').find({}).project({ strain: 1, strains: 1, diedStrains: 1, notGrownStrains: 1, sentToFlowerStrains: 1 }).toArray();
    for (const doc of vegBatches) {
      if (doc.strain && typeof doc.strain === 'string' && doc.strain.trim()) allNames.add(doc.strain.trim());
      for (const arr of [doc.strains, doc.diedStrains, doc.notGrownStrains, doc.sentToFlowerStrains]) {
        if (Array.isArray(arr)) {
          for (const s of arr) {
            if (s.strain && typeof s.strain === 'string' && s.strain.trim()) allNames.add(s.strain.trim());
          }
        }
      }
    }

    // 3. FlowerRoom: strain + flowerStrains[].strain
    const flowerRooms = await db.collection('flowerrooms').find({}).project({ strain: 1, flowerStrains: 1 }).toArray();
    for (const doc of flowerRooms) {
      if (doc.strain && typeof doc.strain === 'string' && doc.strain.trim()) allNames.add(doc.strain.trim());
      if (Array.isArray(doc.flowerStrains)) {
        for (const s of doc.flowerStrains) {
          if (s.strain && typeof s.strain === 'string' && s.strain.trim()) allNames.add(s.strain.trim());
        }
      }
    }

    // 4. PlannedCycle: strain
    const planned = await db.collection('plannedcycles').find({}).project({ strain: 1 }).toArray();
    for (const doc of planned) {
      if (doc.strain && typeof doc.strain === 'string' && doc.strain.trim()) allNames.add(doc.strain.trim());
    }

    // 5. CycleArchive: strain + strains[] + strainData[].strain + cloneData.strains[].strain
    const archives = await db.collection('cyclearchives').find({}).project({ strain: 1, strains: 1, strainData: 1, cloneData: 1 }).toArray();
    for (const doc of archives) {
      if (doc.strain && typeof doc.strain === 'string' && doc.strain.trim()) allNames.add(doc.strain.trim());
      if (Array.isArray(doc.strains)) {
        for (const s of doc.strains) {
          if (typeof s === 'string' && s.trim()) allNames.add(s.trim());
        }
      }
      if (Array.isArray(doc.strainData)) {
        for (const s of doc.strainData) {
          if (s.strain && typeof s.strain === 'string' && s.strain.trim()) allNames.add(s.strain.trim());
        }
      }
      if (doc.cloneData && Array.isArray(doc.cloneData.strains)) {
        for (const s of doc.cloneData.strains) {
          if (s.strain && typeof s.strain === 'string' && s.strain.trim()) allNames.add(s.strain.trim());
        }
      }
    }

    // 6. HarvestSession: strain + plants[].strain
    const harvests = await db.collection('harvestsessions').find({}).project({ strain: 1, plants: 1 }).toArray();
    for (const doc of harvests) {
      if (doc.strain && typeof doc.strain === 'string' && doc.strain.trim()) allNames.add(doc.strain.trim());
      if (Array.isArray(doc.plants)) {
        for (const p of doc.plants) {
          if (p.strain && typeof p.strain === 'string' && p.strain.trim()) allNames.add(p.strain.trim());
        }
      }
    }

    // 7. TrimLog: strain
    const trimLogs = await db.collection('trimlogs').find({}).project({ strain: 1 }).toArray();
    for (const doc of trimLogs) {
      if (doc.strain && typeof doc.strain === 'string' && doc.strain.trim()) allNames.add(doc.strain.trim());
    }

    // Deduplicate case-insensitively: keep the first occurrence
    const uniqueMap = new Map(); // lowerCase -> original
    for (const name of allNames) {
      const lower = name.toLowerCase();
      if (!uniqueMap.has(lower)) {
        uniqueMap.set(lower, name);
      }
    }

    // Get existing strains from library (including deleted)
    const existingStrains = await Strain.find({}).lean();
    const existingLower = new Set(existingStrains.map(s => s.name.toLowerCase()));

    // Insert only new ones
    const toInsert = [];
    for (const [lower, original] of uniqueMap) {
      if (!existingLower.has(lower)) {
        toInsert.push({ name: original });
      }
    }

    let inserted = 0;
    if (toInsert.length > 0) {
      const result = await Strain.insertMany(toInsert, { ordered: false });
      inserted = result.length;
    }

    await createAuditLog(req, {
      action: 'strain.migrate',
      entityType: 'Strain',
      details: {
        foundTotal: uniqueMap.size,
        alreadyExisted: existingLower.size,
        inserted
      }
    });

    res.json({
      message: `Миграция завершена`,
      found: uniqueMap.size,
      alreadyExisted: existingLower.size,
      inserted,
      names: [...uniqueMap.values()].sort()
    });
  } catch (error) {
    console.error('Migrate strains error:', error);
    res.status(500).json({ message: 'Ошибка миграции' });
  }
};

// @desc    Restore deleted strain
// @route   POST /api/strains/deleted/:id/restore
export const restoreStrain = async (req, res) => {
  try {
    const strain = await Strain.findOne({ _id: req.params.id, ...deletedOnly });
    if (!strain) {
      return res.status(404).json({ message: 'Сорт не найден в архиве' });
    }
    strain.deletedAt = null;
    await strain.save();
    await createAuditLog(req, {
      action: 'strain.restore',
      entityType: 'Strain',
      entityId: strain._id,
      details: { name: strain.name }
    });
    res.json(strain);
  } catch (error) {
    console.error('Restore strain error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};
