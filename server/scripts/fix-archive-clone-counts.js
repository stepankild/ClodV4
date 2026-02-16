/**
 * One-time migration: fix cloneData.quantity in existing CycleArchive records.
 *
 * Problem: cloneData.quantity was set from cloneCut.quantity (remainder in cut)
 * instead of vegBatch.sentToFlowerCount (actual plants for this cycle).
 *
 * Usage: MONGODB_URI=... node scripts/fix-archive-clone-counts.js
 *   or run via Railway console.
 */

import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('Set MONGODB_URI env variable');
  process.exit(1);
}

await mongoose.connect(MONGODB_URI);
console.log('Connected to MongoDB');

const CycleArchive = mongoose.connection.collection('cyclearchives');
const VegBatch = mongoose.connection.collection('vegbatches');
const CloneCut = mongoose.connection.collection('clonecuts');

const archives = await CycleArchive.find({
  'cloneData': { $ne: null },
  $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }]
}).toArray();

console.log(`Found ${archives.length} archives with cloneData`);

let fixed = 0;
for (const arc of archives) {
  const roomId = arc.room;
  if (!roomId) continue;

  // Find the VegBatch linked to this room (latest transplant before archive harvest)
  const veg = await VegBatch.findOne(
    { flowerRoom: roomId },
    { sort: { transplantedToFlowerAt: -1 } }
  );

  if (!veg) {
    console.log(`  [${arc.roomName || arc.roomNumber}] no VegBatch found, skipping`);
    continue;
  }

  // Determine correct clone count
  const correctCount = veg.sentToFlowerCount
    || veg.initialQuantity
    || veg.quantity
    || 0;

  const correctStrains = (veg.sentToFlowerStrains?.length > 0)
    ? veg.sentToFlowerStrains
    : veg.strains || [];

  const oldCount = arc.cloneData?.quantity;

  if (correctCount && correctCount !== oldCount) {
    console.log(`  [${arc.roomName || arc.roomNumber}] ${arc.strain}: ${oldCount} -> ${correctCount}`);

    const update = { 'cloneData.quantity': correctCount };
    if (correctStrains.length > 0) {
      update['cloneData.strains'] = correctStrains;
    }

    await CycleArchive.updateOne({ _id: arc._id }, { $set: update });
    fixed++;
  } else {
    console.log(`  [${arc.roomName || arc.roomNumber}] ${arc.strain}: ${oldCount} (already correct or no better data)`);
  }
}

console.log(`\nDone. Fixed ${fixed} of ${archives.length} archives.`);
await mongoose.disconnect();
