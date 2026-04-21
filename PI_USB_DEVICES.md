# Pi USB-устройства и конфигурация serial-портов

Критично: **никогда не использовать `/dev/ttyUSB0`, `/dev/ttyUSB1` и т.п. в конфигах
сервисов.** Порядок перечисления USB-устройств в `/dev/ttyUSBN` **зависит от
порядка инициализации при загрузке** и меняется между ребутами. Всегда использовать
стабильные пути `/dev/serial/by-id/*` — они привязаны к железу (vendor+product+serial
USB-дескриптора).

## Хардверная карта main Pi (`stepan@100.95.73.8`)

| Железо | Чип | Стабильный путь `/dev/serial/by-id/` |
|--------|-----|---------------------------------------|
| **Sonoff ZBDongle-P** (Zigbee coordinator, CC2652P) | Silicon Labs CP2102 | `usb-Silicon_Labs_CP2102_USB_to_UART_Bridge_Controller_0001-if00-port0` |
| **Ohaus R31P3** (весы, RS-232 → USB) | Prolific PL2303 | `usb-Prolific_Technology_Inc._USB-Serial_Controller_DICGg146B12-if00-port0` |
| **Honeywell Voyager XP 1470g** (barcode scanner) | USB HID | (не serial; через evdev на `/dev/input/event*`) |

Посмотреть текущую карту:
```bash
ls -la /dev/serial/by-id/
lsusb
```

## Правильные конфиги

### zigbee2mqtt (`/opt/zigbee2mqtt/data/configuration.yaml`)

```yaml
serial:
  port: /dev/serial/by-id/usb-Silicon_Labs_CP2102_USB_to_UART_Bridge_Controller_0001-if00-port0
  adapter: zstack
  baudrate: 115200
```

- `adapter: zstack` — для ZBDongle-P (CC2652P). Для ZBDongle-E (EFR32MG21) было бы `ezsp`.
- `baudrate: 115200` — стандартно для обоих моделей.

### scale-client (`/home/stepan/pi-scale-client/.env`)

```
SERIAL_PORT=/dev/serial/by-id/usb-Prolific_Technology_Inc._USB-Serial_Controller_DICGg146B12-if00-port0
BAUD_RATE=9600
```

Ohaus R31P3 говорит на 9600 baud.

### barcode scanner

evdev-based, автопоиск в `pi-scale-client/barcode_reader.py` по имени устройства
(`Honeywell 1470g`). Не требует конфигурации serial-порта.

---

## Troubleshooting: Sonoff или весы перестали работать

Симптомы:
- **Sonoff (Zigbee2MQTT)**: `zigbee2mqtt.service` в crash loop; в логе
  `SRSP - SYS - ping after 6000ms` → адаптер не отвечает.
- **Весы (scale-client)**: `Serial read error: [Errno 5] Input/output error`
  каждую секунду.

Обычная причина: сервис смотрит в `/dev/ttyUSBN`, которого сейчас нет или на
котором теперь другое устройство (после ребута Pi, переподключения USB,
или добавления/удаления USB-устройств).

### Диагностика (30 секунд)

```bash
ssh stepan@100.95.73.8

# 1. Что реально подключено:
ls -la /dev/serial/by-id/
lsusb

# 2. Статус сервисов:
systemctl is-active zigbee2mqtt scale-client

# 3. Логи:
sudo journalctl -u zigbee2mqtt -n 30 --no-pager
sudo journalctl -u scale-client -n 20 --no-pager
```

Если видишь в логах путь `/dev/ttyUSB0` (или другой нестабильный) — это баг
конфигурации, он может случайно совпасть при одной загрузке и не совпасть при
следующей.

### Фикс (проверено: апрель 2026)

