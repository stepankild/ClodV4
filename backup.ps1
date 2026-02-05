# Backup ClodV4 (excludes node_modules, .git)
$ProjectRoot = $PSScriptRoot
$Date = Get-Date -Format "yyyy-MM-dd_HH-mm"
$BackupName = "ClodV4-backup-$Date"
$ParentDir = Split-Path -Parent $ProjectRoot
$BackupPath = Join-Path $ParentDir $BackupName

Write-Host "Backup to: $BackupPath"
New-Item -ItemType Directory -Path $BackupPath -Force | Out-Null
robocopy $ProjectRoot $BackupPath /E /XD node_modules .git /NFL /NDL /NJH /NJS /NC /NS /NP
if ($LASTEXITCODE -le 7) { Write-Host "Done." } else { Write-Host "Exit code: $LASTEXITCODE" }
Write-Host "No node_modules in backup. To restore: run npm install in client/ and server/"
