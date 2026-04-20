# ClodV4 Backup Agent

Маленький Node.js-процесс на твоём ноуте. Слушает команду «запустить бэкап»
от портала через Socket.io и спавнит соответствующий
`../scripts/backup-*.ps1` скрипт.

Нужен только для **кнопки «Run Backup Now» в UI**. Расписание Task Scheduler
работает и без агента — те скрипты сами репортят результат в Railway.

## Установка (один раз)

Требуется Node.js 18+.

```powershell
cd backup-agent
npm install
Copy-Item .env.example .env
# открой .env и впиши BACKUP_API_KEY — тот же что в Railway Variables
.\install.ps1
```

Готово — агент зарегистрирован в Task Scheduler, автостартует при логине в Windows.

**Запустить прямо сейчас (без ребута):**
```powershell
Start-ScheduledTask -TaskName ClodV4-Backup-Agent
```

**Проверить статус в портале:** зайти на `/backups`, индикатор «Agent: 🟢 online» должен загореться.

## Как это работает

1. Агент стартует → `socket.io-client` подключается к `SERVER_URL` c
   `deviceType: 'backup'` + `apiKey: BACKUP_API_KEY`.
2. Сервер проверяет ключ, сохраняет socket в `io.backupAgent`, эмитит всем
   браузерам `backup:agent-status {online: true}` → в UI кнопки становятся активными.
3. Админ в UI жмёт «Run Weekly Now» → POST `/api/backups/run` → сервер создаёт
   запись `BackupLog(status=pending)` и эмитит агенту `backup:request`.
4. Агент спавнит `powershell -File scripts/backup-weekly.ps1 -BackupLogId <id>`.
5. Скрипт завершился — сам POSTит `/api/backups/report` со статусом и деталями.
6. Сервер обновил запись → эмитит `backup:updated` всем браузерам → таблица
   обновляется в реалтайме.

## Отладка

```powershell
# посмотреть что делает агент
Get-ScheduledTask -TaskName ClodV4-Backup-Agent

# запустить в консоли напрямую (не через Task Scheduler)
node index.js

# логи Task Scheduler через Event Viewer (поиск по 'ClodV4-Backup-Agent')
```

## Снять

```powershell
.\uninstall.ps1
```

## Безопасность

`BACKUP_API_KEY` даёт право создавать записи `BackupLog` и получать события
`backup:request`. Храни ключ только в `.env` (в `.gitignore`), не коммить.
Если ключ утёк — смени на Railway, в `server/.env` локально и здесь.