```bash
ssh stepan@100.95.73.8

# 1. Backup конфигов
sudo cp /opt/zigbee2mqtt/data/configuration.yaml /opt/zigbee2mqtt/data/configuration.yaml.bak
cp /home/stepan/pi-scale-client/.env /home/stepan/pi-scale-client/.env.bak

# 2. Узнать актуальные by-id пути
ls -la /dev/serial/by-id/

# 3. zigbee2mqtt — указать путь до Silicon_Labs (Sonoff)
SONOFF='/dev/serial/by-id/usb-Silicon_Labs_CP2102_USB_to_UART_Bridge_Controller_0001-if00-port0'
sudo sed -i "s|^\(\s*port:\s*\).*|\1$SONOFF|" /opt/zigbee2mqtt/data/configuration.yaml
sudo grep -A3 '^serial:' /opt/zigbee2mqtt/data/configuration.yaml

# 4. scale-client — указать путь до Prolific (весы)
SCALE='/dev/serial/by-id/usb-Prolific_Technology_Inc._USB-Serial_Controller_DICGg146B12-if00-port0'
sed -i "s|^SERIAL_PORT=.*|SERIAL_PORT=$SCALE|" /home/stepan/pi-scale-client/.env
grep '^SERIAL_PORT=' /home/stepan/pi-scale-client/.env

# 5. Рестарт
sudo systemctl restart zigbee2mqtt scale-client
sleep 10
sudo journalctl -u zigbee2mqtt -n 20 --no-pager | tail
sudo journalctl -u scale-client -n 10 --no-pager | tail
```

**Ожидаемый OK-вывод:**

Zigbee2MQTT:
```
z2m: Coordinator firmware version: '...ZStack3x0...'
z2m: Currently N devices are joined.
z2m: Connected to MQTT server
z2m: Zigbee2MQTT started!
```

scale-client:
```
[OK] Continuous print (CP) enabled + IP polling for unstable readings
[OK] Connected to server: https://clodv4-production.up.railway.app/
[Scale] Status sent: connected=True
[Barcode] Connected: Honeywell 1470g (/dev/input/event0)
```

### Откат если что-то пошло не так

```bash
sudo cp /opt/zigbee2mqtt/data/configuration.yaml.bak /opt/zigbee2mqtt/data/configuration.yaml
cp /home/stepan/pi-scale-client/.env.bak /home/stepan/pi-scale-client/.env
sudo systemctl restart zigbee2mqtt scale-client
```

---

## Добавление нового USB-устройства

Если когда-нибудь поменяешь Sonoff dongle (например, на ZBDongle-E) или заменишь
USB→RS-232 адаптер весов:

1. Воткни новое устройство, переподключи
2. `ls -la /dev/serial/by-id/` — найди новый стабильный путь
3. Подставь его в соответствующий конфиг (`configuration.yaml` или `.env`)
4. `sudo systemctl restart <service>`

Если у нового устройства by-id **совпадает** со старым (один и тот же чип,
одинаковый serial в дескрипторе — редко) — вообще ничего менять не надо.

---

## Почему не работает `/dev/ttyUSB0` как путь в конфиге

Linux присваивает `ttyUSBN` **в порядке enumeration при загрузке**. На этом
Pi сейчас:
- при текущем boot: Sonoff → ttyUSB1, Ohaus → ttyUSB2 (ttyUSB0 отсутствует!)
- при другом boot порядок может быть: Sonoff → ttyUSB0, Ohaus → ttyUSB1
- или: Ohaus → ttyUSB0, Sonoff → ttyUSB1

Сервисы которые хардкодят `/dev/ttyUSB0` работают только пока везёт. После
любого ребута, переподключения hub'а или добавления нового USB — ломаются.

`/dev/serial/by-id/` создаётся udev'ом из USB-дескриптора (Vendor, Product,
Serial Number) и не зависит от порядка enumeration.

---

## Связанные файлы

- [CLAUDE.md](CLAUDE.md) — общая Pi конфигурация
- [BACKUP_README.md](BACKUP_README.md) — бэкап скриптов на ноуте (не связано, но рядом)
- `pi-scale-client/.env.example` — шаблон конфигурации
- `/opt/zigbee2mqtt/data/configuration.yaml` — конфиг Zigbee2MQTT (не в git)
