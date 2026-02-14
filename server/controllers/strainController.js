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

// @desc    Merge multiple strains into one (rename all occurrences in DB)
// @route   POST /api/strains/merge
export const mergeStrains = async (req, res) => {
  try {
    const { sourceNames, targetName } = req.body;
    if (!targetName || !targetName.trim()) {
      return res.status(400).json({ message: 'Целевое название обязательно' });
    }
    if (!Array.isArray(sourceNames) || sourceNames.length === 0) {
      return res.status(400).json({ message: 'Нужно указать хотя бы один сорт для объединения' });
    }

    const target = targetName.trim();
    // Names to replace (excluding the target itself)
    const namesToReplace = sourceNames
      .map(n => (typeof n === 'string' ? n.trim() : ''))
      .filter(n => n && n !== target);

    if (namesToReplace.length === 0) {
      return res.status(400).json({ message: 'Нечего объединять' });
    }

    const db = mongoose.connection.db;
    const stats = { collections: {}, totalUpdated: 0 };

    // Build regex patterns for case-insensitive + whitespace-tolerant matching
    const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const buildPattern = (name) => {
      // Replace each space/whitespace run with \s* so "lt 20" matches "lt20", "lt  20", etc.
      const parts = name.trim().split(/\s+/);
      return new RegExp('^\\s*' + parts.map(escapeRegex).join('\\s*') + '\\s*$', 'i');
    };
    const patterns = namesToReplace.map(buildPattern);
    // Combined regex for MongoDB $or queries
    const regexFilters = patterns.map(p => ({ $regex: p }));

    // Check if a string matches any of the source names (fuzzy)
    const matchesAny = (str) => {
      if (!str) return false;
      return patterns.some(p => p.test(str));
    };

    // Helper: update top-level `strain` field
    const updateTopLevel = async (collectionName, field = 'strain') => {
      const docs = await db.collection(collectionName).find({
        $or: regexFilters.map(r => ({ [field]: r }))
      }).toArray();
      let count = 0;
      for (const doc of docs) {
        if (matchesAny(doc[field])) {
          await db.collection(collectionName).updateOne(
            { _id: doc._id },
            { $set: { [field]: target } }
          );
          count++;
        }
      }
      return count;
    };

    // Helper: update array of objects with `.strain` field
    const updateArrayField = async (collectionName, arrayField) => {
      const docs = await db.collection(collectionName).find({
        $or: regexFilters.map(r => ({ [`${arrayField}.strain`]: r }))
      }).toArray();
      let count = 0;
      for (const doc of docs) {
        let changed = false;
        const arr = doc[arrayField];
        if (Array.isArray(arr)) {
          for (const item of arr) {
            if (matchesAny(item.strain)) {
              item.strain = target;
              changed = true;
            }
          }
        }
        if (changed) {
          await db.collection(collectionName).updateOne(
            { _id: doc._id },
            { $set: { [arrayField]: arr } }
          );
          count++;
        }
      }
      return count;
    };

    // Helper: update nested array path like cloneData.strains
    const updateNestedArrayField = async (collectionName, parentField, arrayField) => {
      const fullPath = `${parentField}.${arrayField}`;
      const docs = await db.collection(collectionName).find({
        $or: regexFilters.map(r => ({ [`${fullPath}.strain`]: r }))
      }).toArray();
      let count = 0;
      for (const doc of docs) {
        const parent = doc[parentField];
        if (!parent || !Array.isArray(parent[arrayField])) continue;
        let changed = false;
        for (const item of parent[arrayField]) {
          if (matchesAny(item.strain)) {
            item.strain = target;
            changed = true;
          }
        }
        if (changed) {
          await db.collection(collectionName).updateOne(
            { _id: doc._id },
            { $set: { [fullPath]: parent[arrayField] } }
          );
          count++;
        }
      }
      return count;
    };

    // Helper: update string array (CycleArchive.strains is string[])
    const updateStringArray = async (collectionName, arrayField) => {
      const docs = await db.collection(collectionName).find({
        $or: regexFilters.map(r => ({ [arrayField]: r }))
      }).toArray();
      let count = 0;
      for (const doc of docs) {
        const arr = doc[arrayField];
        if (!Array.isArray(arr)) continue;
        let changed = false;
        const newArr = arr.map(s => {
          if (matchesAny(s)) { changed = true; return target; }
          return s;
        });
        if (changed) {
          await db.collection(collectionName).updateOne(
            { _id: doc._id },
            { $set: { [arrayField]: newArr } }
          );
          count++;
        }
      }
      return count;
    };

    // Helper: update plants array (HarvestSession.plants, CycleArchive.harvestMapData.plants)
    const updatePlantsStrain = async (collectionName, plantsPath) => {
      const docs = await db.collection(collectionName).find({
        $or: regexFilters.map(r => ({ [`${plantsPath}.strain`]: r }))
      }).toArray();
      let count = 0;
      for (const doc of docs) {
        const parts = plantsPath.split('.');
        let obj = doc;
        for (const p of parts.slice(0, -1)) obj = obj?.[p];
        const plants = obj?.[parts[parts.length - 1]];
        if (!Array.isArray(plants)) continue;
        let changed = false;
        for (const p of plants) {
          if (matchesAny(p.strain)) {
            p.strain = target;
            changed = true;
          }
        }
        if (changed) {
          await db.collection(collectionName).updateOne(
            { _id: doc._id },
            { $set: { [plantsPath]: plants } }
          );
          count++;
        }
      }
      return count;
    };

    // 1. CloneCut
    let cc = 0;
    cc += await updateTopLevel('clonecuts');
    cc += await updateArrayField('clonecuts', 'strains');
    stats.collections.clonecuts = cc;
    stats.totalUpdated += cc;

    // 2. VegBatch
    let vb = 0;
    vb += await updateTopLevel('vegbatches');
    vb += await updateArrayField('vegbatches', 'strains');
    vb += await updateArrayField('vegbatches', 'diedStrains');
    vb += await updateArrayField('vegbatches', 'notGrownStrains');
    vb += await updateArrayField('vegbatches', 'sentToFlowerStrains');
    stats.collections.vegbatches = vb;
    stats.totalUpdated += vb;

    // 3. FlowerRoom
    let fr = 0;
    fr += await updateTopLevel('flowerrooms');
    fr += await updateArrayField('flowerrooms', 'flowerStrains');
    stats.collections.flowerrooms = fr;
    stats.totalUpdated += fr;

    // 4. PlannedCycle
    let pc = await updateTopLevel('plannedcycles');
    stats.collections.plannedcycles = pc;
    stats.totalUpdated += pc;

    // 5. CycleArchive
    let ca = 0;
    ca += await updateTopLevel('cyclearchives');
    ca += await updateStringArray('cyclearchives', 'strains');
    ca += await updateArrayField('cyclearchives', 'strainData');
    ca += await updateNestedArrayField('cyclearchives', 'cloneData', 'strains');
    ca += await updatePlantsStrain('cyclearchives', 'harvestMapData.plants');
    stats.collections.cyclearchives = ca;
    stats.totalUpdated += ca;

    // 6. HarvestSession
    let hs = 0;
    hs += await updateTopLevel('harvestsessions');
    hs += await updatePlantsStrain('harvestsessions', 'plants');
    stats.collections.harvestsessions = hs;
    stats.totalUpdated += hs;

    // 7. TrimLog
    let tl = await updateTopLevel('trimlogs');
    stats.collections.trimlogs = tl;
    stats.totalUpdated += tl;

    // Soft-delete merged strains from Strain library (keep target, case-insensitive)
    const strainRegexFilters = patterns.map(p => ({ name: { $regex: p } }));
    const deletedStrains = await Strain.updateMany(
      { $or: strainRegexFilters, ...notDeleted },
      { $set: { deletedAt: new Date() } }
    );

    await createAuditLog(req, {
      action: 'strain.merge',
      entityType: 'Strain',
      details: {
        sourceNames: namesToReplace,
        targetName: target,
        stats
      }
    });

    res.json({
      message: `Объединено ${namesToReplace.length} сортов в «${target}»`,
      merged: namesToReplace,
      target,
      deletedFromLibrary: deletedStrains.modifiedCount,
      stats
    });
  } catch (error) {
    console.error('Merge strains error:', error);
    res.status(500).json({ message: 'Ошибка объединения' });
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
