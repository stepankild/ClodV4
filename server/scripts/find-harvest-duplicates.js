import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('MONGODB_URI not set');
  process.exit(1);
}

await mongoose.connect(MONGODB_URI);
console.log('Connected to MongoDB\n');

const HarvestSession = mongoose.model('HarvestSession', new mongoose.Schema({}, { strict: false, collection: 'harvestsessions' }));

// Find the most recent completed session (or in_progress with most plants)
const sessions = await HarvestSession.find({}).sort({ updatedAt: -1 }).limit(5).lean();

console.log('=== Last 5 sessions ===');
for (const s of sessions) {
  console.log(`  ${s._id} | ${s.roomName || '?'} | status: ${s.status} | plants: ${s.plants?.length || 0}/${s.plantsCount || '?'} | updated: ${s.updatedAt}`);
}

// Find the one with ~400 plants
const target = sessions.find(s => s.plants?.length >= 376) || sessions[0];
if (!target) {
  console.log('No sessions found');
  process.exit(0);
}

console.log(`\n=== Analyzing session: ${target._id} (${target.roomName}, ${target.plants?.length} plants) ===\n`);

const plants = target.plants || [];
const seen = new Map(); // plantNumber -> first entry
const duplicates = [];

for (let i = 0; i < plants.length; i++) {
  const p = plants[i];
  const num = p.plantNumber;
  if (seen.has(num)) {
    const first = seen.get(num);
    duplicates.push({
      plantNumber: num,
      firstIndex: first.index,
      firstWeight: first.weight,
      firstTime: first.time,
      dupIndex: i,
      dupWeight: p.wetWeight,
      dupTime: p.recordedAt,
      sameWeight: first.weight === p.wetWeight
    });
  } else {
    seen.set(num, { index: i, weight: p.wetWeight, time: p.recordedAt });
  }
}

console.log(`Total plants: ${plants.length}`);
console.log(`Unique plants: ${seen.size}`);
console.log(`Duplicates: ${duplicates.length}\n`);

if (duplicates.length > 0) {
  console.log('=== Duplicate entries ===');
  console.log('Plant# | 1st weight | 1st time              | Dup weight | Dup time              | Same?');
  console.log('-------|------------|----------------------|------------|----------------------|------');
  for (const d of duplicates) {
    const t1 = new Date(d.firstTime).toLocaleString('ru-RU');
    const t2 = new Date(d.dupTime).toLocaleString('ru-RU');
    console.log(`  ${String(d.plantNumber).padStart(4)} | ${String(d.firstWeight).padStart(10)} | ${t1.padEnd(20)} | ${String(d.dupWeight).padStart(10)} | ${t2.padEnd(20)} | ${d.sameWeight ? 'YES' : 'NO'}`);
  }

  // Check which weight differs
  const diffWeight = duplicates.filter(d => !d.sameWeight);
  console.log(`\nDuplicates with SAME weight: ${duplicates.length - diffWeight.length}`);
  console.log(`Duplicates with DIFFERENT weight: ${diffWeight.length}`);

  if (diffWeight.length > 0) {
    console.log('\n⚠️  These have different weights (need manual review):');
    for (const d of diffWeight) {
      console.log(`  Plant #${d.plantNumber}: ${d.firstWeight}g vs ${d.dupWeight}g`);
    }
  }

  // Fix mode
  if (process.argv.includes('--fix')) {
    console.log('\n=== FIXING: Removing duplicate entries (keeping first occurrence) ===');

    const dupIndices = new Set(duplicates.map(d => d.dupIndex));
    const cleanedPlants = plants.filter((_, i) => !dupIndices.has(i));

    console.log(`Before: ${plants.length} plants`);
    console.log(`Removing: ${dupIndices.size} duplicates`);
    console.log(`After: ${cleanedPlants.length} plants`);

    await HarvestSession.updateOne(
      { _id: target._id },
      { $set: { plants: cleanedPlants } }
    );

    console.log('✅ Done! Duplicates removed.');
  } else {
    console.log('\n💡 To fix, run with --fix flag:');
    console.log('   MONGODB_URI="..." node scripts/find-harvest-duplicates.js --fix');
  }
}

await mongoose.disconnect();
