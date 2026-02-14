import { describe, test, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { connectDB, closeDB, clearDB, mockReq, mockRes } from './testHelper.js';
import mongoose from 'mongoose';
import HarvestSession from '../models/HarvestSession.js';
// Import User model so Mongoose registers the schema (needed for .populate('recordedBy'))
import User from '../models/User.js';
import {
  createSession,
  getSessionByRoom,
  addPlant,
  setPlantErrorNote,
  completeSession
} from '../controllers/harvestController.js';

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

const testUser = { _id: new mongoose.Types.ObjectId(), name: 'Test User' };

async function seedFlowerRoom(overrides = {}) {
  const defaults = {
    roomNumber: 1,
    name: 'Room 1',
    cycleName: 'Cycle A',
    strain: 'OG Kush',
    plantsCount: 10,
    isActive: true,
    startDate: new Date('2025-01-01'),
    floweringDays: 56,
    flowerStrains: [],
    notes: '',
    environment: { lightHours: 12, medium: 'soil', nutrients: '' },
    totalCycles: 0,
    currentCycleId: null,
    roomLayout: { customRows: [], plantPositions: [], fillDirection: 'topDown' }
  };
  const doc = { ...defaults, ...overrides };
  const result = await db.db.collection('flowerrooms').insertOne(doc);
  return { _id: result.insertedId, ...doc };
}

async function seedSession(roomId, overrides = {}) {
  const defaults = {
    room: roomId,
    roomNumber: 1,
    roomName: 'Room 1',
    cycleName: 'Cycle A',
    strain: 'OG Kush',
    plantsCount: 10,
    status: 'in_progress',
    plants: [],
    startedAt: new Date()
  };
  return HarvestSession.create({ ...defaults, ...overrides });
}

// ═══════════════════════════════════════════
// createSession
// ═══════════════════════════════════════════

describe('createSession', () => {
  test('creates session for active room with in_progress status', async () => {
    const room = await seedFlowerRoom();
    const req = mockReq({ roomId: room._id.toString() }, {}, {}, testUser);
    const res = mockRes();

    await createSession(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const body = res.json.mock.calls[0][0];
    expect(body.status).toBe('in_progress');
    expect(body.room.toString()).toBe(room._id.toString());
  });

  test('copies room data (strain, plantsCount, roomName)', async () => {
    const room = await seedFlowerRoom({
      name: 'Flower Room 3',
      strain: 'Blue Dream',
      plantsCount: 25,
      roomNumber: 3,
      cycleName: 'Winter 2025'
    });
    const req = mockReq({ roomId: room._id.toString() }, {}, {}, testUser);
    const res = mockRes();

    await createSession(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const body = res.json.mock.calls[0][0];
    expect(body.strain).toBe('Blue Dream');
    expect(body.plantsCount).toBe(25);
    expect(body.roomName).toBe('Flower Room 3');
    expect(body.roomNumber).toBe(3);
    expect(body.cycleName).toBe('Winter 2025');
  });

  test('rejects inactive room', async () => {
    const room = await seedFlowerRoom({ isActive: false });
    const req = mockReq({ roomId: room._id.toString() }, {}, {}, testUser);
    const res = mockRes();

    await createSession(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res.json.mock.calls[0][0];
    expect(body.message).toBeDefined();
  });

  test('returns existing in_progress session instead of creating duplicate', async () => {
    const room = await seedFlowerRoom();
    const existing = await seedSession(room._id);

    const req = mockReq({ roomId: room._id.toString() }, {}, {}, testUser);
    const res = mockRes();

    await createSession(req, res);

    // Should return 200 (no status call means default 200) not 201
    expect(res.status).not.toHaveBeenCalledWith(201);
    const body = res.json.mock.calls[0][0];
    expect(body._id.toString()).toBe(existing._id.toString());
  });

  test('returns 400 when roomId is missing', async () => {
    const req = mockReq({}, {}, {}, testUser);
    const res = mockRes();

    await createSession(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 404 when room does not exist', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const req = mockReq({ roomId: fakeId.toString() }, {}, {}, testUser);
    const res = mockRes();

    await createSession(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ═══════════════════════════════════════════
// getSessionByRoom
// ═══════════════════════════════════════════

describe('getSessionByRoom', () => {
  test('returns existing in_progress session', async () => {
    const room = await seedFlowerRoom();
    const session = await seedSession(room._id);

    const req = mockReq({}, {}, { roomId: room._id.toString() }, testUser);
    const res = mockRes();

    await getSessionByRoom(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body).not.toBeNull();
    expect(body._id.toString()).toBe(session._id.toString());
    expect(body.status).toBe('in_progress');
  });

  test('returns null (200) when no active session exists', async () => {
    const roomId = new mongoose.Types.ObjectId();
    const req = mockReq({}, {}, { roomId: roomId.toString() }, testUser);
    const res = mockRes();

    await getSessionByRoom(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body).toBeNull();
  });

  test('returns 400 when roomId is missing', async () => {
    const req = mockReq({}, {}, {}, testUser);
    const res = mockRes();

    await getSessionByRoom(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('does not return completed sessions', async () => {
    const room = await seedFlowerRoom();
    await seedSession(room._id, { status: 'completed', completedAt: new Date() });

    const req = mockReq({}, {}, { roomId: room._id.toString() }, testUser);
    const res = mockRes();

    await getSessionByRoom(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body).toBeNull();
  });
});

// ═══════════════════════════════════════════
// addPlant
// ═══════════════════════════════════════════

describe('addPlant', () => {
  test('records plant with weight and strain', async () => {
    const room = await seedFlowerRoom();
    const session = await seedSession(room._id);

    const req = mockReq(
      { plantNumber: 1, wetWeight: 250 },
      { sessionId: session._id.toString() },
      {},
      testUser
    );
    const res = mockRes();

    await addPlant(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const body = res.json.mock.calls[0][0];
    expect(body.added.plantNumber).toBe(1);
    expect(body.added.wetWeight).toBe(250);
  });

  test('rejects duplicate plant number', async () => {
    const room = await seedFlowerRoom();
    const session = await seedSession(room._id, {
      plants: [{ plantNumber: 5, strain: 'OG Kush', wetWeight: 100, recordedBy: testUser._id }]
    });

    const req = mockReq(
      { plantNumber: 5, wetWeight: 200 },
      { sessionId: session._id.toString() },
      {},
      testUser
    );
    const res = mockRes();

    await addPlant(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('auto-assigns strain from flowerStrains ranges', async () => {
    const room = await seedFlowerRoom({
      flowerStrains: [
        { strain: 'Blue Dream', quantity: 5, startNumber: 1, endNumber: 5 },
        { strain: 'OG Kush', quantity: 5, startNumber: 6, endNumber: 10 }
      ]
    });
    const session = await seedSession(room._id);

    // Plant #3 should get Blue Dream (range 1-5)
    const req1 = mockReq(
      { plantNumber: 3, wetWeight: 150 },
      { sessionId: session._id.toString() },
      {},
      testUser
    );
    const res1 = mockRes();
    await addPlant(req1, res1);

    expect(res1.status).toHaveBeenCalledWith(201);
    const body1 = res1.json.mock.calls[0][0];
    expect(body1.added.strain).toBe('Blue Dream');

    // Plant #8 should get OG Kush (range 6-10)
    const req2 = mockReq(
      { plantNumber: 8, wetWeight: 200 },
      { sessionId: session._id.toString() },
      {},
      testUser
    );
    const res2 = mockRes();
    await addPlant(req2, res2);

    expect(res2.status).toHaveBeenCalledWith(201);
    const body2 = res2.json.mock.calls[0][0];
    expect(body2.added.strain).toBe('OG Kush');
  });

  test('rejects when session is completed', async () => {
    const room = await seedFlowerRoom();
    const session = await seedSession(room._id, {
      status: 'completed',
      completedAt: new Date()
    });

    const req = mockReq(
      { plantNumber: 1, wetWeight: 100 },
      { sessionId: session._id.toString() },
      {},
      testUser
    );
    const res = mockRes();

    await addPlant(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('falls back to room strain when no flowerStrains exist', async () => {
    const room = await seedFlowerRoom({ strain: 'White Widow', flowerStrains: [] });
    const session = await seedSession(room._id);

    const req = mockReq(
      { plantNumber: 1, wetWeight: 120 },
      { sessionId: session._id.toString() },
      {},
      testUser
    );
    const res = mockRes();

    await addPlant(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const body = res.json.mock.calls[0][0];
    expect(body.added.strain).toBe('White Widow');
  });

  test('returns 400 when plantNumber or wetWeight is missing', async () => {
    const room = await seedFlowerRoom();
    const session = await seedSession(room._id);

    const req = mockReq(
      { plantNumber: 1 },
      { sessionId: session._id.toString() },
      {},
      testUser
    );
    const res = mockRes();

    await addPlant(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 404 when session does not exist', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const req = mockReq(
      { plantNumber: 1, wetWeight: 100 },
      { sessionId: fakeId.toString() },
      {},
      testUser
    );
    const res = mockRes();

    await addPlant(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ═══════════════════════════════════════════
// setPlantErrorNote
// ═══════════════════════════════════════════

describe('setPlantErrorNote', () => {
  test('updates error note on plant', async () => {
    const room = await seedFlowerRoom();
    const session = await seedSession(room._id, {
      plants: [{ plantNumber: 1, strain: 'OG Kush', wetWeight: 200, recordedBy: testUser._id }]
    });

    const req = mockReq(
      { errorNote: 'Scale was off' },
      { sessionId: session._id.toString(), plantNumber: '1' },
      {},
      testUser
    );
    const res = mockRes();

    await setPlantErrorNote(req, res);

    const body = res.json.mock.calls[0][0];
    const plant = body.plants.find(p => p.plantNumber === 1);
    expect(plant.errorNote).toBe('Scale was off');
  });

  test('returns 404 when session does not exist', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const req = mockReq(
      { errorNote: 'test' },
      { sessionId: fakeId.toString(), plantNumber: '1' },
      {},
      testUser
    );
    const res = mockRes();

    await setPlantErrorNote(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('returns 404 when plant number does not exist in session', async () => {
    const room = await seedFlowerRoom();
    const session = await seedSession(room._id, {
      plants: [{ plantNumber: 1, strain: 'OG Kush', wetWeight: 200, recordedBy: testUser._id }]
    });

    const req = mockReq(
      { errorNote: 'test' },
      { sessionId: session._id.toString(), plantNumber: '99' },
      {},
      testUser
    );
    const res = mockRes();

    await setPlantErrorNote(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('trims whitespace from error note', async () => {
    const room = await seedFlowerRoom();
    const session = await seedSession(room._id, {
      plants: [{ plantNumber: 1, strain: 'OG Kush', wetWeight: 200, recordedBy: testUser._id }]
    });

    const req = mockReq(
      { errorNote: '  extra spaces  ' },
      { sessionId: session._id.toString(), plantNumber: '1' },
      {},
      testUser
    );
    const res = mockRes();

    await setPlantErrorNote(req, res);

    const body = res.json.mock.calls[0][0];
    const plant = body.plants.find(p => p.plantNumber === 1);
    expect(plant.errorNote).toBe('extra spaces');
  });
});

// ═══════════════════════════════════════════
// completeSession
// ═══════════════════════════════════════════

describe('completeSession', () => {
  test('marks session completed and sets completedAt', async () => {
    const room = await seedFlowerRoom();
    const session = await seedSession(room._id, {
      plants: [{ plantNumber: 1, strain: 'OG Kush', wetWeight: 200, recordedBy: testUser._id }]
    });

    const req = mockReq(
      {},
      { sessionId: session._id.toString() },
      {},
      testUser
    );
    const res = mockRes();

    await completeSession(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body.status).toBe('completed');
    expect(body.completedAt).not.toBeNull();

    // Verify persisted in DB
    const updated = await HarvestSession.findById(session._id);
    expect(updated.status).toBe('completed');
    expect(updated.completedAt).toBeInstanceOf(Date);
  });

  test('rejects already completed session', async () => {
    const room = await seedFlowerRoom();
    const session = await seedSession(room._id, {
      status: 'completed',
      completedAt: new Date()
    });

    const req = mockReq(
      {},
      { sessionId: session._id.toString() },
      {},
      testUser
    );
    const res = mockRes();

    await completeSession(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 404 when session does not exist', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const req = mockReq(
      {},
      { sessionId: fakeId.toString() },
      {},
      testUser
    );
    const res = mockRes();

    await completeSession(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('deactivates the room after completion', async () => {
    const room = await seedFlowerRoom();
    const session = await seedSession(room._id, {
      plants: [{ plantNumber: 1, strain: 'OG Kush', wetWeight: 200, recordedBy: testUser._id }]
    });

    const req = mockReq(
      {},
      { sessionId: session._id.toString() },
      {},
      testUser
    );
    const res = mockRes();

    await completeSession(req, res);

    // The room should now be inactive
    const updatedRoom = await db.db.collection('flowerrooms').findOne({ _id: room._id });
    expect(updatedRoom.isActive).toBe(false);
    expect(updatedRoom.totalCycles).toBe(1);
  });

  test('creates a CycleArchive record on completion', async () => {
    const room = await seedFlowerRoom({
      strain: 'Northern Lights',
      plantsCount: 5
    });
    const session = await seedSession(room._id, {
      strain: 'Northern Lights',
      plantsCount: 5,
      plants: [
        { plantNumber: 1, strain: 'Northern Lights', wetWeight: 150, recordedBy: testUser._id },
        { plantNumber: 2, strain: 'Northern Lights', wetWeight: 180, recordedBy: testUser._id }
      ]
    });

    const req = mockReq(
      {},
      { sessionId: session._id.toString() },
      {},
      testUser
    );
    const res = mockRes();

    await completeSession(req, res);

    const archives = await db.db.collection('cyclearchives').find({}).toArray();
    expect(archives).toHaveLength(1);
    expect(archives[0].room.toString()).toBe(room._id.toString());
    expect(archives[0].harvestData.wetWeight).toBe(330);
  });
});
