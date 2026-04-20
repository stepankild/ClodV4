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

# schtasks /TR плохо переваривает пути с пробелами + argument, поэтому
# используем PowerShell ScheduledTask API (Register-ScheduledTask).
# Это строит XML с правильным экранированием под капотом.

# Если задача уже есть — снесём и создадим заново (идемпотентно).
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Old task removed" -ForegroundColor DarkGray
}

$action = New-ScheduledTaskAction `
    -Execute $node `
    -Argument ('"{0}"' -f $entry) `
    -WorkingDirectory $agentDir

$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"

$principal = New-ScheduledTaskPrincipal `
    -UserId "$env:USERDOMAIN\$env:USERNAME" `
    -LogonType Interactive `
    -RunLevel Limited

$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -RestartCount 5 `
    -MultipleInstances IgnoreNew

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings | Out-Null

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
