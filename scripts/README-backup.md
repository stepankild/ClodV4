# Автоматический бэкап True Source

Система автоматических бэкапов портала. Два расписания:

- **Weekly** — каждое воскресенье в 03:00. Код + `server\.env` + дамп MongoDB.
- **Monthly** — 1-го числа в 03:30. Всё из weekly плюс живые файлы с Pi
  (`pi-scale-client`, `iot-sensor-client`), Home Assistant config, systemd units.

Результат: один `.zip` на бэкап в `C:\Backups\ClodV4\weekly\` или `\monthly\`.
Ротация: хранится 4 недельных и 3 месячных, старые удаляются автоматически.

Пользователь сам периодически переносит архивы на **флешку или внешний диск** —
на случай кражи/пожара ноутбука. `C:\Backups\` на том же компьютере не спасает от
этого сценария.

---

## Интеграция с порталом

Скрипты при завершении отправляют отчёт в Railway (`POST /api/backups/report`) —
их видно в портале на странице `/backups` (раздел «Бэкапы» в sidebar для админа).
Также там есть кнопка «Запустить сейчас», которую обслуживает `backup-agent/`
(отдельный Node.js-процесс на ноуте). Настройка — см. §1.6 ниже и
[backup-agent/README.md](../backup-agent/README.md).

---

## 1. Установка (один раз)

### 1.1 Установить MongoDB Database Tools

Нужен для `mongodump`. Самый простой способ:

```powershell
winget install MongoDB.DatabaseTools
```

Альтернативы:
- Chocolatey: `choco install mongodb-database-tools`
- MSI с https://www.mongodb.com/try/download/database-tools

Проверка: в новом PowerShell `mongodump --version` должен напечатать версию.

### 1.2 Настроить SSH-ключи к Pi и Pi Zero (для monthly)

Monthly-скрипт ходит по SSH без пароля. Если ещё не настроено:

```powershell
# Сгенерировать ключ (один раз)
ssh-keygen -t ed25519 -C "clodv4-backup"

# Положить публичный ключ на Pi
type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh stepan@100.95.73.8 "cat >> ~/.ssh/authorized_keys"
type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh pi@100.104.214.7    "cat >> ~/.ssh/authorized_keys"
```

Проверка: `ssh stepan@100.95.73.8 whoami` и `ssh pi@100.104.214.7 whoami` — должны
ответить без запроса пароля.

> Без этого monthly не упадёт целиком, но соответствующие разделы пропустит и
> запишет WARN в лог.

### 1.3 (только ферма с Gigacube/LTE) UDP-блок для Tailscale

Если main Pi подключен через Gigacube (Vodafone LTE-роутер) или другой мобильный
uplink, мобильный оператор может **троттлить UDP** (на котором работает
Tailscale direct P2P) до ~0.2 Mbit/s. Решение — заставить Tailscale использовать
DERP-relay (TCP 443), блокируя UDP 41641 на Pi.

**Уже применено на main Pi** (`stepan@100.95.73.8`) в апреле 2026:

```bash
# На Pi:
sudo iptables  -I OUTPUT -p udp --dport 41641 -j DROP
sudo ip6tables -I OUTPUT -p udp --dport 41641 -j DROP
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y iptables-persistent
sudo netfilter-persistent save
```

Правила лежат в `/etc/iptables/rules.v4` и `rules.v6`, переживают ребут.
Проверка: `tailscale status` должен показывать `active; relay "nue"` (или другой
DERP-сервер), а **не** `active; direct`.

Если в будущем перенесёшь ферму на проводной интернет — эти правила можно убрать:

```bash
sudo iptables  -D OUTPUT -p udp --dport 41641 -j DROP
sudo ip6tables -D OUTPUT -p udp --dport 41641 -j DROP
sudo netfilter-persistent save
```

Это ускорит обычные операции (direct ~100 Mbit/s vs DERP ~6 Mbit/s), но на
Gigacube лучше оставить как есть.

### 1.4 Включить выполнение скриптов

Если PowerShell ругается на запуск `.ps1`:

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

Сам планировщик запускает с `-ExecutionPolicy Bypass`, так что это нужно только
для ручных запусков.

### 1.5 Задать `BACKUP_API_KEY` (для интеграции с порталом)

Общий секрет, которым скрипты авторизуются при отправке отчёта в Railway и
которым агент подключается по Socket.io. Ставится в **трёх местах одинаково**:

| Место | Переменная |
|-------|-----------|
| Railway → Project → Variables | `BACKUP_API_KEY=<случайная строка 32+ символов>` |
| `server\.env` локально | `BACKUP_API_KEY=<та же>`, `SERVER_URL=https://clodv4-production.up.railway.app` |
| `backup-agent\.env` | `BACKUP_API_KEY=<та же>`, `SERVER_URL=<тот же>` |

Если `BACKUP_API_KEY` не задан — скрипты просто пропустят отчёт, бэкап сам
по себе не упадёт (WARN в `backup.log`). Но в UI история будет пустая.

