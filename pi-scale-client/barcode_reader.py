"""
Модуль чтения USB-сканера штрихкодов через evdev (Linux HID input).

Поддерживаемые сканеры: Honeywell Voyager XP 1470 и аналогичные HID-сканеры.
Сканер работает как USB-клавиатура — при скане "набирает" штрихкод и жмёт Enter.

На headless Raspberry Pi (без X11) читаем напрямую из /dev/input/eventX
через библиотеку evdev. БЕЗ grab() — на headless Pi нет конфликтов
с другими процессами, а grab может блокировать получение событий.

Требования:
  - pip install evdev
  - Пользователь должен быть в группе 'input': sudo usermod -a -G input stepan
"""

import time
import select

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

# Коды клавиш-терминаторов (Enter) — разные сканеры используют разные
KEY_ENTER = 28        # KEY_ENTER (основная клавиатура)
KEY_KPENTER = 96      # KEY_KPENTER (numpad Enter)
ENTER_CODES = {KEY_ENTER, KEY_KPENTER}

# Таймаут паузы между символами — если буфер не пуст и нет новых символов
# дольше этого времени, считаем скан завершённым (для сканеров без Enter)
SCAN_GAP_TIMEOUT = 0.3  # секунды


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
        Фильтрует по EV_KEY capabilities (цифры + Enter), чтобы выбрать
        правильный интерфейс (Honeywell создаёт несколько event-устройств).
        Возвращает путь к устройству или None.
        """
        devices = [InputDevice(path) for path in list_devices()]
        filter_lower = self.device_name_filter.lower()
        candidates = []

        for dev in devices:
            name_lower = dev.name.lower()
            if filter_lower not in name_lower and not any(
                kw in name_lower for kw in ['barcode', 'scanner', 'voyager']
            ):
                continue

            # Проверить что устройство имеет нужные EV_KEY capabilities
            caps = dev.capabilities(verbose=False)
            ev_key_caps = caps.get(ecodes.EV_KEY, [])
            # Нужны цифровые клавиши (KEY_1=2..KEY_0=11)
            has_digit_keys = any(k in ev_key_caps for k in range(2, 12))

            if has_digit_keys:
                print(f'[Barcode] Found scanner: {dev.name} at {dev.path} (has KEY events)')
                candidates.append(dev.path)
            else:
                print(f'[Barcode] Skipping {dev.name} at {dev.path} (no digit KEY events)')

        return candidates[0] if candidates else None

    def connect(self):
        """Подключиться к сканеру (без grab — headless Pi не требует)."""
        path = self.device_path or self.find_device()
        if not path:
            raise FileNotFoundError(
                f'Barcode scanner not found (filter: "{self.device_name_filter}"). '
                f'Check USB connection and /dev/input/ permissions.'
            )

        self.device = InputDevice(path)
        self.device_path = path

        # НЕ используем grab() — на headless Pi без X11 grab конфликтует
        # с kbd handler ядра и блокирует получение событий

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
        Прочитать один штрихкод (блокирующий вызов с корректным timeout).

        Использует select() для неблокирующего ожидания событий.
        Поддерживает два способа завершения скана:
          1. Enter (KEY_ENTER или KEY_KPENTER) — стандартный
          2. Gap timeout — если буфер не пуст и нет новых символов >300мс

        Args:
            timeout: Максимальное время ожидания в секундах.
                     None = ждать бесконечно.
        """
        if not self.is_connected():
            return None

        start_time = time.time()
        last_char_time = None  # время последнего принятого символа

        try:
            while True:
                # Проверить общий timeout
                if timeout is not None:
                    remaining = timeout - (time.time() - start_time)
                    if remaining <= 0:
                        # Timeout — если в буфере есть данные, вернуть их
                        if self._buffer.strip():
                            barcode = self._buffer.strip()
                            self._buffer = ''
                            print(f'[Barcode] Completed by timeout (buffer had data)')
                            return barcode
                        self._buffer = ''
                        return None

                # Определить timeout для select
                if self._buffer and last_char_time is not None:
                    # Буфер не пуст — ждём gap timeout (завершение скана без Enter)
                    gap_remaining = SCAN_GAP_TIMEOUT - (time.time() - last_char_time)
                    if gap_remaining <= 0:
                        # Gap timeout — скан завершён
                        barcode = self._buffer.strip()
                        self._buffer = ''
                        if barcode:
                            print(f'[Barcode] Completed by gap timeout')
                            return barcode
                        continue
                    select_timeout = min(gap_remaining, 0.1)
                elif timeout is not None:
                    select_timeout = min(timeout - (time.time() - start_time), 1.0)
                else:
                    select_timeout = 5.0

                if select_timeout <= 0:
                    continue

                r, _, _ = select.select([self.device.fd], [], [], select_timeout)
                if not r:
                    # Нет данных — проверить gap timeout
                    if self._buffer and last_char_time is not None:
                        if (time.time() - last_char_time) >= SCAN_GAP_TIMEOUT:
                            barcode = self._buffer.strip()
                            self._buffer = ''
                            if barcode:
                                print(f'[Barcode] Completed by gap timeout')
                                return barcode
                    continue

                # Есть данные — читаем все доступные события
                for event in self.device.read():
                    # Обрабатываем только нажатия клавиш (не отпускания и не удержания)
                    if event.type != ecodes.EV_KEY or event.value != 1:
                        continue

                    if event.code in ENTER_CODES:
                        # Enter = конец штрихкода
                        barcode = self._buffer.strip()
                        self._buffer = ''
                        if barcode:
                            print(f'[Barcode] Completed by Enter (code={event.code})')
                            return barcode
                    else:
                        # Добавить символ в буфер
                        char = KEY_MAP.get(event.code)
                        if char:
                            self._buffer += char
                            last_char_time = time.time()
                            print(f'[Barcode] KEY {event.code} → {char}')
                        else:
                            print(f'[Barcode] Unknown KEY code: {event.code}')

        except (OSError, IOError) as e:
            print(f'[Barcode] Read error: {e}')
            self._buffer = ''
            return None

    def close(self):
        """Закрыть соединение со сканером."""
        if self.device:
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
