/**
 * Серверная интернационализация — простой хелпер.
 * Хранит переводы для всех серверных сообщений (ошибки, валидация, описания).
 *
 * Использование:
 *   import { t } from '../utils/i18n.js';
 *   res.status(400).json({ message: t('auth.invalidCredentials', req.lang) });
 */

const messages = {
  // ── Общие ──
  'common.serverError': { ru: 'Ошибка сервера', en: 'Server error' },
  'common.notFound': { ru: 'Не найдено', en: 'Not found' },
  'common.unauthorized': { ru: 'Не авторизован', en: 'Unauthorized' },
  'common.forbidden': { ru: 'Недостаточно прав для выполнения этого действия', en: 'Insufficient permissions for this action' },

  // ── Авторизация ──
  'auth.emailExists': { ru: 'Пользователь с таким email уже существует', en: 'User with this email already exists' },
  'auth.registerSuccess': { ru: 'Регистрация успешна! Ожидайте одобрения администратора.', en: 'Registration successful! Awaiting admin approval.' },
  'auth.invalidCredentials': { ru: 'Неверный email или пароль', en: 'Invalid email or password' },
  'auth.accountDisabled': { ru: 'Аккаунт деактивирован', en: 'Account deactivated' },
  'auth.pendingApproval': { ru: 'Ваш аккаунт ожидает одобрения администратором', en: 'Your account is pending admin approval' },
  'auth.tokenMissing': { ru: 'Не авторизован. Токен не предоставлен', en: 'Not authorized. No token provided' },
  'auth.userNotFound': { ru: 'Пользователь не найден', en: 'User not found' },
  'auth.sessionInvalid': { ru: 'Сессия недействительна', en: 'Session invalid' },
  'auth.tokenExpired': { ru: 'Токен истёк', en: 'Token expired' },
  'auth.tokenInvalid': { ru: 'Недействительный токен', en: 'Invalid token' },
  'auth.logoutSuccess': { ru: 'Выход выполнен успешно', en: 'Logged out successfully' },
  'auth.passwordChanged': { ru: 'Пароль успешно изменён', en: 'Password changed successfully' },
  'auth.wrongPassword': { ru: 'Неверный текущий пароль', en: 'Incorrect current password' },
  'auth.passwordTooShort': { ru: 'Новый пароль должен быть минимум 6 символов', en: 'New password must be at least 6 characters' },
  'auth.passwordRequired': { ru: 'Укажите текущий и новый пароль', en: 'Provide current and new password' },
  'auth.accountDeleted': { ru: 'Аккаунт удалён', en: 'Account deleted' },
  'auth.refreshTokenMissing': { ru: 'Refresh token не предоставлен', en: 'Refresh token not provided' },

  // ── Пользователи ──
  'users.notFound': { ru: 'Пользователь не найден', en: 'User not found' },
  'users.emailExists': { ru: 'Пользователь с таким email уже существует', en: 'User with this email already exists' },
  'users.rolesNotFound': { ru: 'Одна или несколько ролей не найдены', en: 'One or more roles not found' },
  'users.deleted': { ru: 'Пользователь удалён (можно восстановить)', en: 'User deleted (can be restored)' },
  'users.cannotDeleteSelf': { ru: 'Нельзя удалить самого себя', en: 'Cannot delete yourself' },
  'users.deletedNotFound': { ru: 'Удалённый пользователь не найден', en: 'Deleted user not found' },

  // ── Роли ──
  'roles.notFound': { ru: 'Роль не найдена', en: 'Role not found' },
  'roles.nameRequired': { ru: 'Укажите название роли', en: 'Role name is required' },
  'roles.nameExists': { ru: 'Роль с таким названием уже существует', en: 'Role with this name already exists' },
  'roles.cannotDeleteSystem': { ru: 'Системную роль удалить нельзя', en: 'Cannot delete system role' },
  'roles.hasUsers': { ru: 'Сначала снимите эту роль у всех пользователей', en: 'Remove this role from all users first' },
  'roles.deleted': { ru: 'Роль удалена (можно восстановить)', en: 'Role deleted (can be restored)' },
  'roles.deletedNotFound': { ru: 'Удалённая роль не найдена', en: 'Deleted role not found' },
  'roles.permissionsNotFound': { ru: 'Одна или несколько прав не найдены', en: 'One or more permissions not found' },

  // ── Комнаты ──
  'rooms.notFound': { ru: 'Комната не найдена', en: 'Room not found' },
  'rooms.cycleAlreadyActive': { ru: 'В этой комнате уже идёт цикл цветения. Сначала завершите текущий цикл (соберите урожай).', en: 'This room already has an active flowering cycle. Complete the current cycle (harvest) first.' },
  'rooms.noPermissionCycleName': { ru: 'Нет прав на изменение названия цикла', en: 'No permission to change cycle name' },
  'rooms.noteAdded': { ru: 'Добавлена заметка', en: 'Note added' },
  'rooms.transferAtLeastOne': { ru: 'Нужно перенести хотя бы одно растение', en: 'Must transfer at least one plant' },
  'rooms.noReason': { ru: 'Без указания причины', en: 'No reason specified' },

  // ── Сбор урожая ──
  'harvest.specifyRoomId': { ru: 'Укажите roomId', en: 'Specify roomId' },
  'harvest.invalidRoomId': { ru: 'Некорректный ID комнаты', en: 'Invalid room ID' },
  'harvest.roomNotFound': { ru: 'Комната не найдена', en: 'Room not found' },
  'harvest.roomNotActive': { ru: 'Комната не активна. Запустите цикл или выберите другую комнату.', en: 'Room is not active. Start a cycle or select another room.' },
  'harvest.sessionNotFound': { ru: 'Сессия сбора не найдена', en: 'Harvest session not found' },
  'harvest.sessionCompleted': { ru: 'Сессия уже завершена', en: 'Session already completed' },
  'harvest.specifyPlantAndWeight': { ru: 'Укажите номер куста и вес (plantNumber, wetWeight)', en: 'Specify plant number and weight (plantNumber, wetWeight)' },
  'harvest.invalidPlantNumber': { ru: 'Номер куста должен быть числом от 1', en: 'Plant number must be a number starting from 1' },
  'harvest.invalidWeight': { ru: 'Вес должен быть неотрицательным числом', en: 'Weight must be a non-negative number' },
  'harvest.plantDuplicate': { ru: 'Куст №{{num}} уже записан', en: 'Plant #{{num}} already recorded' },
  'harvest.plantNotFound': { ru: 'Куст №{{num}} не найден в сессии', en: 'Plant #{{num}} not found in session' },
  'harvest.undoExpired': { ru: 'Время для отмены истекло (макс. 30 сек)', en: 'Undo time expired (max 30 sec)' },
  'harvest.plantRecordNotFound': { ru: 'Запись куста не найдена', en: 'Plant record not found' },
  'harvest.invalidRole': { ru: 'Некорректная роль. Допустимые: {{roles}}', en: 'Invalid role. Allowed: {{roles}}' },
  'harvest.weighingTaken': { ru: 'Роль «Взвешивание» уже занята: {{name}}', en: 'Weighing role already taken by: {{name}}' },
  'harvest.archiveNote': { ru: 'Автоархив после сбора. Записей кустов: {{count}}. Сухой вес можно добавить в архиве.', en: 'Auto-archived after harvest. Plant records: {{count}}. Dry weight can be added in archive.' },

  // ── Клоны ──
  'clones.specifyDate': { ru: 'Укажите дату нарезки (cutDate)', en: 'Specify cut date (cutDate)' },
  'clones.specifyRoom': { ru: 'Укажите комнату (roomId)', en: 'Specify room (roomId)' },

  // ── Обработки ──
  'treatments.notFound': { ru: 'Запись обработки не найдена', en: 'Treatment record not found' },
  'treatments.productNotFound': { ru: 'Продукт не найден', en: 'Product not found' },
  'treatments.productExists': { ru: 'Продукт с таким названием уже существует', en: 'Product with this name already exists' },

  // ── Задачи ──
  'tasks.notFound': { ru: 'Задача не найдена', en: 'Task not found' },

  // ── Трим ──
  'trim.notFound': { ru: 'Запись обрезки не найдена', en: 'Trim record not found' },

  // ── Архив ──
  'archive.notFound': { ru: 'Архив не найден', en: 'Archive not found' },
  'archive.deleted': { ru: 'Архив удалён (можно восстановить)', en: 'Archive deleted (can be restored)' },
  'archive.roomNotActive': { ru: 'Комната не активна', en: 'Room is not active' },
  'archive.alreadyExists': { ru: 'Архив для этого цикла уже существует', en: 'Archive for this cycle already exists' },
  'archive.notFoundOrRestored': { ru: 'Архив не найден или уже восстановлен', en: 'Archive not found or already restored' },
  'archive.noWeightPermission': { ru: 'Нет прав на изменение весов при сборе урожая', en: 'No permission to edit harvest weights' },

  // ── Комнаты (доп.) ──
  'rooms.sameRoom': { ru: 'Нельзя перенести цикл в ту же комнату', en: 'Cannot transfer cycle to the same room' },
  'rooms.sourceNotFound': { ru: 'Комната-источник не найдена', en: 'Source room not found' },
  'rooms.targetNotFound': { ru: 'Комната-назначение не найдена', en: 'Target room not found' },
  'rooms.sourceNotActive': { ru: 'Комната-источник не имеет активного цикла', en: 'Source room has no active cycle' },
  'rooms.targetAlreadyActive': { ru: 'Комната-назначение уже имеет активный цикл. Сначала завершите его.', en: 'Target room already has an active cycle. Complete it first.' },
  'rooms.invalidRoomId': { ru: 'Некорректный ID комнаты', en: 'Invalid room ID' },

  // ── Задачи (доп.) ──
  'tasks.deleted': { ru: 'Задача удалена (можно восстановить)', en: 'Task deleted (can be restored)' },
  'tasks.notFoundOrRestored': { ru: 'Задача не найдена или уже восстановлена', en: 'Task not found or already restored' },

  // ── Клоны (доп.) ──
  'clones.notFound': { ru: 'Запись не найдена', en: 'Record not found' },
  'clones.remainingDisposed': { ru: 'Остатки списаны', en: 'Remaining disposed' },
  'clones.deleted': { ru: 'Удалено (можно восстановить)', en: 'Deleted (can be restored)' },
  'clones.notFoundOrRestored': { ru: 'Запись не найдена или уже восстановлена', en: 'Record not found or already restored' },
  'clones.indexConflict': { ru: 'Конфликт ключа. Проблемный индекс удалён — попробуйте снова.', en: 'Key conflict. Problematic index removed — try again.' },
  'clones.batchConflict': { ru: 'Бэтч для этой комнаты уже существует. Попробуйте ещё раз.', en: 'Batch for this room already exists. Try again.' },

  // ── Вега ──
  'veg.specifyDates': { ru: 'Укажите дату нарезки и дату пересадки в вегетацию', en: 'Specify cut date and transplant to veg date' },
  'veg.notFound': { ru: 'Бэтч не найден', en: 'Batch not found' },
  'veg.activeRoom': { ru: 'В эту комнату нельзя добавить клоны: в ней уже идёт цикл цветения. Сначала завершите текущий цикл (соберите урожай), затем можно будет добавить новые клоны.', en: 'Cannot add clones to this room: it already has an active flowering cycle. Complete the current cycle (harvest) first, then you can add new clones.' },
  'veg.deleted': { ru: 'Удалено (можно восстановить)', en: 'Deleted (can be restored)' },
  'veg.notFoundOrRestored': { ru: 'Бэтч не найден или уже восстановлен', en: 'Batch not found or already restored' },

  // ── Трим (доп.) ──
  'trim.specifyArchiveAndWeight': { ru: 'Укажите архив и вес > 0', en: 'Specify archive and weight > 0' },
  'trim.alreadyCompleted': { ru: 'Трим уже завершён', en: 'Trim already completed' },
  'trim.specifyStrain': { ru: 'Укажите сорт', en: 'Specify strain' },
  'trim.invalidStrain': { ru: 'Выберите сорт из списка сортов этой комнаты', en: 'Select strain from this room strain list' },
  'trim.logDeleted': { ru: 'Запись удалена', en: 'Record deleted' },
  'trim.deletedNotFound': { ru: 'Удалённая запись не найдена', en: 'Deleted record not found' },
  'trim.completeRequiresPopcorn': { ru: 'Заполните вес попкорна с отсевочного стола и с машинки перед завершением', en: 'Enter popcorn weight from sorting table and machine before completing' },

  // ── Сорта ──
  'strains.nameRequired': { ru: 'Название сорта обязательно', en: 'Strain name is required' },
  'strains.alreadyExists': { ru: 'Сорт «{{name}}» уже существует', en: 'Strain "{{name}}" already exists' },
  'strains.duplicate': { ru: 'Такой сорт уже существует', en: 'This strain already exists' },
  'strains.notFound': { ru: 'Сорт не найден', en: 'Strain not found' },
  'strains.deleted': { ru: 'Сорт удалён', en: 'Strain deleted' },
  'strains.notFoundInArchive': { ru: 'Сорт не найден в архиве', en: 'Strain not found in archive' },
  'strains.migrationComplete': { ru: 'Миграция завершена', en: 'Migration complete' },
  'strains.migrationError': { ru: 'Ошибка миграции', en: 'Migration error' },
  'strains.targetRequired': { ru: 'Целевое название обязательно', en: 'Target name is required' },
  'strains.mergeSourceRequired': { ru: 'Нужно указать хотя бы один сорт для объединения', en: 'Specify at least one strain to merge' },
  'strains.nothingToMerge': { ru: 'Нечего объединять', en: 'Nothing to merge' },
  'strains.merged': { ru: 'Объединено {{count}} сортов в «{{target}}»', en: 'Merged {{count}} strains into "{{target}}"' },
  'strains.mergeError': { ru: 'Ошибка объединения', en: 'Merge error' },
  'strains.restoredRecent': { ru: 'Восстановлено {{count}} сортов, удалённых за последние {{minutes}} мин', en: 'Restored {{count}} strains deleted in the last {{minutes}} min' },

  // ── Препараты (обработки) ──
  'treatments.productNameRequired': { ru: 'Название препарата обязательно', en: 'Product name is required' },
  'treatments.productAlreadyExists': { ru: 'Препарат «{{name}}» уже существует', en: 'Product "{{name}}" already exists' },
  'treatments.productDuplicate': { ru: 'Такой препарат уже существует', en: 'This product already exists' },
  'treatments.productDeleted': { ru: 'Препарат удалён', en: 'Product deleted' },
  'treatments.productNotFoundInArchive': { ru: 'Препарат не найден в архиве', en: 'Product not found in archive' },
  'treatments.fromToRequired': { ru: 'Параметры from и to обязательны', en: 'Parameters from and to are required' },
  'treatments.roomAndDateRequired': { ru: 'Комната и дата обязательны', en: 'Room and date are required' },
  'treatments.recordDeleted': { ru: 'Запись удалена', en: 'Record deleted' },
  'treatments.notFoundInArchive': { ru: 'Запись не найдена в архиве', en: 'Record not found in archive' },

  // ── Планы ──
  'plans.specifyRoom': { ru: 'Укажите комнату (roomId)', en: 'Specify room (roomId)' },
  'plans.notFound': { ru: 'План не найден', en: 'Plan not found' },
  'plans.deleted': { ru: 'План удалён (можно восстановить)', en: 'Plan deleted (can be restored)' },
  'plans.deletedNotFound': { ru: 'Удалённый план не найден', en: 'Deleted plan not found' },

  // ── Шаблоны комнат ──
  'templates.nameRequired': { ru: 'Укажите название шаблона', en: 'Specify template name' },
  'templates.rowRequired': { ru: 'Шаблон должен содержать хотя бы один ряд', en: 'Template must contain at least one row' },
  'templates.notFound': { ru: 'Шаблон не найден', en: 'Template not found' },
  'templates.deleted': { ru: 'Шаблон удалён', en: 'Template deleted' },

  // ── Harvest (доп.) ──
  'harvest.forceInvalidRole': { ru: 'Некорректная роль', en: 'Invalid role' },
};

/**
 * Получить перевод по ключу.
 * @param {string} key - ключ сообщения (e.g. 'auth.invalidCredentials')
 * @param {string} lang - 'ru' | 'en'
 * @param {object} params - параметры для интерполяции (e.g. { num: 5 })
 */
export function t(key, lang = 'ru', params = {}) {
  const entry = messages[key];
  if (!entry) return key;
  let text = entry[lang] || entry.ru || key;
  // Интерполяция {{param}}
  for (const [k, v] of Object.entries(params)) {
    text = text.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v));
  }
  return text;
}

export default messages;
