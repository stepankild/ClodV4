import { describe, test, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { connectDB, closeDB, clearDB, mockReq, mockRes } from './testHelper.js';
import mongoose from 'mongoose';
import RoomTask, { TASK_TYPES, TASK_LABELS } from '../models/RoomTask.js';
import FlowerRoom from '../models/FlowerRoom.js';
// Import User model so Mongoose registers the schema (needed for .populate('completedBy'))
import User from '../models/User.js';
import {
  getTaskTypes,
  createTask,
  getRoomTasks,
  toggleTask,
  updateTask,
  deleteTask,
  restoreTask,
  quickAddTask
} from '../controllers/taskController.js';

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
    name: 'Test Room',
    isActive: true,
    startDate: new Date(),
    floweringDays: 56,
    currentCycleId: new mongoose.Types.ObjectId(),
    ...overrides
  });
}

async function seedTask(room, overrides = {}) {
  return RoomTask.create({
    room: room._id,
    cycleId: room.currentCycleId,
    type: 'spray',
    title: 'Test Task',
    ...overrides
  });
}

async function seedUser(overrides = {}) {
  return User.create({
    email: 'test@test.com',
    password: 'password123',
    name: 'Tester',
    isApproved: true,
    ...overrides
  });
}

// ═══════════════════════════════════════════
// getTaskTypes
// ═══════════════════════════════════════════

describe('getTaskTypes', () => {
  test('returns list of all task types with value and label', async () => {
    const req = mockReq();
    const res = mockRes();

    await getTaskTypes(req, res);

    expect(res.json).toHaveBeenCalled();
    const types = res.json.mock.calls[0][0];

    expect(Array.isArray(types)).toBe(true);
    expect(types.length).toBe(Object.keys(TASK_LABELS).length);

    // Each entry should have value and label
    for (const entry of types) {
      expect(entry).toHaveProperty('value');
      expect(entry).toHaveProperty('label');
      expect(TASK_LABELS[entry.value]).toBe(entry.label);
    }
  });
});

// ═══════════════════════════════════════════
// createTask
// ═══════════════════════════════════════════

