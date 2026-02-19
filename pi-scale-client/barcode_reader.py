"""
Модуль чтения USB-сканера штрихкодов через evdev (Linux HID input).

Поддерживаемые сканеры: Honeywell Voyager XP 1470 и аналогичные HID-сканеры.
Сканер работает как USB-клавиатура — при скане "набирает" штрихкод и жмёт Enter.

На headless Raspberry Pi (без X11) читаем напрямую из /dev/input/eventX
через библиотеку evdev. Устройство "захватывается" (grab), чтобы
другие процессы не получали input.

Требования:
  - pip install evdev
  - Пользователь должен быть в группе 'input': sudo usermod -a -G input stepan
"""

import time

try:
    from evdev import InputDevice, categorize, ecodes, list_devices
    EVDEV_AVAILABLE = True
except ImportError:
    EVDEV_AVAILABLE = False

# Маппинг evdev key codes → символы (для цифр и базовых символов штрихкодов)
KEY_MAP = {
    2: '1', 3: '2', 4: '3', 5: '4', 6: '5',
    7: '6', 8: '7', 9: '8', 10: '9', 11: '0',
    16: 'Q', 17: 'W', 18: 'E', 19: 'R', 20: 'T',
    21: 'Y', 22: 'U', 23: 'I', 24: 'O', 25: 'P',
    30: 'A', 31: 'S', 32: 'D', 33: 'F', 34: 'G',
    35: 'H', 36: 'J', 37: 'K', 38: 'L',
    44: 'Z', 45: 'X', 46: 'C', 47: 'V', 48: 'B',
    49: 'N', 50: 'M',
    12: '-', 13: '=',
    52: '.', 53: '/',
    39: ';', 40: "'",
    57: ' ',  # пробел
}

# KEY_ENTER
KEY_ENTER = 28


class BarcodeReader:
    """Чтение штрихкодов с USB HID-сканера через evdev."""

    def __init__(self, device_path=None, device_name_filter=None):
        """
        Args:
            device_path: Явный путь к устройству (напр. /dev/input/event2).
                         Если None — автоопределение.
            device_name_filter: Подстрока для поиска устройства по имени.
                                По умолчанию ищет 'Honeywell'.
        """
        if not EVDEV_AVAILABLE:
            raise ImportError('evdev не установлен. Выполните: pip install evdev')

        self.device_path = device_path
        self.device_name_filter = device_name_filter or 'Honeywell'
        self.device = None
        self._buffer = ''

    def find_device(self):
        """
        Найти сканер среди /dev/input/event* устройств.
        Возвращает путь к устройству или None.
        """
        devices = [InputDevice(path) for path in list_devices()]
        for dev in devices:
            name_lower = dev.name.lower()
            filter_lower = self.device_name_filter.lower()
            if filter_lower in name_lower:
                print(f'[Barcode] Found scanner: {dev.name} at {dev.path}')
                return dev.path
            # Fallback — ищем типичные имена HID-сканеров
            if any(keyword in name_lower for keyword in ['barcode', 'scanner', 'voyager']):
                print(f'[Barcode] Found scanner (fallback): {dev.name} at {dev.path}')
                return dev.path
        return None

    def connect(self):
        """Подключиться к сканеру."""
        path = self.device_path or self.find_device()
        if not path:
            raise FileNotFoundError(
                f'Barcode scanner not found (filter: "{self.device_name_filter}"). '
                f'Check USB connection and /dev/input/ permissions.'
            )

        self.device = InputDevice(path)
        self.device_path = path

        # Захватить устройство — только наш процесс получает input
        try:
            self.device.grab()
        except OSError as e:
            print(f'[Barcode] Warning: could not grab device: {e}')
            # Продолжаем без grab — будет работать, но input может уходить и в другие процессы

        self._buffer = ''
        print(f'[Barcode] Connected: {self.device.name} ({self.device.path})')

    def is_connected(self):
        """Проверить, подключён ли сканер."""
        if self.device is None:
            return False
        try:
            # Проверяем что файл дескриптор ещё валиден
            self.device.path  # noqa
            return self.device.fd >= 0
        except (OSError, AttributeError):
            return False

    def read_barcode(self, timeout=None):
        """
        Прочитать один штрихкод (блокирующий вызов).

        Ждёт пока сканер отсканирует код (накапливает символы до Enter).
        Возвращает строку штрихкода или None если timeout истёк.

        Args:
            timeout: Максимальное время ожидания в секундах.
                     None = ждать бесконечно.
        """
        if not self.is_connected():
            return None

        start_time = time.time()

        try:
            for event in self.device.read_loop():
                # Проверить timeout
                if timeout is not None:
                    elapsed = time.time() - start_time
                    if elapsed >= timeout:
                        # Timeout — сбросить буфер и вернуть None
                        self._buffer = ''
                        return None

                # Обрабатываем только нажатия клавиш (не отпускания и не удержания)
                if event.type != ecodes.EV_KEY or event.value != 1:
                    continue

                if event.code == KEY_ENTER:
                    # Enter = конец штрихкода
                    barcode = self._buffer.strip()
                    self._buffer = ''
                    if barcode:
                        return barcode
                else:
                    # Добавить символ в буфер
                    char = KEY_MAP.get(event.code)
                    if char:
                        self._buffer += char

        except (OSError, IOError) as e:
            print(f'[Barcode] Read error: {e}')
            self._buffer = ''
            return None

    def close(self):
        """Закрыть соединение со сканером."""
        if self.device:
            try:
                self.device.ungrab()
            except (OSError, IOError):
                pass
            try:
                self.device.close()
            except (OSError, IOError):
                pass
            self.device = None
            self._buffer = ''

    def reconnect(self, max_retries=5, delay=3):
        """Попытаться переподключиться к сканеру."""
        self.close()
        # Сбросить путь для повторного автоопределения
        saved_path = self.device_path
        for attempt in range(1, max_retries + 1):
            try:
                print(f'[Barcode] Reconnecting (attempt {attempt}/{max_retries})...')
                # Сначала попробовать тот же путь, потом автоопределение
                if attempt <= 2 and saved_path:
                    self.device_path = saved_path
                else:
                    self.device_path = None
                self.connect()
                return True
            except (FileNotFoundError, OSError, IOError) as e:
                print(f'[Barcode] Reconnect failed: {e}')
                time.sleep(delay)
        return False
