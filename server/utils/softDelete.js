/** Фильтр "не удалено" для soft delete. Подходит для документов без поля deletedAt (старые). */
export const notDeleted = { $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }] };

/** Фильтр "удалено" — есть дата удаления. */
export const deletedOnly = { deletedAt: { $ne: null, $exists: true } };
