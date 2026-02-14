import { describe, test, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { connectDB, closeDB, clearDB, mockReq, mockRes } from './testHelper.js';
import mongoose from 'mongoose';
import CloneCut from '../models/CloneCut.js';
import VegBatch from '../models/VegBatch.js';
import '../models/AuditLog.js';
import {
  upsertCloneCut,
  getCloneCuts,
  updateCloneCut,
  deleteCloneCut,
  restoreCloneCut
} from '../controllers/cloneCutController.js';
import {
  createVegBatch,
  getVegBatches,
  updateVegBatch,
  deleteVegBatch,
  restoreVegBatch
} from '../controllers/vegBatchController.js';

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

// ═══════════════════════════════════════════
// CLONE CUT TESTS
// ═══════════════════════════════════════════

describe('CloneCut - upsertCloneCut', () => {
  test('creates new order clone cut with strains array', async () => {
    const req = mockReq({
      forOrder: true,
      cutDate: '2025-03-01',
      strains: [
        { strain: 'OG Kush', quantity: 10 },
        { strain: 'Blue Dream', quantity: 5 }
      ]
    });
    const res = mockRes();

    await upsertCloneCut(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const result = res.json.mock.calls[0][0];
    expect(result.strains).toHaveLength(2);
    expect(result.strains[0].strain).toBe('OG Kush');
    expect(result.strains[0].quantity).toBe(10);
    expect(result.strains[1].strain).toBe('Blue Dream');
    expect(result.strains[1].quantity).toBe(5);
    expect(result.quantity).toBe(15);
    expect(result.room).toBeNull();
  });

  test('builds derived strain field from strains.join(", ")', async () => {
    const req = mockReq({
      forOrder: true,
      cutDate: '2025-03-01',
      strains: [
        { strain: 'OG Kush', quantity: 10 },
        { strain: 'Blue Dream', quantity: 5 }
      ]
    });
    const res = mockRes();

    await upsertCloneCut(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const result = res.json.mock.calls[0][0];
    expect(result.strain).toBe('OG Kush, Blue Dream');
  });

  test('returns 400 if cutDate is missing for order batch', async () => {
    const req = mockReq({
      forOrder: true,
      strains: [{ strain: 'OG Kush', quantity: 5 }]
    });
    const res = mockRes();

    await upsertCloneCut(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('upserts by room - creates then updates existing', async () => {
    const roomId = new mongoose.Types.ObjectId();
    const req1 = mockReq({
      roomId: roomId.toString(),
      cutDate: '2025-03-01',
      strains: [{ strain: 'Strain A', quantity: 10 }]
    });
    const res1 = mockRes();
    await upsertCloneCut(req1, res1);

    const first = res1.json.mock.calls[0][0];
    expect(first.strains[0].strain).toBe('Strain A');

    // Upsert same room - should update, not create new
    const req2 = mockReq({
      roomId: roomId.toString(),
      cutDate: '2025-04-01',
      strains: [{ strain: 'Strain B', quantity: 20 }]
    });
    const res2 = mockRes();
    await upsertCloneCut(req2, res2);

    const second = res2.json.mock.calls[0][0];
    expect(second.strains[0].strain).toBe('Strain B');
    expect(second.quantity).toBe(20);

    // Only one doc should exist
    const all = await CloneCut.find({});
    expect(all).toHaveLength(1);
  });
});

describe('CloneCut - getCloneCuts', () => {
  test('returns only non-deleted clone cuts', async () => {
    await CloneCut.create({
      cutDate: new Date('2025-03-01'),
      strains: [{ strain: 'Active Strain', quantity: 5 }],
      strain: 'Active Strain',
      quantity: 5
    });
    await CloneCut.create({
      cutDate: new Date('2025-03-02'),
      strains: [{ strain: 'Deleted Strain', quantity: 3 }],
      strain: 'Deleted Strain',
      quantity: 3,
      deletedAt: new Date()
    });

    const req = mockReq();
    const res = mockRes();
    await getCloneCuts(req, res);

    const result = res.json.mock.calls[0][0];
    expect(result).toHaveLength(1);
    expect(result[0].strain).toBe('Active Strain');
  });
});

describe('CloneCut - updateCloneCut', () => {
  test('updates fields on an existing clone cut', async () => {
    const doc = await CloneCut.create({
      cutDate: new Date('2025-03-01'),
      strains: [{ strain: 'OG Kush', quantity: 10 }],
      strain: 'OG Kush',
      quantity: 10,
      isDone: false,
      notes: ''
    });

    const req = mockReq(
      {
        strains: [
          { strain: 'OG Kush', quantity: 8 },
          { strain: 'White Widow', quantity: 4 }
        ],
        isDone: true,
        notes: 'Updated notes'
      },
      { id: doc._id.toString() }
    );
    const res = mockRes();

    await updateCloneCut(req, res);

    const result = res.json.mock.calls[0][0];
    expect(result.strains).toHaveLength(2);
    expect(result.strain).toBe('OG Kush, White Widow');
    expect(result.quantity).toBe(12);
    expect(result.isDone).toBe(true);
    expect(result.notes).toBe('Updated notes');
  });

  test('returns 404 for non-existent clone cut', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const req = mockReq({ isDone: true }, { id: fakeId.toString() });
    const res = mockRes();

    await updateCloneCut(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe('CloneCut - deleteCloneCut', () => {
  test('soft-deletes a clone cut by setting deletedAt', async () => {
    const doc = await CloneCut.create({
      cutDate: new Date('2025-03-01'),
      strains: [{ strain: 'OG Kush', quantity: 10 }],
      strain: 'OG Kush',
      quantity: 10
    });

    const req = mockReq({}, { id: doc._id.toString() });
    const res = mockRes();

    await deleteCloneCut(req, res);

    const result = res.json.mock.calls[0][0];
    expect(result.message).toBeDefined();

    const deleted = await CloneCut.findById(doc._id);
    expect(deleted.deletedAt).not.toBeNull();
    expect(deleted.deletedAt).toBeInstanceOf(Date);
  });

  test('returns 404 when trying to delete already-deleted clone cut', async () => {
    const doc = await CloneCut.create({
      cutDate: new Date('2025-03-01'),
      strains: [{ strain: 'Test', quantity: 1 }],
      strain: 'Test',
      quantity: 1,
      deletedAt: new Date()
    });

    const req = mockReq({}, { id: doc._id.toString() });
    const res = mockRes();

    await deleteCloneCut(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe('CloneCut - restoreCloneCut', () => {
  test('restores a soft-deleted clone cut by clearing deletedAt', async () => {
    const doc = await CloneCut.create({
      cutDate: new Date('2025-03-01'),
      strains: [{ strain: 'OG Kush', quantity: 10 }],
      strain: 'OG Kush',
      quantity: 10,
      deletedAt: new Date()
    });

    const req = mockReq({}, { id: doc._id.toString() });
    const res = mockRes();

    await restoreCloneCut(req, res);

    const result = res.json.mock.calls[0][0];
    expect(result.deletedAt).toBeNull();
    expect(result.strain).toBe('OG Kush');

    // Verify in DB
    const restored = await CloneCut.findById(doc._id);
    expect(restored.deletedAt).toBeNull();
  });

  test('returns 404 when trying to restore a non-deleted clone cut', async () => {
    const doc = await CloneCut.create({
      cutDate: new Date('2025-03-01'),
      strains: [{ strain: 'Test', quantity: 1 }],
      strain: 'Test',
      quantity: 1
    });

    const req = mockReq({}, { id: doc._id.toString() });
    const res = mockRes();

    await restoreCloneCut(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ═══════════════════════════════════════════
// VEG BATCH TESTS
// ═══════════════════════════════════════════

describe('VegBatch - createVegBatch', () => {
  test('creates batch with strains, cutDate, transplantedToVegAt', async () => {
    const req = mockReq({
      cutDate: '2025-02-15',
      transplantedToVegAt: '2025-03-01',
      strains: [
        { strain: 'OG Kush', quantity: 20 },
        { strain: 'Blue Dream', quantity: 10 }
      ]
    });
    const res = mockRes();

    await createVegBatch(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const result = res.json.mock.calls[0][0];
    expect(result.strains).toHaveLength(2);
    expect(result.strains[0].strain).toBe('OG Kush');
    expect(result.strains[0].quantity).toBe(20);
    expect(result.strains[1].strain).toBe('Blue Dream');
    expect(result.strains[1].quantity).toBe(10);
    expect(result.quantity).toBe(30);
    expect(result.initialQuantity).toBe(30);
    expect(result.cutDate).toBeDefined();
    expect(result.transplantedToVegAt).toBeDefined();
  });

  test('builds derived strain from strains array', async () => {
    const req = mockReq({
      cutDate: '2025-02-15',
      transplantedToVegAt: '2025-03-01',
      strains: [
        { strain: 'OG Kush', quantity: 20 },
        { strain: 'Blue Dream', quantity: 10 }
      ]
    });
    const res = mockRes();

    await createVegBatch(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const result = res.json.mock.calls[0][0];
    expect(result.strain).toBe('OG Kush, Blue Dream');
  });

  test('returns 400 if cutDate or transplantedToVegAt is missing', async () => {
    const req1 = mockReq({
      transplantedToVegAt: '2025-03-01',
      strains: [{ strain: 'Test', quantity: 5 }]
    });
    const res1 = mockRes();
    await createVegBatch(req1, res1);
    expect(res1.status).toHaveBeenCalledWith(400);

    const req2 = mockReq({
      cutDate: '2025-02-15',
      strains: [{ strain: 'Test', quantity: 5 }]
    });
    const res2 = mockRes();
    await createVegBatch(req2, res2);
    expect(res2.status).toHaveBeenCalledWith(400);
  });

  test('sets default vegDaysTarget to 21', async () => {
    const req = mockReq({
      cutDate: '2025-02-15',
      transplantedToVegAt: '2025-03-01',
      strains: [{ strain: 'Test', quantity: 5 }]
    });
    const res = mockRes();

    await createVegBatch(req, res);

    const result = res.json.mock.calls[0][0];
    expect(result.vegDaysTarget).toBe(21);
  });
});

describe('VegBatch - getVegBatches', () => {
  test('returns only non-deleted batches', async () => {
    await VegBatch.create({
      cutDate: new Date('2025-02-15'),
      transplantedToVegAt: new Date('2025-03-01'),
      strains: [{ strain: 'Active', quantity: 10 }],
      strain: 'Active',
      quantity: 10
    });
    await VegBatch.create({
      cutDate: new Date('2025-02-16'),
      transplantedToVegAt: new Date('2025-03-02'),
      strains: [{ strain: 'Deleted', quantity: 5 }],
      strain: 'Deleted',
      quantity: 5,
      deletedAt: new Date()
    });

    const req = mockReq({}, {}, { inVeg: 'true' });
    const res = mockRes();
    await getVegBatches(req, res);

    const result = res.json.mock.calls[0][0];
    expect(result).toHaveLength(1);
    expect(result[0].strain).toBe('Active');
  });
});

describe('VegBatch - updateVegBatch', () => {
  test('updates fields including diedCount and notGrownCount', async () => {
    const doc = await VegBatch.create({
      cutDate: new Date('2025-02-15'),
      transplantedToVegAt: new Date('2025-03-01'),
      strains: [{ strain: 'OG Kush', quantity: 20 }],
      strain: 'OG Kush',
      quantity: 20,
      diedCount: 0,
      notGrownCount: 0
    });

    const req = mockReq(
      {
        diedCount: 3,
        notGrownCount: 2,
        notes: 'Some died, some did not grow'
      },
      { id: doc._id.toString() }
    );
    const res = mockRes();

    await updateVegBatch(req, res);

    const result = res.json.mock.calls[0][0];
    expect(result.diedCount).toBe(3);
    expect(result.notGrownCount).toBe(2);
    expect(result.notes).toBe('Some died, some did not grow');
  });

  test('handles transplantedToFlowerAt date', async () => {
    const doc = await VegBatch.create({
      cutDate: new Date('2025-02-15'),
      transplantedToVegAt: new Date('2025-03-01'),
      strains: [{ strain: 'OG Kush', quantity: 20 }],
      strain: 'OG Kush',
      quantity: 20
    });

    const flowerDate = '2025-04-01';
    const req = mockReq(
      { transplantedToFlowerAt: flowerDate },
      { id: doc._id.toString() }
    );
    const res = mockRes();

    await updateVegBatch(req, res);

    const result = res.json.mock.calls[0][0];
    expect(result.transplantedToFlowerAt).toBeDefined();
    expect(new Date(result.transplantedToFlowerAt).toISOString().slice(0, 10)).toBe('2025-04-01');
  });

  test('can clear transplantedToFlowerAt by passing null', async () => {
    const doc = await VegBatch.create({
      cutDate: new Date('2025-02-15'),
      transplantedToVegAt: new Date('2025-03-01'),
      strains: [{ strain: 'OG Kush', quantity: 20 }],
      strain: 'OG Kush',
      quantity: 20,
      transplantedToFlowerAt: new Date('2025-04-01')
    });

    const req = mockReq(
      { transplantedToFlowerAt: null },
      { id: doc._id.toString() }
    );
    const res = mockRes();

    await updateVegBatch(req, res);

    const result = res.json.mock.calls[0][0];
    expect(result.transplantedToFlowerAt).toBeNull();
  });

  test('updates strains array and rebuilds derived strain', async () => {
    const doc = await VegBatch.create({
      cutDate: new Date('2025-02-15'),
      transplantedToVegAt: new Date('2025-03-01'),
      strains: [{ strain: 'OG Kush', quantity: 20 }],
      strain: 'OG Kush',
      quantity: 20
    });

    const req = mockReq(
      {
        strains: [
          { strain: 'OG Kush', quantity: 15 },
          { strain: 'White Widow', quantity: 5 }
        ]
      },
      { id: doc._id.toString() }
    );
    const res = mockRes();

    await updateVegBatch(req, res);

    const result = res.json.mock.calls[0][0];
    expect(result.strains).toHaveLength(2);
    expect(result.strain).toBe('OG Kush, White Widow');
    expect(result.quantity).toBe(20);
  });

  test('returns 404 for non-existent batch', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const req = mockReq({ diedCount: 1 }, { id: fakeId.toString() });
    const res = mockRes();

    await updateVegBatch(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe('VegBatch - deleteVegBatch', () => {
  test('soft-deletes a veg batch by setting deletedAt', async () => {
    const doc = await VegBatch.create({
      cutDate: new Date('2025-02-15'),
      transplantedToVegAt: new Date('2025-03-01'),
      strains: [{ strain: 'OG Kush', quantity: 20 }],
      strain: 'OG Kush',
      quantity: 20
    });

    const req = mockReq({}, { id: doc._id.toString() });
    const res = mockRes();

    await deleteVegBatch(req, res);

    const result = res.json.mock.calls[0][0];
    expect(result.message).toBeDefined();

    const deleted = await VegBatch.findById(doc._id);
    expect(deleted.deletedAt).not.toBeNull();
    expect(deleted.deletedAt).toBeInstanceOf(Date);
  });

  test('returns 404 when trying to delete already-deleted batch', async () => {
    const doc = await VegBatch.create({
      cutDate: new Date('2025-02-15'),
      transplantedToVegAt: new Date('2025-03-01'),
      strains: [{ strain: 'Test', quantity: 1 }],
      strain: 'Test',
      quantity: 1,
      deletedAt: new Date()
    });

    const req = mockReq({}, { id: doc._id.toString() });
    const res = mockRes();

    await deleteVegBatch(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe('VegBatch - restoreVegBatch', () => {
  test('restores a soft-deleted veg batch by clearing deletedAt and disposedCount', async () => {
    const doc = await VegBatch.create({
      cutDate: new Date('2025-02-15'),
      transplantedToVegAt: new Date('2025-03-01'),
      strains: [{ strain: 'OG Kush', quantity: 20 }],
      strain: 'OG Kush',
      quantity: 20,
      disposedCount: 10,
      deletedAt: new Date()
    });

    const req = mockReq({}, { id: doc._id.toString() });
    const res = mockRes();

    await restoreVegBatch(req, res);

    const result = res.json.mock.calls[0][0];
    expect(result.deletedAt).toBeNull();
    expect(result.disposedCount).toBe(0);
    expect(result.strain).toBe('OG Kush');

    // Verify in DB
    const restored = await VegBatch.findById(doc._id);
    expect(restored.deletedAt).toBeNull();
    expect(restored.disposedCount).toBe(0);
  });

  test('returns 404 when trying to restore a non-deleted batch', async () => {
    const doc = await VegBatch.create({
      cutDate: new Date('2025-02-15'),
      transplantedToVegAt: new Date('2025-03-01'),
      strains: [{ strain: 'Test', quantity: 1 }],
      strain: 'Test',
      quantity: 1
    });

    const req = mockReq({}, { id: doc._id.toString() });
    const res = mockRes();

    await restoreVegBatch(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});
