# install.ps1 — регистрирует агент как Task Scheduler задачу,
# стартующую при входе текущего пользователя в Windows. Не требует admin.
#
# Перед запуском:
#   1. cd backup-agent
#   2. npm install
#   3. Скопируй .env.example в .env, заполни BACKUP_API_KEY
#   4. .\install.ps1

[CmdletBinding()]
param(
    [string]$TaskName = 'ClodV4-Backup-Agent'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$agentDir = $PSScriptRoot
$entry    = Join-Path $agentDir 'index.js'
$envFile  = Join-Path $agentDir '.env'

if (-not (Test-Path $entry))    { throw "index.js not found at $entry" }
if (-not (Test-Path $envFile))  { throw ".env not found, copy .env.example and fill in" }

# Ищем node в PATH (PS 5.1 не поддерживает ?. null-propagation)
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) { throw "node.js not in PATH, install Node 18+" }
$node = $nodeCmd.Source

Write-Host "Registering scheduled task '$TaskName'" -ForegroundColor Cyan
Write-Host "  node:  $node"
Write-Host "  agent: $entry"

# Команда: node <полный путь к index.js>. Рабочая папка — agentDir,
# чтобы dotenv нашёл .env.
$tr = "`"$node`" `"$entry`""

# Запускаем при логине текущего пользователя. /RL LIMITED — обычные права.
$args = @(
    '/Create',
    '/TN', $TaskName,
    '/TR', $tr,
    '/SC', 'ONLOGON',
    '/RL', 'LIMITED',
    '/F'
)
Write-Host "schtasks $args" -ForegroundColor DarkGray
& schtasks.exe @args
if ($LASTEXITCODE -ne 0) { throw "schtasks failed (exit $LASTEXITCODE)" }

# Настройки: рабочая папка, auto-restart при падении, без timeout.
$task = Get-ScheduledTask -TaskName $TaskName
$task.Actions[0].WorkingDirectory = $agentDir
$task.Settings.StartWhenAvailable = $true
$task.Settings.ExecutionTimeLimit = 'PT0S'        # без ограничения
$task.Settings.RestartInterval    = 'PT1M'        # рестарт через 1 мин
$task.Settings.RestartCount       = 5
$task.Settings.DisallowStartIfOnBatteries = $false
$task.Settings.StopIfGoingOnBatteries     = $false
Set-ScheduledTask -InputObject $task | Out-Null

Write-Host ""
Write-Host "Done. Task '$TaskName' registered." -ForegroundColor Green
Write-Host ""
Write-Host "Запустить сейчас:" -ForegroundColor Cyan
Write-Host "  Start-ScheduledTask -TaskName $TaskName"
Write-Host ""
Write-Host "Проверить статус:"
Write-Host "  Get-ScheduledTask -TaskName $TaskName"
Write-Host ""
Write-Host "Посмотреть логи (stdout агента уходит в Event Viewer через Task Scheduler):"
Write-Host "  Get-WinEvent -FilterHashtable @{LogName='Microsoft-Windows-TaskScheduler/Operational'} | Where-Object { `$_.Properties[0].Value -eq '\\$TaskName' } | Select -First 20"
