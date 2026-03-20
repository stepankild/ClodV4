import mongoose from 'mongoose';

const motherRoomMapSchema = new mongoose.Schema({
  motherRows: [{
    name: { type: String, default: '' },
    tablesCount: { type: Number, default: 4, min: 1 },
    plantsPerTable: { type: Number, default: 20, min: 1 },
    tableCols: { type: Number, default: 5, min: 1 },
    tableRows: { type: Number, default: 4, min: 1 },
    deadSpots: [{ type: Number }]
  }],
  plantPositions: [{
    row: { type: Number, required: true },
    position: { type: Number, required: true },
    plantId: { type: mongoose.Schema.Types.ObjectId, ref: 'MotherPlant', required: true }
  }]
}, {
  timestamps: true
});

const MotherRoomMap = mongoose.model('MotherRoomMap', motherRoomMapSchema);

export default MotherRoomMap;
