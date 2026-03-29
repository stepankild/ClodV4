import mongoose from 'mongoose';

const zoneSchema = new mongoose.Schema({
  zoneId: { type: String, required: true, unique: true, trim: true },
  name: { type: String, required: true, trim: true },
  roomRef: { type: mongoose.Schema.Types.ObjectId, ref: 'FlowerRoom', default: null },
  config: {
    targetTemp: { type: Number, default: 25 },
    targetRH: { type: Number, default: 55 },
    co2AlertThreshold: { type: Number, default: 1500 },
    humidifierMode: { type: String, enum: ['auto', 'manual_on', 'manual_off'], default: 'manual_off' },
    rhLow: { type: Number, default: 60 },
    rhHigh: { type: Number, default: 70 },
    humidifierEntityId: { type: String, default: 'switch.cuco_v2eur_189e_switch' }
  },
  sensors: [{
    type: { type: String, enum: ['ds18b20', 'sht40', 'sht45', 'scd41', 'bh1750'] },
    sensorId: { type: String },
    location: { type: String },
    enabled: { type: Boolean, default: true }
  }],
  piStatus: {
    online: { type: Boolean, default: false },
    lastSeen: { type: Date, default: null },
    ip: { type: String, default: null }
  }
}, { timestamps: true });

export default mongoose.model('Zone', zoneSchema);
