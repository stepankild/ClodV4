import { describe, test, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { connectDB, closeDB, clearDB, mockReq, mockRes } from './testHelper.js';
import mongoose from 'mongoose';
import Strain from '../models/Strain.js';
import { mergeStrains, createStrain, restoreRecentStrains } from '../controllers/strainController.js';

let db;

beforeAll(async () => {
  db = await connectDB();
});

afterAll(async () => {
  await closeDB();
});

beforeEach(async () => {
  await clearDB();
});

// ── Helper to seed data ──
async function seedStrain(name) {
  return Strain.create({ name });
}

async function seedFlowerRoom(strain, flowerStrains = []) {
  return db.db.collection('flowerrooms').insertOne({
    name: 'Test Room',
    strain,
    flowerStrains,
    isActive: true,
    plantsCount: 10
  });
}

async function seedHarvestSession(strain, plants = []) {
  return db.db.collection('harvestsessions').insertOne({
    roomName: 'Test Room',
    strain,
    status: 'in_progress',
    plants,
    plantsCount: 10
  });
}

async function seedVegBatch(strain, strains = []) {
  return db.db.collection('vegbatches').insertOne({
    strain,
    strains,
    diedStrains: [],
    notGrownStrains: [],
    sentToFlowerStrains: []
  });
}

async function seedCloneCut(strain, strains = []) {
  return db.db.collection('clonecuts').insertOne({
    strain,
    strains
  });
}

// ═══════════════════════════════════════════
// MERGE: Basic functionality
// ═══════════════════════════════════════════

describe('Strain Merge - Basic', () => {
  test('merges two strains and soft-deletes source from library', async () => {
    await seedStrain('lt 20');
    await seedStrain('lt20');

    const req = mockReq({ sourceNames: ['lt 20', 'lt20'], targetName: 'lt20' });
    const res = mockRes();

    await mergeStrains(req, res);

    expect(res.json).toHaveBeenCalled();
    const result = res.json.mock.calls[0][0];
    expect(result.target).toBe('lt20');
    expect(result.merged).toEqual(['lt 20']);

    // Target strain should still be active
    const active = await Strain.findOne({ name: 'lt20', deletedAt: null });
    expect(active).not.toBeNull();

    // Source strain should be soft-deleted
    const deleted = await Strain.findOne({ name: 'lt 20' });
    expect(deleted.deletedAt).not.toBeNull();
  });

  test('returns 400 if no targetName', async () => {
    const req = mockReq({ sourceNames: ['a', 'b'], targetName: '' });
    const res = mockRes();
    await mergeStrains(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 400 if sourceNames is empty', async () => {
    const req = mockReq({ sourceNames: [], targetName: 'test' });
    const res = mockRes();
    await mergeStrains(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

// ═══════════════════════════════════════════
// REGRESSION: Target strain must NOT be deleted
// ═══════════════════════════════════════════

describe('Strain Merge - Target preservation (regression)', () => {
  test('target strain is NOT soft-deleted when source regex matches target', async () => {
    // This was the bug: "lt 20" regex ^\s*lt\s*20\s*$ also matches "lt20"
    await seedStrain('lt 20');
    await seedStrain('lt20');

    const req = mockReq({ sourceNames: ['lt 20', 'lt20'], targetName: 'lt20' });
    const res = mockRes();
    await mergeStrains(req, res);

    // Target MUST remain active
    const target = await Strain.findOne({ name: 'lt20' });
    expect(target).not.toBeNull();
    expect(target.deletedAt).toBeNull();

    // Source should be deleted
    const source = await Strain.findOne({ name: 'lt 20' });
    expect(source.deletedAt).not.toBeNull();
  });

  test('target with spaces is NOT deleted when merging variants', async () => {
    await seedStrain('Blue Dream');
    await seedStrain('BlueDream');
    await seedStrain('blue dream');

    const req = mockReq({
      sourceNames: ['Blue Dream', 'BlueDream', 'blue dream'],
      targetName: 'Blue Dream'
    });
    const res = mockRes();
    await mergeStrains(req, res);

    const target = await Strain.findOne({ name: 'Blue Dream' });
    expect(target).not.toBeNull();
    expect(target.deletedAt).toBeNull();
  });
});

// ═══════════════════════════════════════════
// REGRESSION: Only source strains deleted, NOT all strains
// ═══════════════════════════════════════════

describe('Strain Merge - No collateral deletion (regression)', () => {
  test('unrelated strains are NOT affected by merge', async () => {
    await seedStrain('lt 20');
    await seedStrain('lt20');
    await seedStrain('OG Kush');
    await seedStrain('White Widow');
    await seedStrain('Northern Lights');

    const req = mockReq({ sourceNames: ['lt 20', 'lt20'], targetName: 'lt20' });
    const res = mockRes();
    await mergeStrains(req, res);

    // Unrelated strains must be untouched
    for (const name of ['OG Kush', 'White Widow', 'Northern Lights']) {
      const strain = await Strain.findOne({ name, deletedAt: null });
      expect(strain).not.toBeNull();
    }
  });
});

// ═══════════════════════════════════════════
// MERGE: FlowerRoom strain + flowerStrains
// ═══════════════════════════════════════════

describe('Strain Merge - FlowerRoom updates', () => {
  test('updates top-level strain in FlowerRoom', async () => {
    await seedStrain('lt 20');
    await seedStrain('lt20');
    await seedFlowerRoom('lt 20');

    const req = mockReq({ sourceNames: ['lt 20', 'lt20'], targetName: 'lt20' });
    const res = mockRes();
    await mergeStrains(req, res);

    const room = await db.db.collection('flowerrooms').findOne({});
    expect(room.strain).toBe('lt20');
  });

  test('updates flowerStrains array items', async () => {
    await seedStrain('lt 20');
    await seedStrain('lt20');
    await seedFlowerRoom('lt 20 / lt45', [
      { strain: 'lt 20', quantity: 5, startNumber: 1, endNumber: 5 },
      { strain: 'lt45', quantity: 5, startNumber: 6, endNumber: 10 }
    ]);

    const req = mockReq({ sourceNames: ['lt 20', 'lt20'], targetName: 'lt20' });
    const res = mockRes();
    await mergeStrains(req, res);

    const room = await db.db.collection('flowerrooms').findOne({});
    expect(room.flowerStrains[0].strain).toBe('lt20');
    expect(room.flowerStrains[1].strain).toBe('lt45'); // untouched
  });

  test('rebuilds derived strain from flowerStrains after merge', async () => {
    await seedStrain('lt 20');
    await seedStrain('lt20');
    await seedFlowerRoom('lt 20 / lt45', [
      { strain: 'lt 20', quantity: 5, startNumber: 1, endNumber: 5 },
      { strain: 'lt45', quantity: 5, startNumber: 6, endNumber: 10 }
    ]);

    const req = mockReq({ sourceNames: ['lt 20', 'lt20'], targetName: 'lt20' });
    const res = mockRes();
    await mergeStrains(req, res);

    const room = await db.db.collection('flowerrooms').findOne({});
    // Derived strain should be rebuilt from flowerStrains
    expect(room.strain).toBe('lt20 / lt45');
  });
});

// ═══════════════════════════════════════════
// MERGE: HarvestSession
// ═══════════════════════════════════════════

describe('Strain Merge - HarvestSession updates', () => {
  test('updates session strain and plant strains', async () => {
    await seedStrain('lt 20');
    await seedStrain('lt20');
    await seedHarvestSession('lt 20', [
      { plantNumber: 1, strain: 'lt 20', wetWeight: 100 },
      { plantNumber: 2, strain: 'lt 20', wetWeight: 150 }
    ]);

    const req = mockReq({ sourceNames: ['lt 20', 'lt20'], targetName: 'lt20' });
    const res = mockRes();
    await mergeStrains(req, res);

    const session = await db.db.collection('harvestsessions').findOne({});
    expect(session.strain).toBe('lt20');
    expect(session.plants[0].strain).toBe('lt20');
    expect(session.plants[1].strain).toBe('lt20');
  });
});

// ═══════════════════════════════════════════
// MERGE: Case-insensitive and whitespace-tolerant
// ═══════════════════════════════════════════

describe('Strain Merge - Fuzzy matching', () => {
  test('matches case-insensitively', async () => {
    await seedStrain('LT 20');
    await seedStrain('lt20');
    await seedFlowerRoom('LT 20');

    const req = mockReq({ sourceNames: ['LT 20', 'lt20'], targetName: 'lt20' });
    const res = mockRes();
    await mergeStrains(req, res);

    const room = await db.db.collection('flowerrooms').findOne({});
    expect(room.strain).toBe('lt20');
  });

  test('matches with extra whitespace', async () => {
    await seedStrain('lt  20');
    await seedStrain('lt20');
    await seedFlowerRoom('lt  20');

    const req = mockReq({ sourceNames: ['lt  20', 'lt20'], targetName: 'lt20' });
    const res = mockRes();
    await mergeStrains(req, res);

    const room = await db.db.collection('flowerrooms').findOne({});
    expect(room.strain).toBe('lt20');
  });
});

// ═══════════════════════════════════════════
// MERGE: VegBatch and CloneCut
// ═══════════════════════════════════════════

describe('Strain Merge - VegBatch and CloneCut', () => {
  test('updates VegBatch strain and strains array, rebuilds derived', async () => {
    await seedStrain('lt 20');
    await seedStrain('lt20');
    await seedVegBatch('lt 20, Super Haze', [
      { strain: 'lt 20', quantity: 5 },
      { strain: 'Super Haze', quantity: 3 }
    ]);

    const req = mockReq({ sourceNames: ['lt 20', 'lt20'], targetName: 'lt20' });
    const res = mockRes();
    await mergeStrains(req, res);

    const batch = await db.db.collection('vegbatches').findOne({});
    expect(batch.strains[0].strain).toBe('lt20');
    expect(batch.strains[1].strain).toBe('Super Haze'); // untouched
    // Derived field rebuilt
    expect(batch.strain).toBe('lt20, Super Haze');
  });

  test('updates CloneCut strain and strains array', async () => {
    await seedStrain('lt 20');
    await seedStrain('lt20');
    await seedCloneCut('lt 20', [
      { strain: 'lt 20', quantity: 10 }
    ]);

    const req = mockReq({ sourceNames: ['lt 20', 'lt20'], targetName: 'lt20' });
    const res = mockRes();
    await mergeStrains(req, res);

    const cut = await db.db.collection('clonecuts').findOne({});
    expect(cut.strains[0].strain).toBe('lt20');
    expect(cut.strain).toBe('lt20');
  });
});

// ═══════════════════════════════════════════
// CREATE: Soft-deleted strain restoration
// ═══════════════════════════════════════════

describe('Strain Create - Soft-delete handling (regression)', () => {
  test('restores soft-deleted strain instead of failing on unique index', async () => {
    // Create and soft-delete
    const strain = await Strain.create({ name: 'lt 20' });
    strain.deletedAt = new Date();
    await strain.save();

    const req = mockReq({ name: 'lt 20' });
    const res = mockRes();
    await createStrain(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const restored = await Strain.findOne({ name: 'lt 20' });
    expect(restored.deletedAt).toBeNull();
  });

  test('does not create duplicate if active strain exists', async () => {
    await Strain.create({ name: 'lt20' });

    const req = mockReq({ name: 'lt20' });
    const res = mockRes();
    await createStrain(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});

// ═══════════════════════════════════════════
// RESTORE RECENT: Emergency bulk restore
// ═══════════════════════════════════════════

describe('Strain Restore Recent', () => {
  test('restores strains deleted within the time window', async () => {
    const s1 = await Strain.create({ name: 'A', deletedAt: new Date() });
    const s2 = await Strain.create({ name: 'B', deletedAt: new Date() });
    const s3 = await Strain.create({ name: 'C' }); // not deleted

    const req = mockReq({}, {}, { minutes: '60' });
    const res = mockRes();
    await restoreRecentStrains(req, res);

    const result = res.json.mock.calls[0][0];
    expect(result.restored).toBe(2);

    const allActive = await Strain.find({ deletedAt: null });
    expect(allActive).toHaveLength(3);
  });
});
