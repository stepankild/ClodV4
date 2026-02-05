# MongoDB dump for ClodV4 (optional). Run from project root.
# Requires: mongodump in PATH (install MongoDB Database Tools or use Atlas Backup).
# Reads MONGODB_URI from server\.env. Writes dump to ../ClodV4-db-dump-YYYY-MM-DD_HH-mm
$ProjectRoot = $PSScriptRoot
$envFile = Join-Path $ProjectRoot "server\.env"
if (-not (Test-Path $envFile)) {
  Write-Host "server\.env not found. Create it from .env.example and set MONGODB_URI."
  exit 1
}
$uri = $null
Get-Content $envFile | ForEach-Object {
  if ($_ -match '^\s*MONGODB_URI\s*=\s*(.+)$') { $uri = $matches[1].Trim().Trim('"').Trim("'") }
}
if (-not $uri) {
  Write-Host "MONGODB_URI not set in server\.env"
  exit 1
}
$Date = Get-Date -Format "yyyy-MM-dd_HH-mm"
$ParentDir = Split-Path -Parent $ProjectRoot
$DumpDir = Join-Path $ParentDir "ClodV4-db-dump-$Date"
Write-Host "MongoDB dump to: $DumpDir"
$exists = Get-Command mongodump -ErrorAction SilentlyContinue
if (-not $exists) {
  Write-Host "mongodump not in PATH. Install MongoDB Database Tools or use Atlas continuous backup."
  exit 1
}
& mongodump --uri="$uri" --out="$DumpDir"
if ($LASTEXITCODE -eq 0) { Write-Host "DB dump done." } else { Write-Host "mongodump exit code: $LASTEXITCODE"; exit $LASTEXITCODE }