describe('createTask', () => {
  test('creates task with room, type, and title', async () => {
    const room = await seedRoom();

    const req = mockReq({
      roomId: room._id.toString(),
      type: 'spray',
      title: 'Spray neem oil'
    });
    const res = mockRes();

    await createTask(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalled();

    const task = res.json.mock.calls[0][0];
    expect(task.room.toString()).toBe(room._id.toString());
    expect(task.type).toBe('spray');
    expect(task.title).toBe('Spray neem oil');
    expect(task.cycleId.toString()).toBe(room.currentCycleId.toString());

    // Verify in DB
    const dbTask = await RoomTask.findById(task._id);
    expect(dbTask).not.toBeNull();
    expect(dbTask.title).toBe('Spray neem oil');
  });

  test('uses TASK_LABELS default title when title is not provided', async () => {
    const room = await seedRoom();

    const req = mockReq({
      roomId: room._id.toString(),
      type: 'feed'
    });
    const res = mockRes();

    await createTask(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const task = res.json.mock.calls[0][0];
    expect(task.title).toBe(TASK_LABELS['feed']);
  });

  test('returns 404 if room does not exist', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const req = mockReq({
      roomId: fakeId.toString(),
      type: 'spray',
      title: 'Test'
    });
    const res = mockRes();

    await createTask(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('rejects invalid task type with validation error', async () => {
    const room = await seedRoom();

    const req = mockReq({
      roomId: room._id.toString(),
      type: 'invalid_type',
      title: 'Bad task'
    });
    const res = mockRes();

    await createTask(req, res);

    // Mongoose validation error should cause 500
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ═══════════════════════════════════════════
// getRoomTasks
// ═══════════════════════════════════════════

describe('getRoomTasks', () => {
  test('returns tasks for a specific room (non-deleted only)', async () => {
    const room = await seedRoom();
    const otherRoom = await seedRoom({ roomNumber: 2, name: 'Other Room' });

    // Create tasks for the target room
    await seedTask(room, { title: 'Task A', type: 'spray' });
    await seedTask(room, { title: 'Task B', type: 'feed' });
    // Create a soft-deleted task (should NOT appear)
    await seedTask(room, { title: 'Deleted Task', type: 'water', deletedAt: new Date() });
    // Create a task for a different room (should NOT appear)
    await seedTask(otherRoom, { title: 'Other Room Task', type: 'trim' });

    const req = mockReq({}, { roomId: room._id.toString() }, {});
    const res = mockRes();

    await getRoomTasks(req, res);

    expect(res.json).toHaveBeenCalled();
    const tasks = res.json.mock.calls[0][0];
    expect(tasks).toHaveLength(2);

    const titles = tasks.map(t => t.title);
    expect(titles).toContain('Task A');
    expect(titles).toContain('Task B');
    expect(titles).not.toContain('Deleted Task');
    expect(titles).not.toContain('Other Room Task');
  });

  test('filters by completed status when query param provided', async () => {
    const room = await seedRoom();

    await seedTask(room, { title: 'Done', type: 'spray', completed: true });
    await seedTask(room, { title: 'Pending', type: 'feed', completed: false });

    const req = mockReq({}, { roomId: room._id.toString() }, { completed: 'false' });
    const res = mockRes();

    await getRoomTasks(req, res);

    const tasks = res.json.mock.calls[0][0];
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe('Pending');
  });
});

// ═══════════════════════════════════════════
// toggleTask
// ═══════════════════════════════════════════

describe('toggleTask', () => {
  test('toggles incomplete task to completed, sets completedAt and completedBy', async () => {
    const room = await seedRoom();
    const task = await seedTask(room, { completed: false });
    const user = await seedUser();

    const req = mockReq({}, { id: task._id.toString() }, {}, { _id: user._id, name: user.name });
    const res = mockRes();

    await toggleTask(req, res);

    expect(res.json).toHaveBeenCalled();
    const result = res.json.mock.calls[0][0];
    expect(result.completed).toBe(true);
    expect(result.completedAt).not.toBeNull();
    expect(result.completedBy._id.toString()).toBe(user._id.toString());
  });

  test('toggles completed task back to incomplete, clears completedAt and completedBy', async () => {
    const room = await seedRoom();
    const user = await seedUser({ email: 'toggle@test.com' });
    const task = await seedTask(room, {
      completed: true,
      completedAt: new Date(),
      completedBy: user._id
    });

    const req = mockReq({}, { id: task._id.toString() }, {}, { _id: user._id, name: user.name });
    const res = mockRes();

    await toggleTask(req, res);

    expect(res.json).toHaveBeenCalled();
    const result = res.json.mock.calls[0][0];
    expect(result.completed).toBe(false);
    expect(result.completedAt).toBeNull();
    expect(result.completedBy).toBeNull();
  });

  test('returns 404 for non-existent task', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const req = mockReq({}, { id: fakeId.toString() });
    const res = mockRes();

    await toggleTask(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('returns 404 for soft-deleted task', async () => {
    const room = await seedRoom();
    const task = await seedTask(room, { deletedAt: new Date() });

    const req = mockReq({}, { id: task._id.toString() });
    const res = mockRes();

    await toggleTask(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ═══════════════════════════════════════════
// updateTask
// ═══════════════════════════════════════════

describe('updateTask', () => {
  test('updates task fields', async () => {
    const room = await seedRoom();
    const task = await seedTask(room, {
      title: 'Original Title',
      description: '',
      priority: 'medium'
    });

    const req = mockReq(
      {
        title: 'Updated Title',
        description: 'New description',
        priority: 'high'
      },
      { id: task._id.toString() }
    );
    const res = mockRes();

    await updateTask(req, res);

    expect(res.json).toHaveBeenCalled();
    const result = res.json.mock.calls[0][0];
    expect(result.title).toBe('Updated Title');
    expect(result.description).toBe('New description');
    expect(result.priority).toBe('high');

    // Verify in DB
    const dbTask = await RoomTask.findById(task._id);
    expect(dbTask.title).toBe('Updated Title');
  });

  test('only updates provided fields, leaves others unchanged', async () => {
    const room = await seedRoom();
    const task = await seedTask(room, {
      title: 'Keep This',
      description: 'Original desc',
      priority: 'low'
    });

    const req = mockReq(
      { description: 'Changed desc' },
      { id: task._id.toString() }
    );
    const res = mockRes();

    await updateTask(req, res);

    const result = res.json.mock.calls[0][0];
    expect(result.title).toBe('Keep This');
    expect(result.description).toBe('Changed desc');
    expect(result.priority).toBe('low');
  });

  test('returns 404 for non-existent task', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const req = mockReq({ title: 'Nope' }, { id: fakeId.toString() });
    const res = mockRes();

    await updateTask(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ═══════════════════════════════════════════
// deleteTask (soft delete)
// ═══════════════════════════════════════════

describe('deleteTask', () => {
  test('soft-deletes task by setting deletedAt', async () => {
    const room = await seedRoom();
    const task = await seedTask(room, { title: 'To Delete' });

    const req = mockReq({}, { id: task._id.toString() });
    const res = mockRes();

    await deleteTask(req, res);

    expect(res.json).toHaveBeenCalled();
    const result = res.json.mock.calls[0][0];
    expect(result.message).toBeTruthy();

    // Verify in DB: deletedAt should be set
    const dbTask = await RoomTask.findById(task._id);
    expect(dbTask.deletedAt).not.toBeNull();
    expect(dbTask.deletedAt).toBeInstanceOf(Date);
  });

  test('returns 404 for already-deleted task', async () => {
    const room = await seedRoom();
    const task = await seedTask(room, { deletedAt: new Date() });

    const req = mockReq({}, { id: task._id.toString() });
    const res = mockRes();

    await deleteTask(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('returns 404 for non-existent task', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const req = mockReq({}, { id: fakeId.toString() });
    const res = mockRes();

    await deleteTask(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ═══════════════════════════════════════════
// restoreTask
// ═══════════════════════════════════════════

describe('restoreTask', () => {
  test('restores a soft-deleted task by clearing deletedAt', async () => {
    const room = await seedRoom();
    const task = await seedTask(room, { title: 'Restore Me', deletedAt: new Date() });

    const req = mockReq({}, { id: task._id.toString() });
    const res = mockRes();

    await restoreTask(req, res);

    expect(res.json).toHaveBeenCalled();
    const result = res.json.mock.calls[0][0];
    expect(result.title).toBe('Restore Me');
    expect(result.deletedAt).toBeNull();

    // Verify in DB
    const dbTask = await RoomTask.findById(task._id);
    expect(dbTask.deletedAt).toBeNull();
  });

  test('returns 404 for a task that is not deleted', async () => {
    const room = await seedRoom();
    const task = await seedTask(room, { deletedAt: null });

    const req = mockReq({}, { id: task._id.toString() });
    const res = mockRes();

    await restoreTask(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('returns 404 for non-existent task', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const req = mockReq({}, { id: fakeId.toString() });
    const res = mockRes();

    await restoreTask(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ═══════════════════════════════════════════
// quickAddTask
// ═══════════════════════════════════════════

describe('quickAddTask', () => {
  test('creates a completed spray task with product', async () => {
    const room = await seedRoom();
    const userId = new mongoose.Types.ObjectId();

    const req = mockReq(
      { roomId: room._id.toString(), type: 'spray', product: 'Neem Oil' },
      {},
      {},
      { _id: userId, name: 'Tester' }
    );
    const res = mockRes();

    await quickAddTask(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const task = res.json.mock.calls[0][0];
    expect(task.completed).toBe(true);
    expect(task.completedAt).not.toBeNull();
    expect(task.type).toBe('spray');
    expect(task.sprayProduct).toBe('Neem Oil');
    expect(task.title).toContain('Neem Oil');
  });

  test('creates a completed feed task with product and dosage', async () => {
    const room = await seedRoom();
    const userId = new mongoose.Types.ObjectId();

    const req = mockReq(
      { roomId: room._id.toString(), type: 'feed', product: 'CalMag', dosage: '5ml/L' },
      {},
      {},
      { _id: userId, name: 'Tester' }
    );
    const res = mockRes();

    await quickAddTask(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const task = res.json.mock.calls[0][0];
    expect(task.completed).toBe(true);
    expect(task.type).toBe('feed');
    expect(task.feedProduct).toBe('CalMag');
    expect(task.feedDosage).toBe('5ml/L');
  });

  test('creates defoliation task with description', async () => {
    const room = await seedRoom();
    const userId = new mongoose.Types.ObjectId();

    const req = mockReq(
      { roomId: room._id.toString(), type: 'defoliation', description: 'Lower canopy cleanup' },
      {},
      {},
      { _id: userId, name: 'Tester' }
    );
    const res = mockRes();

    await quickAddTask(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const task = res.json.mock.calls[0][0];
    expect(task.type).toBe('defoliation');
    expect(task.description).toBe('Lower canopy cleanup');
  });

  test('creates custom task using description as title', async () => {
    const room = await seedRoom();
    const userId = new mongoose.Types.ObjectId();

    const req = mockReq(
      { roomId: room._id.toString(), type: 'custom', description: 'Check trichomes' },
      {},
      {},
      { _id: userId, name: 'Tester' }
    );
    const res = mockRes();

    await quickAddTask(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const task = res.json.mock.calls[0][0];
    expect(task.title).toBe('Check trichomes');
  });

  test('returns 404 if room does not exist', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();

    const req = mockReq(
      { roomId: fakeId.toString(), type: 'spray' },
      {},
      {},
      { _id: userId, name: 'Tester' }
    );
    const res = mockRes();

    await quickAddTask(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});
