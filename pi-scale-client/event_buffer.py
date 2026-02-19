"""
Offline event buffer for Pi client.

Barcode scans are queued to SQLite (persist across restarts).
Weight readings keep only the latest value in memory.

SQLite используется потому что:
- Атомарные записи (нет коррупции при обрыве питания)
- Встроен в Python stdlib — ноль зависимостей
- WAL mode минимизирует износ SD-карты
"""

import sqlite3
import os
import time
import threading

# DB рядом со скриптом
DEFAULT_DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'buffer.db')
MAX_QUEUE_SIZE = 1000


class BarcodeQueue:
    """Персистентная FIFO-очередь для штрихкодов, бэкенд — SQLite."""

    def __init__(self, db_path=None):
        self.db_path = db_path or DEFAULT_DB_PATH
        self._lock = threading.Lock()
        self._init_db()

    def _init_db(self):
        """Создать таблицу если не существует, включить WAL mode."""
        with self._lock:
            conn = sqlite3.connect(self.db_path)
            conn.execute('PRAGMA journal_mode=WAL')
            conn.execute('''
                CREATE TABLE IF NOT EXISTS barcode_queue (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    barcode TEXT NOT NULL,
                    scanned_at REAL NOT NULL,
                    created_at REAL NOT NULL
                )
            ''')
            # Миграция: добавить колонки веса (если ещё нет)
            cursor = conn.execute('PRAGMA table_info(barcode_queue)')
            columns = {row[1] for row in cursor.fetchall()}
            if 'weight' not in columns:
                conn.execute('ALTER TABLE barcode_queue ADD COLUMN weight REAL')
                conn.execute('ALTER TABLE barcode_queue ADD COLUMN weight_unit TEXT')
                conn.execute('ALTER TABLE barcode_queue ADD COLUMN weight_stable INTEGER')
                print('[Buffer] Migrated barcode_queue: added weight columns')
            conn.commit()
            conn.close()

    def push(self, barcode, weight=None, unit=None, stable=None):
        """Добавить штрихкод (+ вес) в очередь. Возвращает текущий размер очереди."""
        now = time.time()
        with self._lock:
            try:
                conn = sqlite3.connect(self.db_path)
                conn.execute(
                    'INSERT INTO barcode_queue (barcode, scanned_at, created_at, weight, weight_unit, weight_stable) VALUES (?, ?, ?, ?, ?, ?)',
                    (barcode, now, now, weight, unit, 1 if stable else (0 if stable is not None else None))
                )
                # Ограничение размера — удалить старейшие
                count = conn.execute('SELECT COUNT(*) FROM barcode_queue').fetchone()[0]
                if count > MAX_QUEUE_SIZE:
                    excess = count - MAX_QUEUE_SIZE
                    conn.execute('''
                        DELETE FROM barcode_queue WHERE id IN (
                            SELECT id FROM barcode_queue ORDER BY id ASC LIMIT ?
                        )
                    ''', (excess,))
                    print(f'[Buffer] Dropped {excess} oldest barcode(s) — queue full ({MAX_QUEUE_SIZE})')
                conn.commit()
                size = conn.execute('SELECT COUNT(*) FROM barcode_queue').fetchone()[0]
                conn.close()
                return size
            except sqlite3.OperationalError as e:
                if 'disk' in str(e).lower() or 'full' in str(e).lower():
                    print(f'[Buffer] CRITICAL: SD card full, cannot buffer barcode: {barcode}')
                    return -1
                raise

    def peek_all(self):
        """Получить все штрихкоды в порядке FIFO.
        Возвращает [(id, barcode, scanned_at, weight, weight_unit, weight_stable), ...].
        """
        with self._lock:
            conn = sqlite3.connect(self.db_path)
            rows = conn.execute(
                'SELECT id, barcode, scanned_at, weight, weight_unit, weight_stable FROM barcode_queue ORDER BY id ASC'
            ).fetchall()
            conn.close()
            return rows

    def remove(self, row_id):
        """Удалить запись по id (после успешной отправки)."""
        with self._lock:
            conn = sqlite3.connect(self.db_path)
            conn.execute('DELETE FROM barcode_queue WHERE id = ?', (row_id,))
            conn.commit()
            conn.close()

    def remove_batch(self, row_ids):
        """Удалить несколько записей по id."""
        if not row_ids:
            return
        with self._lock:
            conn = sqlite3.connect(self.db_path)
            conn.executemany('DELETE FROM barcode_queue WHERE id = ?', [(rid,) for rid in row_ids])
            conn.commit()
            conn.close()

    def size(self):
        """Текущий размер очереди."""
        with self._lock:
            conn = sqlite3.connect(self.db_path)
            count = conn.execute('SELECT COUNT(*) FROM barcode_queue').fetchone()[0]
            conn.close()
            return count

    def clear(self):
        """Очистить всю очередь."""
        with self._lock:
            conn = sqlite3.connect(self.db_path)
            conn.execute('DELETE FROM barcode_queue')
            conn.commit()
            conn.close()


class LatestWeightBuffer:
    """Thread-safe буфер для последнего показания весов (только в памяти)."""

    def __init__(self):
        self._lock = threading.Lock()
        self._weight = None  # (weight, unit, stable) или None

    def set(self, weight, unit, stable):
        """Записать последнее показание (перезаписывает предыдущее)."""
        with self._lock:
            self._weight = (weight, unit, stable)

    def get_and_clear(self):
        """Атомарно забрать и очистить буфер. Возвращает (weight, unit, stable) или None."""
        with self._lock:
            val = self._weight
            self._weight = None
            return val

    def get(self):
        """Получить текущее значение без очистки."""
        with self._lock:
            return self._weight

    def has_value(self):
        """Есть ли буферизованное значение."""
        with self._lock:
            return self._weight is not None
