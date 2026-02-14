import { describe, test, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { connectDB, closeDB, clearDB, mockReq, mockRes } from './testHelper.js';
import mongoose from 'mongoose';
import FlowerRoom from '../models/FlowerRoom.js';
import PlannedCycle from '../models/PlannedCycle.js';
import RoomTemplate from '../models/RoomTemplate.js';
import {
  getPlans,
  createPlan,
  updatePlan,
  deletePlan,
  getDeletedPlans,
  restorePlan
} from '../controllers/plannedController.js';
import {
  getTemplates,
  createTemplate,
  deleteTemplate
} from '../controllers/roomTemplateController.js';

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

async function seedPlan(room, overrides = {}) {
  return PlannedCycle.create({
    room: room._id,
    cycleName: 'Test Cycle',
    strain: 'Test Strain',
    plantsCount: 10,
    floweringDays: 56,
    ...overrides
  });
}

async function seedTemplate(overrides = {}) {
  return RoomTemplate.create({
    name: 'Default Template',
    customRows: [{ name: 'Row 1', cols: 4, rows: 1, fillDirection: 'topDown' }],
    ...overrides
  });
}

// ═══════════════════════════════════════════
// getPlans
// ═══════════════════════════════════════════

describe('getPlans', () => {
  test('returns all non-deleted plans', async () => {
    const room1 = await seedRoom({ roomNumber: 1, name: 'Комната 1' });
    const room2 = await seedRoom({ roomNumber: 2, name: 'Комната 2' });
    await seedPlan(room1, { cycleName: 'Cycle A' });
    await seedPlan(room2, { cycleName: 'Cycle B' });
    // Soft-deleted plan should NOT appear
    await seedPlan(room1, { cycleName: 'Deleted Cycle', deletedAt: new Date() });

    const req = mockReq();
    const res = mockRes();
    await getPlans(req, res);

    expect(res.json).toHaveBeenCalled();
    const plans = res.json.mock.calls[0][0];
    expect(plans).toHaveLength(2);
    const names = plans.map(p => p.cycleName);
    expect(names).toContain('Cycle A');
    expect(names).toContain('Cycle B');
    expect(names).not.toContain('Deleted Cycle');
  });

  test('filters plans by roomId query param', async () => {
    const room1 = await seedRoom({ roomNumber: 1, name: 'Комната 1' });
    const room2 = await seedRoom({ roomNumber: 2, name: 'Комната 2' });
    await seedPlan(room1, { cycleName: 'Room1 Plan' });
    await seedPlan(room2, { cycleName: 'Room2 Plan' });

    const req = mockReq({}, {}, { roomId: room1._id.toString() });
    const res = mockRes();
    await getPlans(req, res);

    const plans = res.json.mock.calls[0][0];
    expect(plans).toHaveLength(1);
    expect(plans[0].cycleName).toBe('Room1 Plan');
  });

  test('returns empty array when no plans exist', async () => {
    const req = mockReq();
    const res = mockRes();
    await getPlans(req, res);

    const plans = res.json.mock.calls[0][0];
    expect(plans).toHaveLength(0);
  });

  test('populates room name and roomNumber', async () => {
    const room = await seedRoom({ roomNumber: 3, name: 'Комната 3' });
    await seedPlan(room);

    const req = mockReq();
    const res = mockRes();
    await getPlans(req, res);

    const plans = res.json.mock.calls[0][0];
    expect(plans).toHaveLength(1);
    expect(plans[0].room).toBeDefined();
    expect(plans[0].room.name).toBe('Комната 3');
    expect(plans[0].room.roomNumber).toBe(3);
  });
});

// ═══════════════════════════════════════════
// createPlan
// ═══════════════════════════════════════════

describe('createPlan', () => {
  test('creates a new plan for a room', async () => {
    const room = await seedRoom();

    const req = mockReq({
      roomId: room._id.toString(),
      cycleName: 'New Cycle',
      strain: 'OG Kush',
      plantsCount: 12,
      floweringDays: 63,
      notes: 'Test notes'
    });
    const res = mockRes();
    await createPlan(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalled();
    const plan = res.json.mock.calls[0][0];
    expect(plan.cycleName).toBe('New Cycle');
    expect(plan.strain).toBe('OG Kush');
    expect(plan.plantsCount).toBe(12);
    expect(plan.floweringDays).toBe(63);
    expect(plan.notes).toBe('Test notes');
    expect(plan.room.toString()).toBe(room._id.toString());
  });

  test('creates plan with plannedStartDate', async () => {
    const room = await seedRoom();
    const startDate = '2025-06-01T00:00:00.000Z';

    const req = mockReq({
      roomId: room._id.toString(),
      cycleName: 'Dated Cycle',
      plannedStartDate: startDate
    });
    const res = mockRes();
    await createPlan(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const plan = res.json.mock.calls[0][0];
    expect(new Date(plan.plannedStartDate).toISOString()).toBe(startDate);
  });

  test('returns 400 when roomId is missing', async () => {
    const req = mockReq({ cycleName: 'No Room' });
    const res = mockRes();
    await createPlan(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.any(String) })
    );
  });

  test('returns 400 when roomId is invalid ObjectId', async () => {
    const req = mockReq({ roomId: 'not-a-valid-id', cycleName: 'Bad ID' });
    const res = mockRes();
    await createPlan(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 404 when room does not exist', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const req = mockReq({ roomId: fakeId.toString(), cycleName: 'Ghost Room' });
    const res = mockRes();
    await createPlan(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('upserts: second create for same room updates existing plan', async () => {
    const room = await seedRoom();

    // First create
    const req1 = mockReq({
      roomId: room._id.toString(),
      cycleName: 'First Cycle',
      strain: 'Strain A',
      plantsCount: 5
    });
    const res1 = mockRes();
    await createPlan(req1, res1);

    expect(res1.status).toHaveBeenCalledWith(201);
    const plan1 = res1.json.mock.calls[0][0];

    // Second create for same room — should upsert, not create a new doc
    const req2 = mockReq({
      roomId: room._id.toString(),
      cycleName: 'Updated Cycle',
      strain: 'Strain B',
      plantsCount: 15
    });
    const res2 = mockRes();
    await createPlan(req2, res2);

    expect(res2.status).toHaveBeenCalledWith(201);
    const plan2 = res2.json.mock.calls[0][0];

    // Should be the same document ID (upsert, not new)
    expect(plan2._id.toString()).toBe(plan1._id.toString());
    expect(plan2.cycleName).toBe('Updated Cycle');
    expect(plan2.strain).toBe('Strain B');
    expect(plan2.plantsCount).toBe(15);

    // Verify only one plan exists in DB for this room
    const allPlans = await PlannedCycle.find({ room: room._id, deletedAt: null });
    expect(allPlans).toHaveLength(1);
  });

  test('defaults floweringDays to 56 when not provided', async () => {
    const room = await seedRoom();

    const req = mockReq({
      roomId: room._id.toString(),
      cycleName: 'Default Days'
    });
    const res = mockRes();
    await createPlan(req, res);

    const plan = res.json.mock.calls[0][0];
    expect(plan.floweringDays).toBe(56);
  });

  test('defaults plantsCount to 0 when not provided', async () => {
    const room = await seedRoom();

    const req = mockReq({
      roomId: room._id.toString(),
      cycleName: 'No Plants'
    });
    const res = mockRes();
    await createPlan(req, res);

    const plan = res.json.mock.calls[0][0];
    expect(plan.plantsCount).toBe(0);
  });

  test('trims cycleName and strain whitespace', async () => {
    const room = await seedRoom();

    const req = mockReq({
      roomId: room._id.toString(),
      cycleName: '  Spaced Name  ',
      strain: '  Spaced Strain  '
    });
    const res = mockRes();
    await createPlan(req, res);

    const plan = res.json.mock.calls[0][0];
    expect(plan.cycleName).toBe('Spaced Name');
    expect(plan.strain).toBe('Spaced Strain');
  });
});

// ═══════════════════════════════════════════
// updatePlan
// ═══════════════════════════════════════════

describe('updatePlan', () => {
  test('updates plan fields', async () => {
    const room = await seedRoom();
    const plan = await seedPlan(room);

    const req = mockReq(
      {
        cycleName: 'Updated Name',
        strain: 'New Strain',
        plantsCount: 20,
        floweringDays: 70,
        notes: 'Updated notes'
      },
      { id: plan._id.toString() }
    );
    const res = mockRes();
    await updatePlan(req, res);

    expect(res.json).toHaveBeenCalled();
    const updated = res.json.mock.calls[0][0];
    expect(updated.cycleName).toBe('Updated Name');
    expect(updated.strain).toBe('New Strain');
    expect(updated.plantsCount).toBe(20);
    expect(updated.floweringDays).toBe(70);
    expect(updated.notes).toBe('Updated notes');
  });

  test('only updates provided fields, leaves others unchanged', async () => {
    const room = await seedRoom();
    const plan = await seedPlan(room, {
      cycleName: 'Keep This',
      strain: 'Keep Strain',
      plantsCount: 10,
      notes: 'Original notes'
    });

    const req = mockReq(
      { notes: 'Changed notes' },
      { id: plan._id.toString() }
    );
    const res = mockRes();
    await updatePlan(req, res);

    const updated = res.json.mock.calls[0][0];
    expect(updated.cycleName).toBe('Keep This');
    expect(updated.strain).toBe('Keep Strain');
    expect(updated.plantsCount).toBe(10);
    expect(updated.notes).toBe('Changed notes');
  });

  test('updates plannedStartDate', async () => {
    const room = await seedRoom();
    const plan = await seedPlan(room);
    const newDate = '2025-09-15T00:00:00.000Z';

    const req = mockReq(
      { plannedStartDate: newDate },
      { id: plan._id.toString() }
    );
    const res = mockRes();
    await updatePlan(req, res);

    const updated = res.json.mock.calls[0][0];
    expect(new Date(updated.plannedStartDate).toISOString()).toBe(newDate);
  });

  test('clears plannedStartDate when set to null', async () => {
    const room = await seedRoom();
    const plan = await seedPlan(room, { plannedStartDate: new Date('2025-06-01') });

    const req = mockReq(
      { plannedStartDate: null },
      { id: plan._id.toString() }
    );
    const res = mockRes();
    await updatePlan(req, res);

    const updated = res.json.mock.calls[0][0];
    expect(updated.plannedStartDate).toBeNull();
  });

  test('returns 404 for non-existent plan', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const req = mockReq(
      { cycleName: 'Nope' },
      { id: fakeId.toString() }
    );
    const res = mockRes();
    await updatePlan(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('returns 404 for soft-deleted plan', async () => {
    const room = await seedRoom();
    const plan = await seedPlan(room, { deletedAt: new Date() });

    const req = mockReq(
      { cycleName: 'Cannot Update' },
      { id: plan._id.toString() }
    );
    const res = mockRes();
    await updatePlan(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ═══════════════════════════════════════════
// deletePlan (soft delete)
// ═══════════════════════════════════════════

describe('deletePlan', () => {
  test('soft-deletes plan by setting deletedAt', async () => {
    const room = await seedRoom();
    const plan = await seedPlan(room, { cycleName: 'To Delete' });

    const req = mockReq({}, { id: plan._id.toString() });
    const res = mockRes();
    await deletePlan(req, res);

    expect(res.json).toHaveBeenCalled();
    const result = res.json.mock.calls[0][0];
    expect(result.message).toBeTruthy();

    // Verify in DB: deletedAt should be set
    const dbPlan = await PlannedCycle.findById(plan._id);
    expect(dbPlan.deletedAt).not.toBeNull();
    expect(dbPlan.deletedAt).toBeInstanceOf(Date);
  });

  test('soft-deleted plan no longer appears in getPlans', async () => {
    const room = await seedRoom();
    const plan = await seedPlan(room, { cycleName: 'Will Vanish' });

    // Delete it
    const delReq = mockReq({}, { id: plan._id.toString() });
    const delRes = mockRes();
    await deletePlan(delReq, delRes);

    // Fetch all plans
    const getReq = mockReq();
    const getRes = mockRes();
    await getPlans(getReq, getRes);

    const plans = getRes.json.mock.calls[0][0];
    expect(plans).toHaveLength(0);
  });

  test('returns 404 for already-deleted plan', async () => {
    const room = await seedRoom();
    const plan = await seedPlan(room, { deletedAt: new Date() });

    const req = mockReq({}, { id: plan._id.toString() });
    const res = mockRes();
    await deletePlan(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('returns 404 for non-existent plan', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const req = mockReq({}, { id: fakeId.toString() });
    const res = mockRes();
    await deletePlan(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ═══════════════════════════════════════════
// getDeletedPlans
// ═══════════════════════════════════════════

describe('getDeletedPlans', () => {
  test('returns only soft-deleted plans', async () => {
    const room = await seedRoom();
    await seedPlan(room, { cycleName: 'Active Plan' });
    await seedPlan(room, { cycleName: 'Deleted Plan', deletedAt: new Date() });

    const req = mockReq();
    const res = mockRes();
    await getDeletedPlans(req, res);

    const plans = res.json.mock.calls[0][0];
    expect(plans).toHaveLength(1);
    expect(plans[0].cycleName).toBe('Deleted Plan');
  });

  test('returns empty array when no deleted plans exist', async () => {
    const room = await seedRoom();
    await seedPlan(room, { cycleName: 'Active Only' });

    const req = mockReq();
    const res = mockRes();
    await getDeletedPlans(req, res);

    const plans = res.json.mock.calls[0][0];
    expect(plans).toHaveLength(0);
  });

  test('populates room on deleted plans', async () => {
    const room = await seedRoom({ roomNumber: 2, name: 'Комната 2' });
    await seedPlan(room, { cycleName: 'Deleted', deletedAt: new Date() });

    const req = mockReq();
    const res = mockRes();
    await getDeletedPlans(req, res);

    const plans = res.json.mock.calls[0][0];
    expect(plans).toHaveLength(1);
    expect(plans[0].room.name).toBe('Комната 2');
    expect(plans[0].room.roomNumber).toBe(2);
  });
});

// ═══════════════════════════════════════════
// restorePlan
// ═══════════════════════════════════════════

describe('restorePlan', () => {
  test('restores a soft-deleted plan by clearing deletedAt', async () => {
    const room = await seedRoom();
    const plan = await seedPlan(room, { cycleName: 'Restore Me', deletedAt: new Date() });

    const req = mockReq({}, { id: plan._id.toString() });
    const res = mockRes();
    await restorePlan(req, res);

    expect(res.json).toHaveBeenCalled();
    const result = res.json.mock.calls[0][0];
    expect(result.cycleName).toBe('Restore Me');
    expect(result.deletedAt).toBeNull();

    // Verify in DB
    const dbPlan = await PlannedCycle.findById(plan._id);
    expect(dbPlan.deletedAt).toBeNull();
  });

  test('restored plan appears in getPlans again', async () => {
    const room = await seedRoom();
    const plan = await seedPlan(room, { cycleName: 'Revived', deletedAt: new Date() });

    // Restore
    const restoreReq = mockReq({}, { id: plan._id.toString() });
    const restoreRes = mockRes();
    await restorePlan(restoreReq, restoreRes);

    // Fetch all plans
    const getReq = mockReq();
    const getRes = mockRes();
    await getPlans(getReq, getRes);

    const plans = getRes.json.mock.calls[0][0];
    expect(plans).toHaveLength(1);
    expect(plans[0].cycleName).toBe('Revived');
  });

  test('returns 404 for a plan that is not deleted', async () => {
    const room = await seedRoom();
    const plan = await seedPlan(room, { deletedAt: null });

    const req = mockReq({}, { id: plan._id.toString() });
    const res = mockRes();
    await restorePlan(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('returns 404 for non-existent plan', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const req = mockReq({}, { id: fakeId.toString() });
    const res = mockRes();
    await restorePlan(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ═══════════════════════════════════════════
// ═══════════════════════════════════════════
//  RoomTemplate Controller Tests
// ═══════════════════════════════════════════
// ═══════════════════════════════════════════

// ═══════════════════════════════════════════
// getTemplates
// ═══════════════════════════════════════════

describe('getTemplates', () => {
  test('returns all non-deleted templates sorted by name', async () => {
    await seedTemplate({ name: 'Zebra Template' });
    await seedTemplate({ name: 'Alpha Template' });
    // Soft-deleted should NOT appear
    await seedTemplate({ name: 'Deleted Template', deletedAt: new Date() });

    const req = mockReq();
    const res = mockRes();
    await getTemplates(req, res);

    expect(res.json).toHaveBeenCalled();
    const templates = res.json.mock.calls[0][0];
    expect(templates).toHaveLength(2);
    // Sorted by name ascending
    expect(templates[0].name).toBe('Alpha Template');
    expect(templates[1].name).toBe('Zebra Template');
  });

  test('returns empty array when no templates exist', async () => {
    const req = mockReq();
    const res = mockRes();
    await getTemplates(req, res);

    const templates = res.json.mock.calls[0][0];
    expect(templates).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════
// createTemplate
// ═══════════════════════════════════════════

describe('createTemplate', () => {
  test('creates a template with name and customRows', async () => {
    const req = mockReq({
      name: 'My Template',
      customRows: [
        { name: 'Row A', cols: 6, rows: 2, fillDirection: 'topDown' },
        { name: 'Row B', cols: 3, rows: 1, fillDirection: 'bottomUp' }
      ]
    });
    const res = mockRes();
    await createTemplate(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalled();
    const template = res.json.mock.calls[0][0];
    expect(template.name).toBe('My Template');
    expect(template.customRows).toHaveLength(2);
    expect(template.customRows[0].name).toBe('Row A');
    expect(template.customRows[0].cols).toBe(6);
    expect(template.customRows[0].rows).toBe(2);
    expect(template.customRows[0].fillDirection).toBe('topDown');
    expect(template.customRows[1].name).toBe('Row B');
    expect(template.customRows[1].fillDirection).toBe('bottomUp');
  });

  test('trims template name whitespace', async () => {
    const req = mockReq({
      name: '  Trimmed Name  ',
      customRows: [{ name: 'Row', cols: 4, rows: 1 }]
    });
    const res = mockRes();
    await createTemplate(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const template = res.json.mock.calls[0][0];
    expect(template.name).toBe('Trimmed Name');
  });

  test('returns 400 when name is missing', async () => {
    const req = mockReq({
      customRows: [{ name: 'Row', cols: 4, rows: 1 }]
    });
    const res = mockRes();
    await createTemplate(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.any(String) })
    );
  });

  test('returns 400 when name is empty string', async () => {
    const req = mockReq({
      name: '   ',
      customRows: [{ name: 'Row', cols: 4, rows: 1 }]
    });
    const res = mockRes();
    await createTemplate(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 400 when customRows is missing', async () => {
    const req = mockReq({ name: 'No Rows' });
    const res = mockRes();
    await createTemplate(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 400 when customRows is empty array', async () => {
    const req = mockReq({ name: 'Empty Rows', customRows: [] });
    const res = mockRes();
    await createTemplate(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 400 when customRows is not an array', async () => {
    const req = mockReq({ name: 'Bad Rows', customRows: 'not-array' });
    const res = mockRes();
    await createTemplate(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  // Row sanitization tests

  test('clamps cols to max 30', async () => {
    const req = mockReq({
      name: 'Max Cols',
      customRows: [{ name: 'Wide Row', cols: 999, rows: 1 }]
    });
    const res = mockRes();
    await createTemplate(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const template = res.json.mock.calls[0][0];
    expect(template.customRows[0].cols).toBe(30);
  });

  test('clamps cols to min 1', async () => {
    const req = mockReq({
      name: 'Min Cols',
      customRows: [{ name: 'Narrow Row', cols: -5, rows: 1 }]
    });
    const res = mockRes();
    await createTemplate(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const template = res.json.mock.calls[0][0];
    expect(template.customRows[0].cols).toBe(1);
  });

  test('cols=0 falls back to default 4 (parseInt(0)||4 = 4)', async () => {
    const req = mockReq({
      name: 'Zero Cols',
      customRows: [{ name: 'Row', cols: 0, rows: 1 }]
    });
    const res = mockRes();
    await createTemplate(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const template = res.json.mock.calls[0][0];
    // parseInt(0) = 0 which is falsy, so || 4 gives default 4
    expect(template.customRows[0].cols).toBe(4);
  });

  test('clamps rows to max 100', async () => {
    const req = mockReq({
      name: 'Max Rows',
      customRows: [{ name: 'Tall Row', cols: 4, rows: 500 }]
    });
    const res = mockRes();
    await createTemplate(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const template = res.json.mock.calls[0][0];
    expect(template.customRows[0].rows).toBe(100);
  });

  test('clamps rows to min 1', async () => {
    const req = mockReq({
      name: 'Min Rows',
      customRows: [{ name: 'Flat Row', cols: 4, rows: -10 }]
    });
    const res = mockRes();
    await createTemplate(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const template = res.json.mock.calls[0][0];
    expect(template.customRows[0].rows).toBe(1);
  });

  test('defaults fillDirection to topDown when not bottomUp', async () => {
    const req = mockReq({
      name: 'Default Fill',
      customRows: [
        { name: 'Row 1', cols: 4, rows: 1 },
        { name: 'Row 2', cols: 4, rows: 1, fillDirection: 'invalidValue' }
      ]
    });
    const res = mockRes();
    await createTemplate(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const template = res.json.mock.calls[0][0];
    expect(template.customRows[0].fillDirection).toBe('topDown');
    expect(template.customRows[1].fillDirection).toBe('topDown');
  });

  test('preserves bottomUp fillDirection', async () => {
    const req = mockReq({
      name: 'BottomUp Template',
      customRows: [{ name: 'Row', cols: 4, rows: 1, fillDirection: 'bottomUp' }]
    });
    const res = mockRes();
    await createTemplate(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const template = res.json.mock.calls[0][0];
    expect(template.customRows[0].fillDirection).toBe('bottomUp');
  });

  test('defaults cols to 4 and rows to 1 when not provided', async () => {
    const req = mockReq({
      name: 'Defaults Template',
      customRows: [{ name: 'Bare Row' }]
    });
    const res = mockRes();
    await createTemplate(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const template = res.json.mock.calls[0][0];
    expect(template.customRows[0].cols).toBe(4);
    expect(template.customRows[0].rows).toBe(1);
  });

  test('sanitizes multiple rows independently', async () => {
    const req = mockReq({
      name: 'Multi Row',
      customRows: [
        { name: 'A', cols: 50, rows: 200, fillDirection: 'bottomUp' },
        { name: 'B', cols: -1, rows: 0, fillDirection: 'topDown' },
        { name: 'C', cols: 15, rows: 50 }
      ]
    });
    const res = mockRes();
    await createTemplate(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const template = res.json.mock.calls[0][0];
    expect(template.customRows).toHaveLength(3);

    expect(template.customRows[0].cols).toBe(30);
    expect(template.customRows[0].rows).toBe(100);
    expect(template.customRows[0].fillDirection).toBe('bottomUp');

    expect(template.customRows[1].cols).toBe(1);
    expect(template.customRows[1].rows).toBe(1);
    expect(template.customRows[1].fillDirection).toBe('topDown');

    expect(template.customRows[2].cols).toBe(15);
    expect(template.customRows[2].rows).toBe(50);
    expect(template.customRows[2].fillDirection).toBe('topDown');
  });
});

// ═══════════════════════════════════════════
// deleteTemplate (soft delete)
// ═══════════════════════════════════════════

describe('deleteTemplate', () => {
  test('soft-deletes template by setting deletedAt', async () => {
    const template = await seedTemplate({ name: 'To Delete' });

    const req = mockReq({}, { id: template._id.toString() });
    const res = mockRes();
    await deleteTemplate(req, res);

    expect(res.json).toHaveBeenCalled();
    const result = res.json.mock.calls[0][0];
    expect(result.message).toBeTruthy();

    // Verify in DB: deletedAt should be set
    const dbTemplate = await RoomTemplate.findById(template._id);
    expect(dbTemplate.deletedAt).not.toBeNull();
    expect(dbTemplate.deletedAt).toBeInstanceOf(Date);
  });

  test('soft-deleted template no longer appears in getTemplates', async () => {
    const template = await seedTemplate({ name: 'Will Vanish' });

    // Delete it
    const delReq = mockReq({}, { id: template._id.toString() });
    const delRes = mockRes();
    await deleteTemplate(delReq, delRes);

    // Fetch all templates
    const getReq = mockReq();
    const getRes = mockRes();
    await getTemplates(getReq, getRes);

    const templates = getRes.json.mock.calls[0][0];
    expect(templates).toHaveLength(0);
  });

  test('returns 404 for already-deleted template', async () => {
    const template = await seedTemplate({ name: 'Already Deleted', deletedAt: new Date() });

    const req = mockReq({}, { id: template._id.toString() });
    const res = mockRes();
    await deleteTemplate(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('returns 404 for non-existent template', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const req = mockReq({}, { id: fakeId.toString() });
    const res = mockRes();
    await deleteTemplate(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});
