/**
 * Localize room name: replaces "Комната N" with translated "Room N" / "Комната N"
 * based on current i18n language.
 *
 * Usage: localizeRoomName(room.name, t)
 */
const ROOM_PATTERN = /^Комната\s+(\d+)$/;

export const localizeRoomName = (name, t) => {
  if (!name || !t) return name || '';
  const match = name.match(ROOM_PATTERN);
  if (match) {
    return `${t('common.roomWord')} ${match[1]}`;
  }
  return name;
};
