# Backup ClodV4: code + config (excludes node_modules, .git)
# For full safety also run backup-db.ps1 to dump MongoDB (or use Atlas backups).
$ProjectRoot = $PSScriptRoot
$Date = Get-Date -Format "yyyy-MM-dd_HH-mm"
$BackupName = "ClodV4-backup-$Date"
$ParentDir = Split-Path -Parent $ProjectRoot
$BackupPath = Join-Path $ParentDir $BackupName

Write-Host "Backup to: $BackupPath"
New-Item -ItemType Directory -Path $BackupPath -Force | Out-Null
robocopy $ProjectRoot $BackupPath /E /XD node_modules .git /NFL /NDL /NJH /NJS /NC /NS /NP
if ($LASTEXITCODE -le 7) { Write-Host "Files: Done." } else { Write-Host "Files exit code: $LASTEXITCODE" }

# Copy server .env into backup so restore has config (secrets stay in backup)
$envSrc = Join-Path $ProjectRoot "server\.env"
$envDst = Join-Path $BackupPath "server\.env"
if (Test-Path $envSrc) {
  New-Item -ItemType Directory -Path (Split-Path $envDst) -Force | Out-Null
  Copy-Item -Path $envSrc -Destination $envDst -Force
  Write-Host "Config: server\.env copied into backup."
} else {
  Write-Host "Config: server\.env not found (optional)."
}

Write-Host ""
Write-Host "Restore: npm install in client/ and server/. DB: use backup-db.ps1 or Atlas."
Write-Host "Full policy: see DATA_SAFETY.md"
