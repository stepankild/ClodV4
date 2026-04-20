# uninstall-scheduled-tasks.ps1 — снимает задачи планировщика
# (например, перед переустановкой или если больше не нужны).

[CmdletBinding()]
param(
    [string[]]$TaskNames = @('ClodV4-Weekly-Backup', 'ClodV4-Monthly-Backup')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

foreach ($name in $TaskNames) {
    $task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
    if ($task) {
        Unregister-ScheduledTask -TaskName $name -Confirm:$false
        Write-Host "Removed: $name" -ForegroundColor Yellow
    } else {
        Write-Host "Not found: $name (already gone)" -ForegroundColor DarkGray
    }
}
