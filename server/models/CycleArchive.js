import mongoose from 'mongoose';

const cycleArchiveSchema = new mongoose.Schema({
  room: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'FlowerRoom',
    required: true,
    index: false // use compound indexes below only
  },
  roomNumber: {
    type: Number,
    required: true
  },
  roomName: {
    type: String,
    required: true
  },
  // Основные данные цикла
  strain: {
    type: String,
    required: true
  },
  plantsCount: {
    type: Number,
    required: true
  },
  startDate: {
    type: Date,
    required: true
  },
  harvestDate: {
    type: Date,
    required: true
  },
  floweringDays: {
    type: Number,
    required: true
  },
  actualDays: {
    type: Number,
    required: true
  },
  // Результаты урожая
  harvestData: {
    wetWeight: {
      type: Number,  // в граммах
      default: 0
    },
    dryWeight: {
      type: Number,  // в граммах
      default: 0
    },
    trimWeight: {
      type: Number,  // трим/листья в граммах
      default: 0
    },
    quality: {
      type: String,
      enum: ['low', 'medium', 'high', 'premium'],
      default: 'medium'
    },
    notes: {
      type: String,
      default: ''
    }
  },
  // Расчётные показатели
  metrics: {
    gramsPerPlant: {
      type: Number,
      default: 0
    },
    gramsPerDay: {
      type: Number,
      default: 0
    }
  },
  // Условия выращивания (для анализа)
  environment: {
    lightHours: {
      type: Number,
      default: 12
    },
    avgTemperature: {
      type: Number,
      default: null
    },
    avgHumidity: {
      type: Number,
      default: null
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
  // Копия заметок
  notes: {
    type: String,
    default: ''
  },
  // Все выполненные задачи за цикл
  completedTasks: [{
    type: {
      type: String
    },
    title: String,
    description: String,
    completedAt: Date,
    completedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    dayOfCycle: Number,
    sprayProduct: String,
    feedProduct: String,
    feedDosage: String
  }],
  // Проблемы во время цикла
  issues: [{
    type: {
      type: String,
      enum: ['pest', 'disease', 'deficiency', 'toxicity', 'environmental', 'other']
    },
    description: String,
    detectedAt: Date,
    resolvedAt: Date,
    solution: String
  }]
}, {
  timestamps: true
});

// Индексы
cycleArchiveSchema.index({ room: 1, createdAt: -1 });
cycleArchiveSchema.index({ strain: 1 });
cycleArchiveSchema.index({ harvestDate: -1 });

// Виртуальные поля
cycleArchiveSchema.virtual('efficiency').get(function() {
  if (!this.harvestData.dryWeight || !this.plantsCount) return 0;
  return Math.round(this.harvestData.dryWeight / this.plantsCount);
});

cycleArchiveSchema.set('toJSON', { virtuals: true });
cycleArchiveSchema.set('toObject', { virtuals: true });

const CycleArchive = mongoose.model('CycleArchive', cycleArchiveSchema);

export default CycleArchive;
