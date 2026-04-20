[CmdletBinding()]
param([string]$TaskName = 'ClodV4-Backup-Agent')

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $task) {
    Write-Host "No task '$TaskName' found, nothing to remove." -ForegroundColor DarkGray
    exit 0
}

# Остановить running-инстанс если есть
try { Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue } catch {}

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
Write-Host "Removed: $TaskName" -ForegroundColor Yellow

# Kill running node.exe из backup-agent, на всякий случай
$procs = Get-Process -Name node -ErrorAction SilentlyContinue
foreach ($p in $procs) {
    try {
        if ($p.Path -and ($p.Path -like '*backup-agent*')) {
            Write-Host ("Killing node.exe PID {0}" -f $p.Id) -ForegroundColor DarkGray
            Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
        }
    } catch {}
}
