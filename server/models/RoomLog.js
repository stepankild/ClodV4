import mongoose from 'mongoose';

// Логирование всех событий в комнате
const roomLogSchema = new mongoose.Schema({
  room: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'FlowerRoom',
    required: true
  },
  cycleId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CycleArchive',
    default: null
  },
  type: {
    type: String,
    enum: [
      'cycle_start',      // Начало цикла
      'cycle_end',        // Конец цикла (урожай)
      'task_completed',   // Выполнена задача
      'note_added',       // Добавлена заметка
      'issue_reported',   // Сообщено о проблеме
      'issue_resolved',   // Проблема решена
      'photo_added',      // Добавлено фото
      'environment_log',  // Лог условий
      'feeding',          // Подкормка
      'watering',         // Полив
      'measurement'       // Измерение (pH, EC, и т.д.)
    ],
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
  data: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  dayOfCycle: {
    type: Number,
    default: null
  }
}, {
  timestamps: true
});

// Индексы
roomLogSchema.index({ room: 1, createdAt: -1 });
roomLogSchema.index({ room: 1, cycleId: 1 });
roomLogSchema.index({ type: 1 });

const RoomLog = mongoose.model('RoomLog', roomLogSchema);

export default RoomLog;
