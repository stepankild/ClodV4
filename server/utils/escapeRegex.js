/**
 * Экранирует спецсимволы RegExp в пользовательском вводе.
 * Предотвращает ReDoS атаки.
 */
export function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
