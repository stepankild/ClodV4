# install-scheduled-tasks.ps1 — регистрирует 2 задачи в Windows Task Scheduler:
#   ClodV4-Weekly-Backup   — каждое воскресенье в 03:00
#   ClodV4-Monthly-Backup  — 1-го числа каждого месяца в 03:30
#
# Используем schtasks.exe для создания (не требует admin-prompt для user-tasks),
# затем донастраиваем через Set-ScheduledTask (StartWhenAvailable, батарея и т.д.).
#
# Запуск: .\scripts\install-scheduled-tasks.ps1
# Повторный запуск переcоздаёт задачи (/F).

[CmdletBinding()]
param(
    [string]$WeeklyTaskName  = 'ClodV4-Weekly-Backup',
    [string]$MonthlyTaskName = 'ClodV4-Monthly-Backup',
    [string]$WeeklyTime      = '03:00',
    [string]$MonthlyTime     = '03:30',
    [string]$WeeklyDay       = 'SUN',       # schtasks: MON..SUN
    [int]$MonthlyDay         = 1
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$weeklyScript  = Resolve-Path (Join-Path $PSScriptRoot 'backup-weekly.ps1')
$monthlyScript = Resolve-Path (Join-Path $PSScriptRoot 'backup-monthly.ps1')

if (-not (Test-Path $weeklyScript))  { throw "Not found: $weeklyScript"  }
if (-not (Test-Path $monthlyScript)) { throw "Not found: $monthlyScript" }

function Register-BackupTask {
    param(
        [string]$Name,
        [string]$ScriptPath,
        [string]$Schedule,    # WEEKLY | MONTHLY
        [string]$Day,         # SUN для WEEKLY, число для MONTHLY
        [string]$Time         # HH:mm
    )

    # Команда, которую запустит планировщик.
    # -NoProfile: быстрее старт, не тащит профиль.
    # -ExecutionPolicy Bypass: чтобы не спотыкаться о Restricted по умолчанию.
    # -File "<полный путь>": сам .ps1.
    $tr = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$ScriptPath`""

    $args = @(
        '/Create',
        '/TN', $Name,
        '/TR', $tr,
        '/SC', $Schedule,
        '/D',  $Day,
        '/ST', $Time,
        '/RL', 'LIMITED',       # обычные права текущего пользователя
        '/F'                    # перезаписать, если уже есть
    )
    Write-Host "schtasks $args" -ForegroundColor DarkGray
    & schtasks.exe @args
    if ($LASTEXITCODE -ne 0) { throw "schtasks failed for $Name (exit $LASTEXITCODE)" }

    # Донастройка через Scheduler PS-модуль:
    #  - StartWhenAvailable = $true — если ноут спал в 3 ночи, задача отработает потом
    #  - AllowStartIfOnBatteries / DontStopIfGoingOnBatteries — не ждать розетки
    #  - ExecutionTimeLimit = 2ч — на случай, если бэкап зависнет
    $task = Get-ScheduledTask -TaskName $Name -ErrorAction Stop
    $task.Settings.StartWhenAvailable      = $true
    $task.Settings.DisallowStartIfOnBatteries = $false
    $task.Settings.StopIfGoingOnBatteries  = $false
    $task.Settings.ExecutionTimeLimit      = 'PT2H'
    $task.Settings.Priority                = 7   # ниже обычного, чтобы не мешать пользователю
    Set-ScheduledTask -InputObject $task | Out-Null

    Write-Host "  Installed: $Name ($Schedule $Day @ $Time)" -ForegroundColor Green
}

Write-Host "Installing ClodV4 backup scheduled tasks..." -ForegroundColor Cyan
Write-Host "  Scripts: $PSScriptRoot"
Write-Host "  Backup dir: C:\Backups\ClodV4"
Write-Host ""

Register-BackupTask -Name $WeeklyTaskName  -ScriptPath $weeklyScript  -Schedule 'WEEKLY'  -Day $WeeklyDay           -Time $WeeklyTime
Register-BackupTask -Name $MonthlyTaskName -ScriptPath $monthlyScript -Schedule 'MONTHLY' -Day "$MonthlyDay"        -Time $MonthlyTime

Write-Host ""
Write-Host "Done. Verify with:" -ForegroundColor Cyan
Write-Host "  Get-ScheduledTask -TaskName $WeeklyTaskName,$MonthlyTaskName"
Write-Host ""
Write-Host "Run once manually to test:" -ForegroundColor Cyan
Write-Host "  Start-ScheduledTask -TaskName $WeeklyTaskName"
Write-Host "  Get-Content 'C:\Backups\ClodV4\logs\backup.log' -Tail 20"
