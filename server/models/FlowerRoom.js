import mongoose from 'mongoose';

const flowerRoomSchema = new mongoose.Schema({
  roomNumber: {
    type: Number,
    required: true,
    min: 1,
    max: 99
  },
  name: {
    type: String,
    default: function() {
      return `Комната ${this.roomNumber}`;
    }
  },
  cycleName: { type: String, trim: true, default: '' },
  strain: {
    type: String,
    trim: true,
    default: ''
  },
  plantsCount: {
    type: Number,
    default: 0,
    min: 0
  },
  flowerStrains: [{
    strain: { type: String, default: '' },
    quantity: { type: Number, default: 0 },
    startNumber: { type: Number, default: null },
    endNumber: { type: Number, default: null }
  }],
  startDate: {
    type: Date,
    default: null
  },
  floweringDays: {
    type: Number,
    default: 56,
    min: 1
  },
  expectedHarvestDate: {
    type: Date,
    default: null
  },
  notes: {
    type: String,
    default: ''
  },
  isActive: {
    type: Boolean,
    default: false
  },
  isTestRoom: {
    type: Boolean,
    default: false
  },
  // Условия выращивания
  environment: {
    lightHours: {
      type: Number,
      default: 12
    },
    medium: {
      type: String,
      enum: ['soil', 'coco', 'hydro', 'aero', 'other'],
      default: 'soil'
    },
    nutrients: {
      type: String,
      default: ''
    }
  },
  // ID текущего цикла (для связи задач)
  currentCycleId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null
  },
  // Счётчик завершённых циклов
  totalCycles: {
    type: Number,
    default: 0
  },
  // Площадь комнаты (постоянная характеристика)
  squareMeters: {
    type: Number,
    default: null,
    min: 0
  },
  // Освещение
  lighting: {
    lampCount: { type: Number, default: null, min: 0 },
    lampWattage: { type: Number, default: null, min: 0 },
    lampType: {
      type: String,
      enum: ['LED', 'HPS', 'CMH', 'MH', 'fluorescent', 'other', null],
      default: null
    }
  },
  // Размеры комнаты (метры)
  roomDimensions: {
    length: { type: Number, default: null, min: 0 },
    width: { type: Number, default: null, min: 0 },
    height: { type: Number, default: null, min: 0 }
  },
  // Размер горшка (литры)
  potSize: {
    type: Number,
    default: null,
    min: 0
  },
  // Вентиляция
  ventilation: {
    intakeType: { type: String, default: '' },
    exhaustType: { type: String, default: '' },
    co2: { type: Boolean, default: false }
  },
  // Карта комнаты (кастомные ряды, каждый с cols × rows сеткой)
  roomLayout: {
    customRows: [{
      name: { type: String, default: '' },
      cols: { type: Number, default: 4, min: 1 },
      rows: { type: Number, default: 1, min: 1 },
      fillDirection: { type: String, enum: ['topDown', 'bottomUp'], default: 'topDown' }
    }],
    plantPositions: [{
      row: { type: Number, required: true },
      position: { type: Number, required: true },
      plantNumber: { type: Number, required: true }
    }],
    fillDirection: { type: String, enum: ['topDown', 'bottomUp'], default: 'topDown' }
  }
}, {
  timestamps: true
});

// Calculate total watts
flowerRoomSchema.virtual('totalWatts').get(function() {
  if (!this.lighting?.lampCount || !this.lighting?.lampWattage) return null;
  return this.lighting.lampCount * this.lighting.lampWattage;
});

// Calculate progress percentage
flowerRoomSchema.virtual('progress').get(function() {
  if (!this.startDate || !this.floweringDays) return 0;

  const now = new Date();
  const start = new Date(this.startDate);
  const daysPassed = Math.floor((now - start) / (1000 * 60 * 60 * 24));
  const progress = Math.min(Math.max((daysPassed / this.floweringDays) * 100, 0), 100);

  return Math.round(progress);
});

// Calculate days remaining
flowerRoomSchema.virtual('daysRemaining').get(function() {
  if (!this.startDate || !this.floweringDays) return null;

  const now = new Date();
  const start = new Date(this.startDate);
  const daysPassed = Math.floor((now - start) / (1000 * 60 * 60 * 24));
  const remaining = this.floweringDays - daysPassed;

  return Math.max(remaining, 0);
});

// Calculate current day of flowering
flowerRoomSchema.virtual('currentDay').get(function() {
  if (!this.startDate) return 0;

  const now = new Date();
  const start = new Date(this.startDate);
  const daysPassed = Math.floor((now - start) / (1000 * 60 * 60 * 24));

  return Math.max(daysPassed + 1, 1);
});

// Auto-calculate expected harvest date when startDate or floweringDays changes
flowerRoomSchema.pre('save', function(next) {
  if (this.startDate && this.floweringDays) {
    const harvestDate = new Date(this.startDate);
    harvestDate.setDate(harvestDate.getDate() + this.floweringDays);
    this.expectedHarvestDate = harvestDate;
  }
  next();
});

// Include virtuals in JSON
flowerRoomSchema.set('toJSON', { virtuals: true });
flowerRoomSchema.set('toObject', { virtuals: true });

const FlowerRoom = mongoose.model('FlowerRoom', flowerRoomSchema);

export default FlowerRoom;
