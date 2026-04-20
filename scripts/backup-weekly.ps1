# backup-weekly.ps1 — еженедельный бэкап портала ClodV4.
# Создаёт единый zip: code + server/.env + mongodump → C:\Backups\ClodV4\weekly\
# Ротация: последние 4 zip-а. Логи: C:\Backups\ClodV4\logs\backup.log
#
# Запуск вручную:    .\scripts\backup-weekly.ps1
# Dry-run (без записи в C:\Backups): .\scripts\backup-weekly.ps1 -DryRun
# Планировщик: см. scripts\install-scheduled-tasks.ps1

[CmdletBinding()]
param(
    [switch]$DryRun,
    [int]$KeepCount = 4,
    # Агент передаёт -BackupLogId при ручном запуске из UI, чтобы мы
    # обновляли конкретную запись, а не создавали новую.
    [string]$BackupLogId = $null
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. "$PSScriptRoot\backup-lib.ps1"

$startTime = Get-Date
$stamp     = $startTime.ToString('yyyy-MM-dd_HH-mm')
$type      = 'weekly'
$staging   = Join-Path $env:TEMP "ClodV4-$type-$stamp"
$zipName   = "ClodV4-$type-$stamp.zip"

Initialize-BackupDirs
Write-BackupLog -Message "=== $type backup start === (DryRun=$([bool]$DryRun))"

$projectRoot = Get-ProjectRoot
Write-BackupLog -Message "Project root: $projectRoot"

# Preflight: mongodump
if (-not (Test-MongodumpAvailable)) {
    Write-BackupLog -Level ERROR -Message "mongodump not in PATH. Install: winget install MongoDB.DatabaseTools"
    exit 1
}

# Preflight: server\.env + MONGODB_URI
$envFile = Join-Path $projectRoot 'server\.env'
if (-not (Test-Path $envFile)) {
    Write-BackupLog -Level ERROR -Message "server\.env not found at $envFile"
    exit 1
}
$mongoUri = Get-EnvValue -File $envFile -Key 'MONGODB_URI'
if (-not $mongoUri) {
    Write-BackupLog -Level ERROR -Message "MONGODB_URI not set in server\.env"
    exit 1
}

try {
    Acquire-BackupLock -Owner "weekly-$PID"
} catch {
    Write-BackupLog -Level ERROR -Message $_.Exception.Message
    exit 2
}

$exitCode = 0
try {
    if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
    New-Item -ItemType Directory -Path $staging -Force | Out-Null

    # 1. Code
    $codeDest = Join-Path $staging 'code'
    Write-BackupLog -Message "Copying code -> $codeDest"
    if (-not $DryRun) {
        Copy-ProjectCode -Source $projectRoot -Dest $codeDest
    }
    $codeSizeMB = if ($DryRun) { 0 } else { Get-DirectorySizeMB $codeDest }

    # 2. DB dump (локальная)
    $dumpDest = Join-Path $staging 'db-dump'
    Write-BackupLog -Message "mongodump (local) -> $dumpDest"
    if (-not $DryRun) {
        Invoke-MongoDump -Uri $mongoUri -OutDir $dumpDest | Out-Null
    }
    $dumpSizeMB = if ($DryRun) { 0 } else { Get-DirectorySizeMB $dumpDest }

    # 2b. DB dump (production, если настроено server\.env.production)
    $prodDumpDest = Join-Path $staging 'db-dump-prod'
    $prodInfo = @{ dumped = $false; reason = '(dry-run)' }
    if (-not $DryRun) {
        try {
            $prodInfo = Invoke-OptionalProdDump -ProjectRoot $projectRoot -OutDir $prodDumpDest
            if ($prodInfo.dumped) {
                Write-BackupLog -Message "mongodump (prod) -> $prodDumpDest"
            } else {
                Write-BackupLog -Message "prod dump skipped: $($prodInfo.reason)"
            }
        } catch {
            Write-BackupLog -Level WARN -Message "prod mongodump failed: $($_.Exception.Message)"
            $prodInfo = @{ dumped = $false; reason = "FAILED: $($_.Exception.Message)" }
        }
    }

    # 3. MANIFEST
    $manifestPath = Join-Path $staging 'MANIFEST.txt'
    if (-not $DryRun) {
        $sections = [ordered]@{
            'code'        = "$codeSizeMB MB"
            'db-dump'     = "$dumpSizeMB MB"
            'mongo-uri'   = ($mongoUri -replace '://[^@]+@', '://***:***@')
        }
        if ($prodInfo.dumped) {
            $sections['db-dump-prod'] = "$(Get-DirectorySizeMB $prodDumpDest) MB"
            $sections['mongo-uri-prod'] = $prodInfo.uri
        } else {
            $sections['db-dump-prod'] = "SKIPPED ($($prodInfo.reason))"
        }
        New-BackupManifest -Path $manifestPath -Type $type -ProjectRoot $projectRoot -Sections $sections
    }

    # 4. Zip
    $zipPath = Join-Path $script:WeeklyDir $zipName
    Write-BackupLog -Message "Compressing -> $zipPath"
    if (-not $DryRun) {
        Compress-Backup -StagingDir $staging -ZipPath $zipPath
    }
    $zipSizeMB = if ($DryRun -or -not (Test-Path $zipPath)) { 0 } else { [math]::Round((Get-Item $zipPath).Length / 1MB, 2) }

    # 5. Rotate
    if (-not $DryRun) {
        Invoke-Rotate -Dir $script:WeeklyDir -Pattern 'ClodV4-weekly-*.zip' -Keep $KeepCount
    }

    $duration = [math]::Round(((Get-Date) - $startTime).TotalSeconds, 1)
    Write-BackupLog -Message "=== $type backup OK === zip=$zipSizeMB MB, duration=${duration}s"

    # Report to Railway (если настроено в server\.env)
    if (-not $DryRun) {
        $report = @{
            type        = if ($BackupLogId) { 'manual-weekly' } else { 'weekly' }
            status      = 'ok'
            startedAt   = $startTime.ToUniversalTime().ToString('o')
            finishedAt  = (Get-Date).ToUniversalTime().ToString('o')
            durationSec = [math]::Round($duration, 1)
            sizeMB      = $zipSizeMB
            gitSha      = Get-GitSha    -RepoRoot $projectRoot
            gitBranch   = Get-GitBranch -RepoRoot $projectRoot
            sections    = @{
                'code'    = "$codeSizeMB MB"
                'db-dump' = "$dumpSizeMB MB"
                'db-dump-prod' = if ($prodInfo.dumped) { "$(Get-DirectorySizeMB $prodDumpDest) MB" } else { "SKIPPED ($($prodInfo.reason))" }
            }
        }
        if ($BackupLogId) { $report['logId'] = $BackupLogId }
        Send-BackupReport -ProjectRoot $projectRoot -Payload $report
    }
}
catch {
    $errMsg = $_.Exception.Message
    Write-BackupLog -Level ERROR -Message "$type backup FAILED: $errMsg"
    $exitCode = 1
    if (-not $DryRun) {
        $failReport = @{
            type         = if ($BackupLogId) { 'manual-weekly' } else { 'weekly' }
            status       = 'failed'
            startedAt    = $startTime.ToUniversalTime().ToString('o')
            finishedAt   = (Get-Date).ToUniversalTime().ToString('o')
            durationSec  = [math]::Round(((Get-Date) - $startTime).TotalSeconds, 1)
            errorMessage = $errMsg
        }
        if ($BackupLogId) { $failReport['logId'] = $BackupLogId }
        try { Send-BackupReport -ProjectRoot $projectRoot -Payload $failReport } catch {}
    }
}
finally {
    if (Test-Path $staging) {
        try { Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue } catch {}
    }
    Release-BackupLock
}

exit $exitCode
