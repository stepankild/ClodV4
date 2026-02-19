"""
Модуль чтения данных с USB-весов Ohaus Ranger 3000 (R31P3) через serial port.

Протокол Ohaus RS232:
  Формат строки:  "   123.4 g  *     G\r\n"
  Поля (разделены пробелами):
    - Вес (right-justified число)
    - Единица измерения (g, kg, lb, oz)
    - Стабильность: * = стабильно, ? = нестабильно
    - Тип: G = gross, NET = нетто, T = tare

  Режим Auto Print: весы отправляют строку при стабилизации веса.
  Команда "CP" включает continuous print (постоянная отправка).

  Настройки serial: 9600 baud, 8N1 (8 data bits, no parity, 1 stop bit).
"""

import serial
import re
import time


class ScaleReader:
    def __init__(self, port='/dev/ttyUSB0', baudrate=9600, timeout=0.1):
        self.port = port
        self.baudrate = baudrate
        self.timeout = timeout
        self.serial_conn = None

    def connect(self):
        """Открыть serial-соединение с весами."""
        self.serial_conn = serial.Serial(
            port=self.port,
            baudrate=self.baudrate,
            timeout=self.timeout,
            bytesize=serial.EIGHTBITS,
            parity=serial.PARITY_NONE,
            stopbits=serial.STOPBITS_ONE
        )
        # Очистить буфер
        self.serial_conn.reset_input_buffer()

    def is_connected(self):
        """Проверить, открыт ли serial порт."""
        return self.serial_conn is not None and self.serial_conn.is_open

    def send_command(self, command):
        """
        Отправить команду весам.
        Полезные команды Ohaus:
          CP   — continuous print (постоянная отправка веса)
          IP   — immediate print (одноразовое чтение)
          SP   — print on stability (отправка при стабилизации)
          Z    — обнулить весы (zero)
          T    — тарировать
        """
        if self.is_connected():
            self.serial_conn.write(f'{command}\r\n'.encode('ascii'))

    def enable_continuous_print(self):
        """Включить непрерывную отправку веса (команда CP)."""
        self.send_command('CP')

    def read_weight(self):
        """
        Прочитать одну строку с весов и распарсить.
        Возвращает (weight, unit, stable) или None если данных нет.
        """
        if not self.is_connected():
            return None

        try:
            # Сбросить накопившиеся старые данные — читать только свежее
            if self.serial_conn.in_waiting > 100:
                self.serial_conn.reset_input_buffer()

            line = self.serial_conn.readline().decode('ascii', errors='ignore').strip()
            if not line:
                return None
            return self.parse_line(line)
        except (serial.SerialException, OSError) as e:
            print(f'Serial read error: {e}')
            return None

    def parse_line(self, line):
        """
        Разобрать строку от весов Ohaus Ranger 3000.

        Формат:  "   123.4 g  *     G"
        Или:     "   123.4 g  ?     G"  (нестабильно)
        Или:     "   123.4 g  *   NET"  (нетто после тары)
        Или:     "      OL"             (перегрузка)

        Также поддерживает другие распространённые форматы на случай
        если весы настроены по-другому.
        """
        # Перегрузка
        if 'OL' in line.upper() and not re.search(r'\d', line):
            return None

        # Ohaus Ranger 3000: стабильность обозначается * или ?
        if '*' in line:
            stable = True
        elif '?' in line:
            stable = False
        else:
            # Fallback для других форматов (ST/US маркеры)
            upper = line.upper()
            if 'US' in upper:
                stable = False
            elif 'ST' in upper:
                stable = True
            else:
                # Нет маркера — считаем стабильным (Auto Print шлёт только стабильные)
                stable = True

        # Найти число и единицу измерения
        match = re.search(r'([+-]?\s*[\d.]+)\s*(g|kg|lb|oz)', line, re.IGNORECASE)
        if match:
            weight_str = match.group(1).replace(' ', '')
            try:
                weight = float(weight_str)
            except ValueError:
                return None
            unit = match.group(2).lower()
            return (weight, unit, stable)

        # Попробовать найти просто число (без единицы — предполагаем граммы)
        match_num = re.search(r'([+-]?\s*[\d.]+)', line)
        if match_num:
            weight_str = match_num.group(1).replace(' ', '')
            try:
                weight = float(weight_str)
            except ValueError:
                return None
            return (weight, 'g', stable)

        return None

    def close(self):
        """Закрыть serial-соединение."""
        if self.serial_conn and self.serial_conn.is_open:
            try:
                self.serial_conn.close()
            except Exception:
                pass
            self.serial_conn = None

    def reconnect(self, max_retries=5, delay=2):
        """Попытаться переподключиться к serial порту."""
        self.close()
        for attempt in range(1, max_retries + 1):
            try:
                print(f'Reconnecting to {self.port} (attempt {attempt}/{max_retries})...')
                self.connect()
                print(f'Reconnected to {self.port}')
                return True
            except (serial.SerialException, OSError) as e:
                print(f'Reconnect failed: {e}')
                time.sleep(delay)
        return False
