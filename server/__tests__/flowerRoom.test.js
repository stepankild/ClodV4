import { describe, test, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { connectDB, closeDB, clearDB, mockReq, mockRes } from './testHelper.js';
import mongoose from 'mongoose';
import FlowerRoom from '../models/FlowerRoom.js';
import RoomLog from '../models/RoomLog.js';
import RoomTask from '../models/RoomTask.js';
import { getRooms, getRoom, updateRoom, startCycle, addNote } from '../controllers/flowerRoomController.js';

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

async function seedRoom(overrides = {}) {
  return FlowerRoom.create({
    roomNumber: 1,
    name: 'Комната 1',
    isActive: false,
    ...overrides
  });
}

async function seedAllRooms() {
  const rooms = [];
  for (let i = 1; i <= 5; i++) {
    rooms.push({ roomNumber: i, name: `Комната ${i}`, isActive: false });
  }
  return FlowerRoom.insertMany(rooms);
}

function mockReqWithPerms(body = {}, params = {}, perms = ['*']) {
  const userId = new mongoose.Types.ObjectId();
  return {
    body,
    params,
    query: {},
    user: {
      _id: userId,
      name: 'Test User',
      getPermissions: async () => perms
    },
    ip: '127.0.0.1',
    get: () => 'test-agent'
  };
}

// ═══════════════════════════════════════════
// getRooms
// ═══════════════════════════════════════════

describe('getRooms', () => {
  test('returns all rooms sorted by roomNumber', async () => {
    await seedAllRooms();

    const req = mockReq();
    const res = mockRes();
    await getRooms(req, res);

    expect(res.json).toHaveBeenCalled();
    const rooms = res.json.mock.calls[0][0];
    expect(rooms).toHaveLength(5);
    expect(rooms[0].roomNumber).toBe(1);
    expect(rooms[4].roomNumber).toBe(5);
  });

  test('auto-creates 5 default rooms if none exist', async () => {
    const req = mockReq();
    const res = mockRes();
    await getRooms(req, res);

    expect(res.json).toHaveBeenCalled();
    const rooms = res.json.mock.calls[0][0];
    expect(rooms).toHaveLength(5);
    expect(rooms[0].name).toBe('Комната 1');
    expect(rooms[4].name).toBe('Комната 5');
  });

  test('includes pendingTasks count for each room', async () => {
    const rooms = await seedAllRooms();
    // Add some pending tasks to room 1
    await RoomTask.create({
      room: rooms[0]._id,
      type: 'spray',
      title: 'Test task',
      completed: false
    });
    await RoomTask.create({
      room: rooms[0]._id,
      type: 'trim',
      title: 'Another task',
      completed: false
    });
    // One completed task should not count
    await RoomTask.create({
      room: rooms[0]._id,
      type: 'feed',
      title: 'Done task',
      completed: true
    });

    const req = mockReq();
    const res = mockRes();
    await getRooms(req, res);

    const result = res.json.mock.calls[0][0];
    expect(result[0].pendingTasks).toBe(2);
    expect(result[1].pendingTasks).toBe(0);
  });
});

// ═══════════════════════════════════════════
// getRoom
// ═══════════════════════════════════════════

describe('getRoom', () => {
  test('returns single room by id with tasks and logs', async () => {
    const room = await seedRoom();

    const req = mockReq({}, { id: room._id.toString() });
    const res = mockRes();
    await getRoom(req, res);

    expect(res.json).toHaveBeenCalled();
    const result = res.json.mock.calls[0][0];
    expect(result.roomNumber).toBe(1);
    expect(result.name).toBe('Комната 1');
    expect(result.tasks).toBeDefined();
    expect(result.recentLogs).toBeDefined();
    expect(Array.isArray(result.tasks)).toBe(true);
    expect(Array.isArray(result.recentLogs)).toBe(true);
  });

  test('returns 404 for non-existent id', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const req = mockReq({}, { id: fakeId.toString() });
    const res = mockRes();
    await getRoom(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.any(String) })
    );
  });

  test('returns 500 for invalid id format', async () => {
    const req = mockReq({}, { id: 'invalid-id' });
    const res = mockRes();
    await getRoom(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ═══════════════════════════════════════════
// updateRoom
// ═══════════════════════════════════════════

describe('updateRoom', () => {
  test('updates name field', async () => {
    const room = await seedRoom();

    const req = mockReqWithPerms(
      { name: 'New Name' },
      { id: room._id.toString() }
    );
    const res = mockRes();
    await updateRoom(req, res);

    expect(res.json).toHaveBeenCalled();
    const updated = res.json.mock.calls[0][0];
    expect(updated.name).toBe('New Name');
  });

  test('updates squareMeters', async () => {
    const room = await seedRoom();

    const req = mockReqWithPerms(
      { squareMeters: 25 },
      { id: room._id.toString() }
    );
    const res = mockRes();
    await updateRoom(req, res);

    const updated = res.json.mock.calls[0][0];
    expect(updated.squareMeters).toBe(25);
  });

  test('updates lighting fields', async () => {
    const room = await seedRoom();

    const req = mockReqWithPerms(
      { lighting: { lampCount: 4, lampWattage: 600, lampType: 'HPS' } },
      { id: room._id.toString() }
    );
    const res = mockRes();
    await updateRoom(req, res);

    const updated = res.json.mock.calls[0][0];
    expect(updated.lighting.lampCount).toBe(4);
    expect(updated.lighting.lampWattage).toBe(600);
    expect(updated.lighting.lampType).toBe('HPS');
  });

  test('updates potSize and ventilation', async () => {
    const room = await seedRoom();

    const req = mockReqWithPerms(
      { potSize: 11, ventilation: { intakeType: 'passive', co2: true } },
      { id: room._id.toString() }
    );
    const res = mockRes();
    await updateRoom(req, res);

    const updated = res.json.mock.calls[0][0];
    expect(updated.potSize).toBe(11);
    expect(updated.ventilation.intakeType).toBe('passive');
    expect(updated.ventilation.co2).toBe(true);
  });

  test('updates roomDimensions', async () => {
    const room = await seedRoom();

    const req = mockReqWithPerms(
      { roomDimensions: { length: 3, width: 2, height: 2.5 } },
      { id: room._id.toString() }
    );
    const res = mockRes();
    await updateRoom(req, res);

    const updated = res.json.mock.calls[0][0];
    expect(updated.roomDimensions.length).toBe(3);
    expect(updated.roomDimensions.width).toBe(2);
    expect(updated.roomDimensions.height).toBe(2.5);
  });

  test('updates cycleName requires permission', async () => {
    const room = await seedRoom({ isActive: true, strain: 'Test', cycleName: 'Old' });

    // No permission
    const req = mockReqWithPerms(
      { cycleName: 'New Cycle' },
      { id: room._id.toString() },
      ['rooms:view']
    );
    const res = mockRes();
    await updateRoom(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('updates cycleName with wildcard permission', async () => {
    const room = await seedRoom({ isActive: true, strain: 'Test', cycleName: 'Old' });

    const req = mockReqWithPerms(
      { cycleName: 'New Cycle' },
      { id: room._id.toString() },
      ['*']
    );
    const res = mockRes();
    await updateRoom(req, res);

    const updated = res.json.mock.calls[0][0];
    expect(updated.cycleName).toBe('New Cycle');
  });

  test('returns 404 for non-existent room', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const req = mockReqWithPerms(
      { name: 'X' },
      { id: fakeId.toString() }
    );
    const res = mockRes();
    await updateRoom(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ═══════════════════════════════════════════
// startCycle
// ═══════════════════════════════════════════

describe('startCycle', () => {
  test('sets room to active with strain, plantsCount, startDate, floweringDays', async () => {
    const room = await seedRoom();
    const startDate = new Date('2025-01-15');

    const req = mockReqWithPerms(
      {
        cycleName: 'Cycle 1',
        strain: 'OG Kush',
        plantsCount: 12,
        floweringDays: 63,
        startDate: startDate.toISOString()
      },
      { id: room._id.toString() }
    );
    const res = mockRes();
    await startCycle(req, res);

    expect(res.json).toHaveBeenCalled();
    const updated = res.json.mock.calls[0][0];
    expect(updated.isActive).toBe(true);
    expect(updated.strain).toBe('OG Kush');
    expect(updated.plantsCount).toBe(12);
    expect(updated.floweringDays).toBe(63);
    expect(updated.cycleName).toBe('Cycle 1');
    expect(new Date(updated.startDate).toISOString()).toBe(startDate.toISOString());
    expect(updated.currentCycleId).toBeDefined();
    expect(updated.currentCycleId).not.toBeNull();
  });

  test('defaults floweringDays to 56 if not provided', async () => {
    const room = await seedRoom();

    const req = mockReqWithPerms(
      { strain: 'Test Strain', plantsCount: 5 },
      { id: room._id.toString() }
    );
    const res = mockRes();
    await startCycle(req, res);

    const updated = res.json.mock.calls[0][0];
    expect(updated.floweringDays).toBe(56);
  });

  test('uses current date if startDate not provided', async () => {
    const room = await seedRoom();
    const before = new Date();

    const req = mockReqWithPerms(
      { strain: 'Test', plantsCount: 1 },
      { id: room._id.toString() }
    );
    const res = mockRes();
    await startCycle(req, res);

    const after = new Date();
    const updated = res.json.mock.calls[0][0];
    const savedDate = new Date(updated.startDate);
    expect(savedDate.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    expect(savedDate.getTime()).toBeLessThanOrEqual(after.getTime() + 1000);
  });

  test('calculates expectedHarvestDate from startDate + floweringDays', async () => {
    const room = await seedRoom();
    const startDate = new Date('2025-03-01');

    const req = mockReqWithPerms(
      { strain: 'Test', plantsCount: 1, floweringDays: 60, startDate: startDate.toISOString() },
      { id: room._id.toString() }
    );
    const res = mockRes();
    await startCycle(req, res);

    const updated = res.json.mock.calls[0][0];
    const expected = new Date('2025-03-01');
    expected.setDate(expected.getDate() + 60);
    expect(new Date(updated.expectedHarvestDate).toISOString()).toBe(expected.toISOString());
  });

  test('rejects if room already active', async () => {
    const room = await seedRoom({ isActive: true, strain: 'Running', plantsCount: 10 });

    const req = mockReqWithPerms(
      { strain: 'New Strain', plantsCount: 5 },
      { id: room._id.toString() }
    );
    const res = mockRes();
    await startCycle(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const error = res.json.mock.calls[0][0];
    expect(error.message).toBeDefined();
  });

  test('returns 404 for non-existent room', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const req = mockReqWithPerms(
      { strain: 'X', plantsCount: 1 },
      { id: fakeId.toString() }
    );
    const res = mockRes();
    await startCycle(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('creates a RoomLog entry for cycle_start', async () => {
    const room = await seedRoom();

    const req = mockReqWithPerms(
      { strain: 'Logged Strain', plantsCount: 8, floweringDays: 56 },
      { id: room._id.toString() }
    );
    const res = mockRes();
    await startCycle(req, res);

    const logs = await RoomLog.find({ room: room._id, type: 'cycle_start' });
    expect(logs).toHaveLength(1);
    expect(logs[0].data.strain).toBe('Logged Strain');
    expect(logs[0].data.plantsCount).toBe(8);
    expect(logs[0].dayOfCycle).toBe(1);
  });
});

// ═══════════════════════════════════════════
// startCycle - multi-strain (flowerStrains)
// ═══════════════════════════════════════════

describe('startCycle - flowerStrains (multi-strain)', () => {
  test('sets flowerStrains array with strain and quantity', async () => {
    const room = await seedRoom();

    const req = mockReqWithPerms(
      {
        cycleName: 'Multi Cycle',
        plantsCount: 0,
        floweringDays: 60,
        flowerStrains: [
          { strain: 'Strain A', quantity: 5 },
          { strain: 'Strain B', quantity: 7 }
        ]
      },
      { id: room._id.toString() }
    );
    const res = mockRes();
    await startCycle(req, res);

    const updated = res.json.mock.calls[0][0];
    expect(updated.flowerStrains).toHaveLength(2);
    expect(updated.flowerStrains[0].strain).toBe('Strain A');
    expect(updated.flowerStrains[0].quantity).toBe(5);
    expect(updated.flowerStrains[1].strain).toBe('Strain B');
    expect(updated.flowerStrains[1].quantity).toBe(7);
  });

  test('auto-computes plantsCount from flowerStrains', async () => {
    const room = await seedRoom();

    const req = mockReqWithPerms(
      {
        flowerStrains: [
          { strain: 'A', quantity: 3 },
          { strain: 'B', quantity: 4 },
          { strain: 'C', quantity: 5 }
        ]
      },
      { id: room._id.toString() }
    );
    const res = mockRes();
    await startCycle(req, res);

    const updated = res.json.mock.calls[0][0];
    expect(updated.plantsCount).toBe(12);
  });

  test('auto-builds legacy strain field from flowerStrains when strain not provided', async () => {
    const room = await seedRoom();

    const req = mockReqWithPerms(
      {
        flowerStrains: [
          { strain: 'OG Kush', quantity: 3 },
          { strain: 'Blue Dream', quantity: 4 }
        ]
      },
      { id: room._id.toString() }
    );
    const res = mockRes();
    await startCycle(req, res);

    const updated = res.json.mock.calls[0][0];
    expect(updated.strain).toBe('OG Kush / Blue Dream');
  });

  test('assigns sequential startNumber/endNumber to each strain', async () => {
    const room = await seedRoom();

    const req = mockReqWithPerms(
      {
        flowerStrains: [
          { strain: 'A', quantity: 3 },
          { strain: 'B', quantity: 5 }
        ]
      },
      { id: room._id.toString() }
    );
    const res = mockRes();
    await startCycle(req, res);

    const updated = res.json.mock.calls[0][0];
    expect(updated.flowerStrains[0].startNumber).toBe(1);
    expect(updated.flowerStrains[0].endNumber).toBe(3);
    expect(updated.flowerStrains[1].startNumber).toBe(4);
    expect(updated.flowerStrains[1].endNumber).toBe(8);
  });

  test('keeps explicit strain if provided alongside flowerStrains', async () => {
    const room = await seedRoom();

    const req = mockReqWithPerms(
      {
        strain: 'Custom Label',
        flowerStrains: [
          { strain: 'A', quantity: 2 },
          { strain: 'B', quantity: 3 }
        ]
      },
      { id: room._id.toString() }
    );
    const res = mockRes();
    await startCycle(req, res);

    const updated = res.json.mock.calls[0][0];
    expect(updated.strain).toBe('Custom Label');
  });

  test('sets empty flowerStrains when not provided', async () => {
    const room = await seedRoom();

    const req = mockReqWithPerms(
      { strain: 'Solo Strain', plantsCount: 10 },
      { id: room._id.toString() }
    );
    const res = mockRes();
    await startCycle(req, res);

    const updated = res.json.mock.calls[0][0];
    expect(updated.flowerStrains).toEqual([]);
  });
});

// ═══════════════════════════════════════════
// addNote
// ═══════════════════════════════════════════

describe('addNote', () => {
  test('adds timestamped note to room notes', async () => {
    const room = await seedRoom();

    const req = mockReqWithPerms(
      { note: 'Plants look healthy' },
      { id: room._id.toString() }
    );
    const res = mockRes();
    await addNote(req, res);

    expect(res.json).toHaveBeenCalled();
    const updated = res.json.mock.calls[0][0];
    expect(updated.notes).toContain('Plants look healthy');
    // Should contain a timestamp in brackets
    expect(updated.notes).toMatch(/\[.*\] Plants look healthy/);
  });

  test('appends note to existing notes', async () => {
    const room = await seedRoom({ notes: 'First note here' });

    const req = mockReqWithPerms(
      { note: 'Second note' },
      { id: room._id.toString() }
    );
    const res = mockRes();
    await addNote(req, res);

    const updated = res.json.mock.calls[0][0];
    expect(updated.notes).toContain('First note here');
    expect(updated.notes).toContain('Second note');
    // Notes separated by newline
    expect(updated.notes).toMatch(/First note here\n\[/);
  });

  test('creates a RoomLog entry for note_added', async () => {
    const room = await seedRoom();

    const req = mockReqWithPerms(
      { note: 'Log this note' },
      { id: room._id.toString() }
    );
    const res = mockRes();
    await addNote(req, res);

    const logs = await RoomLog.find({ room: room._id, type: 'note_added' });
    expect(logs).toHaveLength(1);
    expect(logs[0].description).toBe('Log this note');
  });

  test('returns 404 for non-existent room', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const req = mockReqWithPerms(
      { note: 'Ghost note' },
      { id: fakeId.toString() }
    );
    const res = mockRes();
    await addNote(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ═══════════════════════════════════════════
// Virtual fields
// ═══════════════════════════════════════════

describe('Virtual fields - progress, currentDay, daysRemaining', () => {
  test('progress is 0 when no startDate', async () => {
    const room = await seedRoom();
    expect(room.progress).toBe(0);
  });

  test('currentDay is 0 when no startDate', async () => {
    const room = await seedRoom();
    expect(room.currentDay).toBe(0);
  });

  test('daysRemaining is null when no startDate', async () => {
    const room = await seedRoom();
    expect(room.daysRemaining).toBeNull();
  });

  test('currentDay is 1 on the start day', async () => {
    const now = new Date();
    const room = await seedRoom({
      isActive: true,
      startDate: now,
      floweringDays: 56
    });
    // daysPassed = 0, so currentDay = 0 + 1 = 1
    expect(room.currentDay).toBe(1);
  });

  test('currentDay reflects days since start', async () => {
    const tenDaysAgo = new Date();
    tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);

    const room = await seedRoom({
      isActive: true,
      startDate: tenDaysAgo,
      floweringDays: 56
    });
    // daysPassed = 10, currentDay = 10 + 1 = 11
    expect(room.currentDay).toBe(11);
  });

  test('progress is calculated correctly mid-cycle', async () => {
    const twentyEightDaysAgo = new Date();
    twentyEightDaysAgo.setDate(twentyEightDaysAgo.getDate() - 28);

    const room = await seedRoom({
      isActive: true,
      startDate: twentyEightDaysAgo,
      floweringDays: 56
    });
    // 28 / 56 * 100 = 50%
    expect(room.progress).toBe(50);
  });

  test('progress is capped at 100', async () => {
    const longAgo = new Date();
    longAgo.setDate(longAgo.getDate() - 200);

    const room = await seedRoom({
      isActive: true,
      startDate: longAgo,
      floweringDays: 56
    });
    expect(room.progress).toBe(100);
  });

  test('daysRemaining decreases correctly', async () => {
    const tenDaysAgo = new Date();
    tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);

    const room = await seedRoom({
      isActive: true,
      startDate: tenDaysAgo,
      floweringDays: 56
    });
    // remaining = 56 - 10 = 46
    expect(room.daysRemaining).toBe(46);
  });

  test('daysRemaining does not go below 0', async () => {
    const longAgo = new Date();
    longAgo.setDate(longAgo.getDate() - 100);

    const room = await seedRoom({
      isActive: true,
      startDate: longAgo,
      floweringDays: 56
    });
    expect(room.daysRemaining).toBe(0);
  });

  test('totalWatts virtual calculates lampCount * lampWattage', async () => {
    const room = await seedRoom({
      lighting: { lampCount: 4, lampWattage: 600, lampType: 'HPS' }
    });
    expect(room.totalWatts).toBe(2400);
  });

  test('totalWatts is null when lighting data incomplete', async () => {
    const room = await seedRoom({
      lighting: { lampCount: 4 }
    });
    expect(room.totalWatts).toBeNull();
  });

  test('virtuals are included in toJSON output', async () => {
    const tenDaysAgo = new Date();
    tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);

    const room = await seedRoom({
      isActive: true,
      startDate: tenDaysAgo,
      floweringDays: 56
    });

    const json = room.toJSON();
    expect(json.progress).toBeDefined();
    expect(json.currentDay).toBeDefined();
    expect(json.daysRemaining).toBeDefined();
  });
});
