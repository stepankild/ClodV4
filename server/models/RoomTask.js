import mongoose from 'mongoose';

// Предустановленные типы задач
export const TASK_TYPES = {
  SPRAY: 'spray',           // Опрыскивание
  NET: 'net',               // Натяжка сетки
  TRIM: 'trim',             // Подрезка/дефолиация
  FEED: 'feed',             // Подкормка
  WATER: 'water',           // Полив
  FLUSH: 'flush',           // Промывка
  TRAINING: 'training',     // Тренировка (LST, HST)
  TRANSPLANT: 'transplant', // Пересадка
  PEST_CHECK: 'pest_check', // Проверка на вредителей
  PH_CHECK: 'ph_check',     // Проверка pH
  CUSTOM: 'custom'          // Пользовательская задача
};

export const TASK_LABELS = {
  spray: 'Опрыскивание',
  net: 'Натяжка сетки',
  trim: 'Подрезка/Дефолиация',
  feed: 'Подкормка',
  water: 'Полив',
  flush: 'Промывка',
  training: 'Тренировка',
  transplant: 'Пересадка',
  pest_check: 'Проверка на вредителей',
  ph_check: 'Проверка pH',
  custom: 'Другое'
};

const roomTaskSchema = new mongoose.Schema({
  room: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'FlowerRoom',
    required: true,
    index: false // use compound indexes below only
  },
  cycleId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CycleArchive',
    default: null
  },
  type: {
    type: String,
    enum: Object.values(TASK_TYPES),
    required: true
  },
  title: {
    type: String,
    required: true
  },
  description: {
    type: String,
    default: ''
  },
  // Для опрыскивания - от чего
  sprayProduct: {
    type: String,
    default: ''
  },
  // Для подкормки - чем и дозировка
  feedProduct: {
    type: String,
    default: ''
  },
  feedDosage: {
    type: String,
    default: ''
  },
  completed: {
    type: Boolean,
    default: false
  },
  completedAt: {
    type: Date,
    default: null
  },
  completedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  dayOfCycle: {
    type: Number,
    default: null
  },
  scheduledDate: {
    type: Date,
    default: null
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high'],
    default: 'medium'
  }
}, {
  timestamps: true
});

// Индексы
roomTaskSchema.index({ room: 1, completed: 1 });
roomTaskSchema.index({ room: 1, cycleId: 1 });

const RoomTask = mongoose.model('RoomTask', roomTaskSchema);

export default RoomTask;
