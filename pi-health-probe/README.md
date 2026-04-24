# Pi Health Probe

Python-демон на main Pi (stepan@100.95.73.8). Раз в 5 минут (+по команде
`probe:run-now` от сервера) собирает health-snapshot критичных компонентов и
шлёт на Railway через Socket.io как `pi:health`. Сервер сохраняет в Mongo
(`systemstatussnapshots`, TTL 7 дней) и broadcast'ит браузерам
(`system:status:update`) — страница `/system-status` в портале обновляется
моментально.

## Что проверяется

- **systemd-юниты**: `scale-client`, `zigbee2mqtt`, `mosquitto`, `display-proxy`,
  `doorbell`, `humidity-ctrl`, `mqtt-bridge`, `timelapse-server`, `docker`
- **Сканер**: найден ли evdev-устройство Honeywell и держит ли его scale-client
  эксклюзивно (через попытку `EVIOCGRAB` → EBUSY означает "правильно grab'нут")
- **Весы**: timestamp последнего `[Scale]`/`[Barcode]` в journalctl scale-client
- **Home Assistant**: docker-state контейнера + HTTP-код ответа `localhost:8123`
- **Tailscale**: direct vs relay, DERP-регион
- **iptables**: активен ли UDP-блок порта 41641 (наш forced-DERP фикс)
- **Pi Zero**: свежесть MQTT-публикаций на `grow/zone/zone-1/sensors`
- **USB**: есть ли Sonoff (Silicon_Labs CP2102) и Ohaus (Prolific) в `/dev/serial/by-id/`
- **OS**: disk %, load 1min, uptime, free memory

Добавить новую проверку — одна функция в `probe.py` + запись в `run_all_checks()`.
На UI она автоматом появится (фронт просто рендерит все ключи из `checks`).

## Установка (однократно, на Pi)

С ноута админа:
```bash
scp -r pi-health-probe/ stepan@100.95.73.8:/home/stepan/
ssh stepan@100.95.73.8 "cd pi-health-probe && sudo ./install.sh"
```

`install.sh`:
1. Создаёт venv и ставит `python-socketio`, `python-dotenv`, `evdev`
2. Берёт `SERVER_URL` + `SCALE_API_KEY` из `/home/stepan/pi-scale-client/.env`
   (reuse — отдельный ключ не нужен), кладёт в `pi-health-probe/.env`
3. Создаёт `/etc/sudoers.d/pi-health-probe` — точечное NOPASSWD для
   `iptables -S OUTPUT` (чтобы демон мог читать правила без root-привилегий всего процесса)
4. Копирует `pi-health-probe.service` в `/etc/systemd/system/`, enable + start
5. Выводит последние 15 строк `journalctl`

## Проверка работы

```bash
ssh stepan@100.95.73.8 "
sudo systemctl status pi-health-probe
journalctl -u pi-health-probe -n 20 --no-pager
"
```

Ожидаемый вывод:
```
[probe] starting — server=https://clodv4-production.up.railway.app host=farm interval=300s
[probe] connected to https://...
[probe] emitted pi:health (post-connect; services 9/9, durationMs=450)
[probe] emitted pi:health (scheduled; services 9/9, durationMs=380)
```

На сервере — через `/api/system-status/latest` (с JWT) или UI `/system-status`
уже будет свежий snapshot.

## Форс-probe из портала

В UI кнопка **Refresh** → POST `/api/system-status/refresh` → сервер эмитит
`probe:run-now` → наш `@sio.on('probe:run-now')` срабатывает → свежий snapshot
уходит за ~1 секунду.

## Обновить probe.py

```bash
scp pi-health-probe/probe.py stepan@100.95.73.8:/home/stepan/pi-health-probe/
ssh stepan@100.95.73.8 "sudo systemctl restart pi-health-probe"
```

## Что делать если…

**В UI «Probe silent >N min» (Telegram-alert пришёл)**
- `ssh stepan@100.95.73.8 "systemctl status pi-health-probe"`
  - Если `failed` — посмотри `journalctl -u pi-health-probe -n 50 --no-pager`
  - Если `inactive` — `sudo systemctl start pi-health-probe`
- Если demон крутится но snapshot'ы не приходят — сеть (tailscale direct/relay)
  или сам Railway упал. Проверь `curl https://clodv4-production.up.railway.app/api/health`.

**«Scanner: no exclusive grab» в UI**
- Значит в scale-client barcode_reader.py не сделал `device.grab()`. См. коммит
  `barcode_reader: grab /dev/input/eventN exclusively`. Достаточно
  `sudo systemctl restart scale-client`.

**«Pi Zero offline» в UI при живой Pi Zero**
- Mosquitto на main Pi упал или Pi Zero не может до него достучаться.
- `ssh pi@100.104.214.7 "sudo journalctl -u sensor-node -n 30 --no-pager"`

## Снять

```bash
ssh stepan@100.95.73.8 "
sudo systemctl stop pi-health-probe
sudo systemctl disable pi-health-probe
sudo rm /etc/systemd/system/pi-health-probe.service
sudo rm /etc/sudoers.d/pi-health-probe
sudo rm -rf /home/stepan/pi-health-probe
sudo systemctl daemon-reload
"
```