### 1.6 (опционально) Установить backup-agent для кнопки «Run now»

Если хочешь запускать бэкапы с кнопки в портале (не только по расписанию):

```powershell
cd backup-agent
npm install
Copy-Item .env.example .env
# открой .env, впиши BACKUP_API_KEY (тот же что в §1.5)
.\install.ps1
```

Подробнее: [backup-agent/README.md](../backup-agent/README.md).

### 1.7 Зарегистрировать задачи в Task Scheduler

```powershell
cd "C:\Users\Stepa\Desktop\Harvest scale\ClodV4"
.\scripts\install-scheduled-tasks.ps1
```

Скрипт создаст две задачи для текущего пользователя. Admin-права не требуются.

Проверить:

```powershell
Get-ScheduledTask -TaskName ClodV4-Weekly-Backup,ClodV4-Monthly-Backup
```

---

## 2. Запуск вручную / тестирование

```powershell
# Dry-run — посмотреть, что будет делать, без записи в C:\Backups
.\scripts\backup-weekly.ps1 -DryRun
.\scripts\backup-monthly.ps1 -DryRun

# Реальный запуск
.\scripts\backup-weekly.ps1
.\scripts\backup-monthly.ps1

# Запуск через планировщик (как он сам будет запускать)
Start-ScheduledTask -TaskName ClodV4-Weekly-Backup

# Логи
Get-Content C:\Backups\ClodV4\logs\backup.log -Tail 50
```

---

## 3. Структура и содержимое

```
C:\Backups\ClodV4\
├── weekly\
│   └── ClodV4-weekly-YYYY-MM-DD_HH-mm.zip
├── monthly\
│   └── ClodV4-monthly-YYYY-MM-DD_HH-mm.zip
├── logs\
│   └── backup.log
└── .lock      (только во время работы; авто-снимается по завершении)
```

**Weekly zip:**
- `code/` — весь проект (без `node_modules`, `.git`, `dist`, `venv`, `__pycache__`, `worktrees`)
- `code/server/.env` — секреты портала (dev)
- `code/server/.env.production` — prod-секреты Railway (если ты его создашь, см. §5)
- `code/pi-scale-client/.env` — если локальная копия есть
- `db-dump/<dbname>/*.bson` — дамп локальной MongoDB (dev)
- `db-dump-prod/<dbname>/*.bson` — дамп **production** Atlas (если есть `.env.production`)
- `MANIFEST.txt` — timestamp, git SHA, ветка, размеры, scrubbed URIs

**Monthly zip** — всё из weekly плюс:
- `pi-scale-client-live/` — живые файлы с Pi (`/home/stepan/pi-scale-client/`)
- `iot-sensor-client-live/` — живые файлы с Pi Zero (`/home/pi/iot-sensor-client/`)
- `homeassistant-config/` — HA config (docker volume)
- `pi-systemd/` — `scale-client.service`, `display-proxy.service`, `sensor-node.service`, `mqtt_bridge.service`
- `mosquitto-config/` — `/etc/mosquitto/` с main Pi (MQTT-брокер)
- `windows-ssh/` — ключи из `%USERPROFILE%\.ssh\` (id_ed25519, config, known_hosts и т.п.)
- `claude-memory/` — файлы из `%USERPROFILE%\.claude\projects\...\memory\` (токены HA, инфра)
- `railway-env/variables.json` — prod-переменные Railway (если CLI установлен и `railway link` сделан)

ESP32-CAM и espink-display исходники попадают в `code/` (они и так в репозитории).

---

## 4. Восстановление

### 4.1 Из weekly zip

1. Распаковать `ClodV4-weekly-*.zip` в нужное место, переименовать `code` в `ClodV4`.
2. Внутри `ClodV4\`:
   ```powershell
   cd server  && npm install
   cd ..\client && npm install
   ```
3. Проверить `server\.env` (есть `MONGODB_URI`, `JWT_SECRET`, `JWT_REFRESH_SECRET`).
4. Восстановить БД:
   ```powershell
   mongorestore --uri="ВАШ_MONGODB_URI" --drop "путь\к\распакованному\db-dump"
   ```
   `--drop` сносит текущие коллекции перед восстановлением. Без него данные
   смешаются с текущими.
5. Запустить:
   ```powershell
   cd server && npm start
   ```

### 4.2 Из monthly zip (после большого сбоя)

Всё то же, что в 4.1, плюс восстановление Pi/HA:

- `pi-scale-client-live/` → `scp -r` обратно на Pi в `/home/stepan/pi-scale-client/`
- `iot-sensor-client-live/` → на Pi Zero в `/home/pi/iot-sensor-client/`
- `homeassistant-config/` → в docker-volume HA, затем `sudo docker restart homeassistant`
- Unit-файлы из `pi-systemd/` → в `/etc/systemd/system/` + `sudo systemctl daemon-reload`

---

## 4.3 Production-БД и Railway env vars

Наш dev-запуск читает `server\.env` (обычно `mongodb://localhost:27017`). Реальная
прод-база — на **MongoDB Atlas**, подключённая из Railway. Автоматически бэкапить её
мы можем двумя способами:

