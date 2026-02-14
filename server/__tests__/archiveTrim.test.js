import { describe, test, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { connectDB, closeDB, clearDB, mockReq, mockRes } from './testHelper.js';
import mongoose from 'mongoose';
import CycleArchive from '../models/CycleArchive.js';
import TrimLog from '../models/TrimLog.js';
import FlowerRoom from '../models/FlowerRoom.js';
// Import User model so Mongoose registers the schema (needed for .populate('completedBy'))
import User from '../models/User.js';
import {
  getArchives,
  getArchive,
  getArchiveStats,
  updateArchive,
  deleteArchive,
  restoreArchive
} from '../controllers/archiveController.js';
import {
  addTrimLog,
  getTrimLogs,
  deleteTrimLog,
  restoreTrimLog,
  completeTrim
} from '../controllers/trimController.js';

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

// ── Helpers ──

const userId = new mongoose.Types.ObjectId();

function adminUser() {
  return {
    _id: userId,
    name: 'Test Admin',
    getPermissions: async () => ['*']
  };
}

function limitedUser() {
  return {
    _id: userId,
    name: 'Limited User',
    getPermissions: async () => ['harvest:view']
  };
}

async function seedRoom(overrides = {}) {
  return FlowerRoom.create({
    roomNumber: 1,
    name: 'Room 1',
    strain: 'OG Kush',
    plantsCount: 10,
    isActive: true,
    startDate: new Date('2025-01-01'),
    floweringDays: 56,
    ...overrides
  });
}

async function seedArchive(roomId, overrides = {}) {
  return CycleArchive.create({
    room: roomId,
    roomNumber: 1,
    roomName: 'Room 1',
    strain: 'OG Kush',
    strains: ['OG Kush'],
    plantsCount: 10,
    startDate: new Date('2025-01-01'),
    harvestDate: new Date('2025-03-01'),
    floweringDays: 56,
    actualDays: 59,
    harvestData: {
      wetWeight: 2000,
      dryWeight: 500,
      trimWeight: 0,
      quality: 'high',
      notes: ''
    },
    metrics: {
      gramsPerPlant: 50,
      gramsPerDay: 8.5,
      gramsPerWatt: 0
    },
    trimStatus: 'pending',
    ...overrides
  });
}

async function seedTrimLog(archiveId, roomId, overrides = {}) {
  return TrimLog.create({
    archive: archiveId,
    room: roomId,
    roomName: 'Room 1',
    strain: 'OG Kush',
    weight: 25,
    date: new Date('2025-03-05'),
    createdBy: userId,
    ...overrides
  });
}

// ═══════════════════════════════════════════
// ARCHIVE: getArchives
// ═══════════════════════════════════════════

describe('Archive - getArchives', () => {
  test('returns archives with pagination and trim aggregations', async () => {
    const room = await seedRoom();
    const a1 = await seedArchive(room._id, { harvestDate: new Date('2025-03-01') });
    const a2 = await seedArchive(room._id, {
      harvestDate: new Date('2025-04-01'),
      strain: 'Blue Dream',
      strains: ['Blue Dream']
    });

    // Add a trim log to a1 so aggregation picks it up
    await seedTrimLog(a1._id, room._id, { weight: 30 });

    const req = mockReq({}, {}, { limit: '50', skip: '0' });
    const res = mockRes();
    await getArchives(req, res);

    expect(res.json).toHaveBeenCalled();
    const data = res.json.mock.calls[0][0];
    expect(data.total).toBe(2);
    expect(data.archives).toHaveLength(2);
    // Sorted by harvestDate desc: a2 first, a1 second
    expect(data.archives[0]._id.toString()).toBe(a2._id.toString());
    expect(data.archives[1]._id.toString()).toBe(a1._id.toString());
    // Trim aggregation should be attached
    expect(data.archives[1].trimLogWeight).toBe(30);
    expect(data.archives[1].trimLogEntries).toBe(1);
    // a2 has no trim logs
    expect(data.archives[0].trimLogWeight).toBe(0);
  });

  test('does not return soft-deleted archives', async () => {
    const room = await seedRoom();
    await seedArchive(room._id);
    await seedArchive(room._id, { deletedAt: new Date() });

    const req = mockReq({}, {}, {});
    const res = mockRes();
    await getArchives(req, res);

    const data = res.json.mock.calls[0][0];
    expect(data.total).toBe(1);
    expect(data.archives).toHaveLength(1);
  });

  test('filters by strain query parameter', async () => {
    const room = await seedRoom();
    await seedArchive(room._id, { strain: 'OG Kush' });
    await seedArchive(room._id, { strain: 'Blue Dream', strains: ['Blue Dream'] });

    const req = mockReq({}, {}, { strain: 'OG' });
    const res = mockRes();
    await getArchives(req, res);

    const data = res.json.mock.calls[0][0];
    expect(data.total).toBe(1);
    expect(data.archives[0].strain).toBe('OG Kush');
  });
});

// ═══════════════════════════════════════════
// ARCHIVE: getArchive
// ═══════════════════════════════════════════

describe('Archive - getArchive', () => {
  test('returns single archive by id', async () => {
    const room = await seedRoom();
    const archive = await seedArchive(room._id);

    const req = mockReq({}, { id: archive._id.toString() });
    const res = mockRes();
    await getArchive(req, res);

    expect(res.json).toHaveBeenCalled();
    const data = res.json.mock.calls[0][0];
    expect(data._id.toString()).toBe(archive._id.toString());
    expect(data.strain).toBe('OG Kush');
  });

  test('returns 404 for non-existent archive', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const req = mockReq({}, { id: fakeId.toString() });
    const res = mockRes();
    await getArchive(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('returns 404 for soft-deleted archive', async () => {
    const room = await seedRoom();
    const archive = await seedArchive(room._id, { deletedAt: new Date() });

    const req = mockReq({}, { id: archive._id.toString() });
    const res = mockRes();
    await getArchive(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ═══════════════════════════════════════════
// ARCHIVE: updateArchive
// ═══════════════════════════════════════════

describe('Archive - updateArchive', () => {
  test('updates harvest data fields (dryWeight, trimWeight, quality) with admin permissions', async () => {
    const room = await seedRoom();
    const archive = await seedArchive(room._id);

    const req = mockReq(
      {
        harvestData: { dryWeight: 600, trimWeight: 80, quality: 'premium' }
      },
      { id: archive._id.toString() },
      {},
      adminUser()
    );
    const res = mockRes();
    await updateArchive(req, res);

    expect(res.json).toHaveBeenCalled();
    const data = res.json.mock.calls[0][0];
    expect(data.harvestData.dryWeight).toBe(600);
    expect(data.harvestData.trimWeight).toBe(80);
    expect(data.harvestData.quality).toBe('premium');
    // Metrics should be recalculated
    expect(data.metrics.gramsPerPlant).toBe(60); // 600 / 10 plants
  });

  test('rejects weight edits without harvest:edit_weights permission', async () => {
    const room = await seedRoom();
    const archive = await seedArchive(room._id);

    const req = mockReq(
      { harvestData: { dryWeight: 999 } },
      { id: archive._id.toString() },
      {},
      limitedUser()
    );
    const res = mockRes();
    await updateArchive(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('allows notes update without special permissions', async () => {
    const room = await seedRoom();
    const archive = await seedArchive(room._id);

    const req = mockReq(
      { notes: 'Updated notes here' },
      { id: archive._id.toString() },
      {},
      limitedUser()
    );
    const res = mockRes();
    await updateArchive(req, res);

    expect(res.json).toHaveBeenCalled();
    const data = res.json.mock.calls[0][0];
    expect(data.notes).toBe('Updated notes here');
  });

  test('returns 404 for non-existent archive', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const req = mockReq(
      { harvestData: { dryWeight: 100 } },
      { id: fakeId.toString() },
      {},
      adminUser()
    );
    const res = mockRes();
    await updateArchive(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ═══════════════════════════════════════════
// ARCHIVE: deleteArchive (soft delete)
// ═══════════════════════════════════════════

describe('Archive - deleteArchive', () => {
  test('soft-deletes archive by setting deletedAt', async () => {
    const room = await seedRoom();
    const archive = await seedArchive(room._id);

    const req = mockReq({}, { id: archive._id.toString() }, {}, adminUser());
    const res = mockRes();
    await deleteArchive(req, res);

    expect(res.json).toHaveBeenCalled();

    // Verify it is soft-deleted in the database
    const doc = await CycleArchive.findById(archive._id);
    expect(doc.deletedAt).not.toBeNull();
    expect(doc.deletedAt).toBeInstanceOf(Date);
  });

  test('returns 404 for non-existent archive', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const req = mockReq({}, { id: fakeId.toString() }, {}, adminUser());
    const res = mockRes();
    await deleteArchive(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('returns 404 for already-deleted archive', async () => {
    const room = await seedRoom();
    const archive = await seedArchive(room._id, { deletedAt: new Date() });

    const req = mockReq({}, { id: archive._id.toString() }, {}, adminUser());
    const res = mockRes();
    await deleteArchive(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ═══════════════════════════════════════════
// ARCHIVE: restoreArchive
// ═══════════════════════════════════════════

describe('Archive - restoreArchive', () => {
  test('restores soft-deleted archive by clearing deletedAt', async () => {
    const room = await seedRoom();
    const archive = await seedArchive(room._id, { deletedAt: new Date() });

    const req = mockReq({}, { id: archive._id.toString() }, {}, adminUser());
    const res = mockRes();
    await restoreArchive(req, res);

    expect(res.json).toHaveBeenCalled();
    const data = res.json.mock.calls[0][0];
    expect(data.deletedAt).toBeNull();

    // Verify in database
    const doc = await CycleArchive.findById(archive._id);
    expect(doc.deletedAt).toBeNull();
  });

  test('returns 404 for non-deleted archive', async () => {
    const room = await seedRoom();
    const archive = await seedArchive(room._id);

    const req = mockReq({}, { id: archive._id.toString() }, {}, adminUser());
    const res = mockRes();
    await restoreArchive(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ═══════════════════════════════════════════
// ARCHIVE: getArchiveStats
// ═══════════════════════════════════════════

describe('Archive - getArchiveStats', () => {
  test('returns aggregated statistics', async () => {
    const room = await seedRoom();
    const a1 = await seedArchive(room._id, {
      harvestData: { wetWeight: 2000, dryWeight: 500, trimWeight: 0, quality: 'high' },
      plantsCount: 10,
      actualDays: 59
    });
    const a2 = await seedArchive(room._id, {
      strain: 'Blue Dream',
      strains: ['Blue Dream'],
      harvestDate: new Date('2025-04-01'),
      harvestData: { wetWeight: 3000, dryWeight: 700, trimWeight: 0, quality: 'premium' },
      plantsCount: 12,
      actualDays: 62
    });

    // Add trim logs
    await seedTrimLog(a1._id, room._id, { weight: 40 });
    await seedTrimLog(a2._id, room._id, { weight: 60, strain: 'Blue Dream' });

    const req = mockReq({}, {}, { period: 'all' });
    const res = mockRes();
    await getArchiveStats(req, res);

    expect(res.json).toHaveBeenCalled();
    const data = res.json.mock.calls[0][0];

    // total stats
    expect(data.total.totalCycles).toBe(2);
    expect(data.total.totalDryWeight).toBe(1200); // 500 + 700
    expect(data.total.totalTrimWeight).toBe(100); // 40 + 60
    expect(data.total.totalTrimEntries).toBe(2);

    // byStrain
    expect(data.byStrain).toBeInstanceOf(Array);
    expect(data.byStrain.length).toBeGreaterThanOrEqual(1);

    // byMonth
    expect(data.byMonth).toBeInstanceOf(Array);

    // byRoom
    expect(data.byRoom).toBeInstanceOf(Array);
  });

  test('excludes soft-deleted archives from total stats', async () => {
    const room = await seedRoom();
    await seedArchive(room._id, {
      harvestData: { wetWeight: 2000, dryWeight: 500, trimWeight: 0, quality: 'high' }
    });
    await seedArchive(room._id, {
      deletedAt: new Date(),
      harvestData: { wetWeight: 1000, dryWeight: 300, trimWeight: 0, quality: 'medium' }
    });

    const req = mockReq({}, {}, { period: 'all' });
    const res = mockRes();
    await getArchiveStats(req, res);

    const data = res.json.mock.calls[0][0];
    // Only the non-deleted archive should count in total stats
    expect(data.total.totalCycles).toBe(1);
    expect(data.total.totalDryWeight).toBe(500);
  });
});

// ═══════════════════════════════════════════
// TRIM: addTrimLog
// ═══════════════════════════════════════════

describe('Trim - addTrimLog', () => {
  test('creates trim log entry with weight, strain, date', async () => {
    const room = await seedRoom();
    const archive = await seedArchive(room._id);

    const req = mockReq(
      {
        archiveId: archive._id.toString(),
        strain: 'OG Kush',
        weight: 35,
        date: '2025-03-10'
      },
      {},
      {},
      adminUser()
    );
    const res = mockRes();
    await addTrimLog(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const log = res.json.mock.calls[0][0];
    expect(log.weight).toBe(35);
    expect(log.strain).toBe('OG Kush');
    expect(log.archive.toString()).toBe(archive._id.toString());

    // Archive trimWeight should be recalculated
    const updatedArchive = await CycleArchive.findById(archive._id);
    expect(updatedArchive.harvestData.trimWeight).toBe(35);
    expect(updatedArchive.trimStatus).toBe('in_progress');
  });

  test('auto-selects strain when archive has single strain and none provided', async () => {
    const room = await seedRoom();
    const archive = await seedArchive(room._id, {
      strain: 'White Widow',
      strains: ['White Widow']
    });

    const req = mockReq(
      {
        archiveId: archive._id.toString(),
        weight: 20,
        date: '2025-03-10'
      },
      {},
      {},
      adminUser()
    );
    const res = mockRes();
    await addTrimLog(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const log = res.json.mock.calls[0][0];
    expect(log.strain).toBe('White Widow');
  });

  test('rejects missing archiveId', async () => {
    const req = mockReq(
      { weight: 25, date: '2025-03-10' },
      {},
      {},
      adminUser()
    );
    const res = mockRes();
    await addTrimLog(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('rejects missing weight (zero)', async () => {
    const room = await seedRoom();
    const archive = await seedArchive(room._id);

    const req = mockReq(
      {
        archiveId: archive._id.toString(),
        strain: 'OG Kush',
        weight: 0,
        date: '2025-03-10'
      },
      {},
      {},
      adminUser()
    );
    const res = mockRes();
    await addTrimLog(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('rejects negative weight', async () => {
    const room = await seedRoom();
    const archive = await seedArchive(room._id);

    const req = mockReq(
      {
        archiveId: archive._id.toString(),
        strain: 'OG Kush',
        weight: -5,
        date: '2025-03-10'
      },
      {},
      {},
      adminUser()
    );
    const res = mockRes();
    await addTrimLog(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('rejects when trim is already completed', async () => {
    const room = await seedRoom();
    const archive = await seedArchive(room._id, { trimStatus: 'completed' });

    const req = mockReq(
      {
        archiveId: archive._id.toString(),
        strain: 'OG Kush',
        weight: 25,
        date: '2025-03-10'
      },
      {},
      {},
      adminUser()
    );
    const res = mockRes();
    await addTrimLog(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('rejects strain not in archive strains list', async () => {
    const room = await seedRoom();
    const archive = await seedArchive(room._id, {
      strain: 'OG Kush',
      strains: ['OG Kush']
    });

    const req = mockReq(
      {
        archiveId: archive._id.toString(),
        strain: 'Unknown Strain',
        weight: 25,
        date: '2025-03-10'
      },
      {},
      {},
      adminUser()
    );
    const res = mockRes();
    await addTrimLog(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});

// ═══════════════════════════════════════════
// TRIM: getTrimLogs
// ═══════════════════════════════════════════

describe('Trim - getTrimLogs', () => {
  test('returns logs for specific archive', async () => {
    const room = await seedRoom();
    const a1 = await seedArchive(room._id);
    const a2 = await seedArchive(room._id, {
      strain: 'Blue Dream',
      strains: ['Blue Dream'],
      harvestDate: new Date('2025-04-01')
    });

    await seedTrimLog(a1._id, room._id, { weight: 20 });
    await seedTrimLog(a1._id, room._id, { weight: 30, date: new Date('2025-03-06') });
    await seedTrimLog(a2._id, room._id, { weight: 40, strain: 'Blue Dream' });

    const req = mockReq({}, { archiveId: a1._id.toString() });
    const res = mockRes();
    await getTrimLogs(req, res);

    expect(res.json).toHaveBeenCalled();
    const logs = res.json.mock.calls[0][0];
    expect(logs).toHaveLength(2);
    logs.forEach((log) => {
      expect(log.archive.toString()).toBe(a1._id.toString());
    });
  });

  test('does not return soft-deleted trim logs', async () => {
    const room = await seedRoom();
    const archive = await seedArchive(room._id);

    await seedTrimLog(archive._id, room._id, { weight: 20 });
    await seedTrimLog(archive._id, room._id, { weight: 30, deletedAt: new Date() });

    const req = mockReq({}, { archiveId: archive._id.toString() });
    const res = mockRes();
    await getTrimLogs(req, res);

    const logs = res.json.mock.calls[0][0];
    expect(logs).toHaveLength(1);
    expect(logs[0].weight).toBe(20);
  });
});

// ═══════════════════════════════════════════
// TRIM: deleteTrimLog (soft delete)
// ═══════════════════════════════════════════

describe('Trim - deleteTrimLog', () => {
  test('soft-deletes trim log and recalculates archive trimWeight', async () => {
    const room = await seedRoom();
    const archive = await seedArchive(room._id, { trimStatus: 'in_progress' });

    const log1 = await seedTrimLog(archive._id, room._id, { weight: 25 });
    const log2 = await seedTrimLog(archive._id, room._id, { weight: 35 });

    // Manually set archive trimWeight to match both logs
    archive.harvestData.trimWeight = 60;
    await archive.save();

    const req = mockReq({}, { id: log1._id.toString() }, {}, adminUser());
    const res = mockRes();
    await deleteTrimLog(req, res);

    expect(res.json).toHaveBeenCalled();

    // Verify log is soft-deleted
    const deletedLog = await TrimLog.findById(log1._id);
    expect(deletedLog.deletedAt).not.toBeNull();

    // Archive trimWeight should be recalculated to only log2
    const updatedArchive = await CycleArchive.findById(archive._id);
    expect(updatedArchive.harvestData.trimWeight).toBe(35);
  });

  test('resets trimStatus to pending when all logs deleted', async () => {
    const room = await seedRoom();
    const archive = await seedArchive(room._id, { trimStatus: 'in_progress' });
    const log = await seedTrimLog(archive._id, room._id, { weight: 25 });

    archive.harvestData.trimWeight = 25;
    await archive.save();

    const req = mockReq({}, { id: log._id.toString() }, {}, adminUser());
    const res = mockRes();
    await deleteTrimLog(req, res);

    const updatedArchive = await CycleArchive.findById(archive._id);
    expect(updatedArchive.harvestData.trimWeight).toBe(0);
    expect(updatedArchive.trimStatus).toBe('pending');
  });

  test('returns 404 for non-existent trim log', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const req = mockReq({}, { id: fakeId.toString() }, {}, adminUser());
    const res = mockRes();
    await deleteTrimLog(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('returns 404 for already-deleted trim log', async () => {
    const room = await seedRoom();
    const archive = await seedArchive(room._id);
    const log = await seedTrimLog(archive._id, room._id, { deletedAt: new Date() });

    const req = mockReq({}, { id: log._id.toString() }, {}, adminUser());
    const res = mockRes();
    await deleteTrimLog(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ═══════════════════════════════════════════
// TRIM: restoreTrimLog
// ═══════════════════════════════════════════

describe('Trim - restoreTrimLog', () => {
  test('restores soft-deleted trim log and recalculates archive trimWeight', async () => {
    const room = await seedRoom();
    const archive = await seedArchive(room._id, { trimStatus: 'pending' });

    // Create a deleted log
    const log = await seedTrimLog(archive._id, room._id, {
      weight: 45,
      deletedAt: new Date()
    });

    const req = mockReq({}, { id: log._id.toString() }, {}, adminUser());
    const res = mockRes();
    await restoreTrimLog(req, res);

    expect(res.json).toHaveBeenCalled();
    const data = res.json.mock.calls[0][0];
    expect(data.deletedAt).toBeNull();

    // Verify in database
    const restoredLog = await TrimLog.findById(log._id);
    expect(restoredLog.deletedAt).toBeNull();

    // Archive trimWeight should be recalculated
    const updatedArchive = await CycleArchive.findById(archive._id);
    expect(updatedArchive.harvestData.trimWeight).toBe(45);
    // trimStatus should change from pending to in_progress
    expect(updatedArchive.trimStatus).toBe('in_progress');
  });

  test('returns 404 for non-deleted trim log', async () => {
    const room = await seedRoom();
    const archive = await seedArchive(room._id);
    const log = await seedTrimLog(archive._id, room._id);

    const req = mockReq({}, { id: log._id.toString() }, {}, adminUser());
    const res = mockRes();
    await restoreTrimLog(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('returns 404 for non-existent trim log', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const req = mockReq({}, { id: fakeId.toString() }, {}, adminUser());
    const res = mockRes();
    await restoreTrimLog(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ═══════════════════════════════════════════
// TRIM: completeTrim
// ═══════════════════════════════════════════

describe('Trim - completeTrim', () => {
  test('marks archive trim as completed', async () => {
    const room = await seedRoom();
    const archive = await seedArchive(room._id, { trimStatus: 'in_progress' });

    const req = mockReq({}, { archiveId: archive._id.toString() }, {}, adminUser());
    const res = mockRes();
    await completeTrim(req, res);

    expect(res.json).toHaveBeenCalled();
    const data = res.json.mock.calls[0][0];
    expect(data.trimStatus).toBe('completed');
    expect(data.trimCompletedAt).not.toBeNull();

    // Verify in database
    const updated = await CycleArchive.findById(archive._id);
    expect(updated.trimStatus).toBe('completed');
    expect(updated.trimCompletedAt).toBeInstanceOf(Date);
  });

  test('returns 404 for non-existent archive', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const req = mockReq({}, { archiveId: fakeId.toString() }, {}, adminUser());
    const res = mockRes();
    await completeTrim(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});
