import mongoose from 'mongoose';

const flowerRoomSchema = new mongoose.Schema({
  roomNumber: {
    type: Number,
    required: true,
    min: 1,
    max: 5
  },
  name: {
    type: String,
    default: function() {
      return `Комната ${this.roomNumber}`;
    }
  },
  // Название/код цикла (задаётся при старте)
  cycleName: {
    type: String,
    trim: true,
    default: ''
  },
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
  }
}, {
  timestamps: true
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