### Вариант A — положить prod-URI в файл (просто)

Создай файл `server\.env.production` рядом с `server\.env` со строкой:

```
MONGODB_URI=mongodb+srv://USER:PASS@cluster.xxxxx.mongodb.net/farm_portal?retryWrites=true&w=majority
```

Weekly и monthly сразу начнут дампить и её тоже → папка `db-dump-prod/` внутри zip.
Этот файл **не коммитится** (`.env*` в `.gitignore`) и попадает только в бэкап.

### Вариант B — Railway CLI (bonus)

Если у тебя стоит Railway CLI (`npm i -g @railway/cli` → `railway login` →
`railway link` в корне проекта), monthly дополнительно вытаскивает **все prod-переменные**
(не только MONGODB_URI) в `railway-env/variables.json`. Это охватывает и
`JWT_SECRET`, `HA_TOKEN`, все `R2_*`, `CLIENT_URL` и т.д. — то что в Railway UI и
больше нигде.

Без CLI monthly положит в бэкап `railway-env/NOT_INSTALLED.txt` с инструкцией.

**Рекомендуется оба варианта**: A — чтобы дамп прод-БД шёл еженедельно; B — чтобы
раз в месяц брать живой снимок всех prod-переменных.

---

## 5. Что в бэкапе и почему это чувствительно

Внутри архивов:

| Файл | Что там |
|------|---------|
| `code/server/.env` | `MONGODB_URI` (dev), `JWT_SECRET`, `JWT_REFRESH_SECRET`, `SCALE_API_KEY` |
| `code/server/.env.production` | `MONGODB_URI` (Atlas prod) — если создан |
| `pi-scale-client-live/.env` | `SCALE_API_KEY` |
| `homeassistant-config/` | Long-Lived Token HA (365 дней), возможно токены Xiaomi |
| `db-dump/` | локальные dev-данные (пароли bcrypt — не plain) |
| `db-dump-prod/` | **живые прод-данные** с Atlas (пользователи, комнаты, логи, урожай) |
| `windows-ssh/id_ed25519` | **приватный SSH-ключ** от Pi и Pi Zero |
| `claude-memory/` | токены HA, пароли Pi Zero, список Railway env vars |
| `railway-env/variables.json` | **ВСЕ prod-секреты Railway** (MONGODB_URI, JWT, R2, HA, ...) |

**`Compress-Archive` не умеет пароль на zip.** Если переносишь на флешку — лучше:
- использовать зашифрованную флешку (BitLocker To Go);
- или вручную перепаковать 7-zip с паролем перед переносом.

Не выкладывать бэкапы в публичное облако.

---

## 6. Troubleshooting

### `weekly backup FAILED: mongodump not in PATH`

→ не выполнен шаг 1.1. После установки MongoDB Database Tools перезапустить
PowerShell (иначе PATH не обновится).

### `scp ... failed` в monthly

- Pi выключен / Tailscale не работает → нормально, monthly соберёт частичный архив.
  Проверить: `ssh stepan@100.95.73.8 whoami` руками.
- SSH-ключ не настроен → см. 1.2.
- `scp` не найден на Windows → Windows 11 идёт с OpenSSH Client по умолчанию.
  Если нет: `Add-WindowsCapability -Online -Name OpenSSH.Client~~~~0.0.1.0`.

### `Backup already in progress`

Лок-файл `C:\Backups\ClodV4\.lock` от упавшего прогона. Если скрипт точно не
работает (проверь Task Scheduler History) — удалить вручную:

```powershell
Remove-Item C:\Backups\ClodV4\.lock
```

Лок старше 6 часов игнорируется автоматически.

### Задача в планировщике в статусе `Disabled`

```powershell
Enable-ScheduledTask -TaskName ClodV4-Weekly-Backup
```

### Переустановить задачи

```powershell
.\scripts\uninstall-scheduled-tasks.ps1
.\scripts\install-scheduled-tasks.ps1
```

---

## 7. MongoDB Atlas как второй слой

Если используется MongoDB Atlas — в его консоли включи **Continuous Backup** или
Scheduled Snapshots. Это параллельный бэкап на стороне облака, который не зависит
от того, включён ли наш компьютер. Наш `mongodump` — резервная копия у тебя на руках.

---

## 8. Что НЕ бэкапится (и это осознанно)

- `node_modules` — воспроизводится `npm install` из `package-lock.json`.
- `client/dist` — собирается `npm run build`.
- `.git/` — история и так в GitHub / Railway.
- `venv/`, `__pycache__/` на Pi — пересоздаются `pip install -r requirements.txt`.
- `sensor_buffer.db` на Pi Zero — буфер офлайн-данных, не ценен после отправки.
- Railway-логи и env-переменные — редактируются в UI Railway, бэкапить их
  автоматически невозможно. Держи список в `server\.env`.
