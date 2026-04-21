# backup-lib.ps1 — shared helpers for ClodV4 weekly/monthly backup.
# Dot-source this from backup-weekly.ps1 and backup-monthly.ps1:
#   . "$PSScriptRoot\backup-lib.ps1"

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# --- Paths & constants -------------------------------------------------------

$script:BackupRoot = 'C:\Backups\ClodV4'
$script:WeeklyDir  = Join-Path $script:BackupRoot 'weekly'
$script:MonthlyDir = Join-Path $script:BackupRoot 'monthly'
$script:LogDir     = Join-Path $script:BackupRoot 'logs'
$script:LogFile    = Join-Path $script:LogDir 'backup.log'
$script:LockFile   = Join-Path $script:BackupRoot '.lock'
$script:StaleLockHours = 6

function Initialize-BackupDirs {
    foreach ($d in @($script:BackupRoot, $script:WeeklyDir, $script:MonthlyDir, $script:LogDir)) {
        if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
    }
}

function Get-ProjectRoot {
    # Scripts live in <project>\scripts\, so project root is one level up.
    return (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
}

# --- Logging -----------------------------------------------------------------

function Write-BackupLog {
    param(
        [Parameter(Mandatory)][string]$Message,
        [ValidateSet('INFO','WARN','ERROR')][string]$Level = 'INFO'
    )
    $ts = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
    $line = "[$ts] [$Level] $Message"
    # Always echo to host so manual runs are visible.
    switch ($Level) {
        'WARN'  { Write-Host $line -ForegroundColor Yellow }
        'ERROR' { Write-Host $line -ForegroundColor Red }
        default { Write-Host $line }
    }
    try {
        Add-Content -Path $script:LogFile -Value $line -Encoding UTF8
    } catch {
        # Never fail the backup because logging failed.
        Write-Host "[log-write-failed] $($_.Exception.Message)" -ForegroundColor DarkYellow
    }
}

# --- Lock --------------------------------------------------------------------

function Test-StaleLock {
    if (-not (Test-Path $script:LockFile)) { return $false }
    try {
        $lockTime = (Get-Item $script:LockFile).LastWriteTime
        $age = (Get-Date) - $lockTime
        return ($age.TotalHours -ge $script:StaleLockHours)
    } catch { return $true }
}

function Acquire-BackupLock {
    param([string]$Owner)
    if (Test-Path $script:LockFile) {
        if (Test-StaleLock) {
            Write-BackupLog -Level WARN -Message "Stale lock detected (older than $($script:StaleLockHours)h), removing."
            Remove-Item $script:LockFile -Force -ErrorAction SilentlyContinue
        } else {
            throw "Backup already in progress (lock at $script:LockFile). If this is wrong, delete the file manually."
        }
    }
    Set-Content -Path $script:LockFile -Value "$Owner|$((Get-Date).ToString('o'))|PID=$PID" -Encoding UTF8
}

function Release-BackupLock {
    if (Test-Path $script:LockFile) {
        Remove-Item $script:LockFile -Force -ErrorAction SilentlyContinue
    }
}

# --- .env parsing ------------------------------------------------------------

function Get-EnvValue {
    param(
        [Parameter(Mandatory)][string]$File,
        [Parameter(Mandatory)][string]$Key
    )
    if (-not (Test-Path $File)) { return $null }
    $pattern = "^\s*" + [regex]::Escape($Key) + "\s*=\s*(.+)$"
    foreach ($line in Get-Content $File) {
        if ($line -match $pattern) {
            return $matches[1].Trim().Trim('"').Trim("'")
        }
    }
    return $null
}

# --- Preflight ---------------------------------------------------------------

function Get-MongodumpPath {
    # 1. PATH (идеальный случай).
    $cmd = Get-Command mongodump -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }

    # 2. Известные места установки MongoDB Database Tools на Windows.
    #    winget-MSI ставит сюда, но не всегда добавляет в PATH до перелогина.
    $candidates = @(
        'C:\Program Files\MongoDB\Tools\100\bin\mongodump.exe',
        'C:\Program Files\MongoDB\Tools\bin\mongodump.exe'
    )
    # Глоб на случай другой версии (101, 99 и т.п.)
    $globbed = Get-ChildItem -Path 'C:\Program Files\MongoDB\Tools\*\bin\mongodump.exe' -ErrorAction SilentlyContinue |
               Sort-Object FullName -Descending |
               Select-Object -ExpandProperty FullName
    foreach ($p in @($candidates + $globbed)) {
        if ($p -and (Test-Path $p)) { return $p }
    }
    return $null
}

function Test-MongodumpAvailable {
    return [bool](Get-MongodumpPath)
}

function Invoke-OptionalProdDump {
    <#
    .SYNOPSIS
      Если в проекте есть server\.env.production с MONGODB_URI — дампим и его.
      Это ВТОРАЯ, отдельная БД (Atlas prod), не та же что локальная.
    .OUTPUTS
      [hashtable] @{ dumped = $true/$false; uri = '...' (scrubbed); outDir = '...'; reason = '...' }
    #>
    param(
        [Parameter(Mandatory)][string]$ProjectRoot,
        [Parameter(Mandatory)][string]$OutDir
    )
    $prodEnv = Join-Path $ProjectRoot 'server\.env.production'
    if (-not (Test-Path $prodEnv)) {
        return @{ dumped = $false; reason = 'server\.env.production not present (skipped)' }
    }
    $uri = Get-EnvValue -File $prodEnv -Key 'MONGODB_URI'
    if (-not $uri) {
        return @{ dumped = $false; reason = 'MONGODB_URI missing in .env.production' }
    }
    Invoke-MongoDump -Uri $uri -OutDir $OutDir | Out-Null
    $scrubbed = $uri -replace '://[^@]+@', '://***:***@'
    return @{ dumped = $true; uri = $scrubbed; outDir = $OutDir }
}

# --- Project code copy -------------------------------------------------------

function Copy-ProjectCode {
    param(
        [Parameter(Mandatory)][string]$Source,
        [Parameter(Mandatory)][string]$Dest
    )
    New-Item -ItemType Directory -Path $Dest -Force | Out-Null
    # robocopy: /E all subdirs including empty; /XD excluded dirs; quiet flags.
    # worktrees — временные git-воркtree, не нужны в бэкапе (дублируют код).
    $excludeDirs = @('node_modules', '.git', 'dist', 'venv', '__pycache__', 'worktrees')
    $args = @($Source, $Dest, '/E', '/XD') + $excludeDirs + @('/NFL','/NDL','/NJH','/NJS','/NC','/NS','/NP','/R:1','/W:1')
    $null = & robocopy @args
    # robocopy exit codes 0..7 = success variants; 8+ = real errors
    if ($LASTEXITCODE -ge 8) {
        throw "robocopy failed with exit code $LASTEXITCODE"
    }
    # Explicitly preserve .env files if they exist (robocopy копирует и их, но подстрахуемся).
    foreach ($envRel in @('server\.env', 'pi-scale-client\.env')) {
        $src = Join-Path $Source $envRel
        $dst = Join-Path $Dest   $envRel
        if (Test-Path $src) {
            New-Item -ItemType Directory -Path (Split-Path $dst) -Force | Out-Null
            Copy-Item -Path $src -Destination $dst -Force
        }
    }
    # Файлы с зарезервированными Windows-именами (nul, con, prn, aux, com1..9, lpt1..9)
    # ломают Compress-Archive. Обычно это случайно созданные артефакты (например, 'command > nul'
    # в bash-скрипте, исполненном на Windows). Убираем из staging и пишем warning.
    $reservedPattern = '^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)'
    $bad = Get-ChildItem -LiteralPath $Dest -Recurse -Force -ErrorAction SilentlyContinue |
           Where-Object { $_.Name -match $reservedPattern }
    foreach ($b in $bad) {
        # Используем \\?\ prefix — единственный способ удалить файл с reserved-именем.
        $longPath = '\\?\' + $b.FullName
        try {
            [System.IO.File]::Delete($longPath)
            Write-BackupLog -Level WARN -Message "Removed reserved-name file from staging: $($b.FullName)"
        } catch {
            Write-BackupLog -Level WARN -Message "Could not remove $($b.FullName): $($_.Exception.Message)"
        }
    }
}

# --- mongodump wrapper -------------------------------------------------------

function Invoke-MongoDump {
    param(
        [Parameter(Mandatory)][string]$Uri,
        [Parameter(Mandatory)][string]$OutDir
    )
    $exe = Get-MongodumpPath
    if (-not $exe) {
        throw "mongodump not found. Install MongoDB Database Tools: winget install MongoDB.DatabaseTools"
    }
    New-Item -ItemType Directory -Path $OutDir -Force | Out-Null

    # mongodump пишет прогресс в stderr. С $ErrorActionPreference='Stop' PS ловит это как
    # NativeCommandError до того, как мы успеем проверить $LASTEXITCODE. Временно глушим.
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $output = $null
    try {
        $output = & $exe --uri="$Uri" --out="$OutDir" 2>&1 | ForEach-Object { $_.ToString() }
        $code = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $prev
    }
    if ($code -ne 0) {
        $joined = ($output | Out-String).Trim()
        throw "mongodump failed (exit $code): $joined"
    }
    return ($output | Out-String).Trim()
}

# --- MANIFEST ----------------------------------------------------------------

function Get-GitSha {
    param([string]$RepoRoot)
    $gitDir = Join-Path $RepoRoot '.git'
    if (-not (Test-Path $gitDir)) { return '(not a git repo)' }
    # Worktree: .git is a file pointing to main gitdir.
    if (Test-Path $gitDir -PathType Leaf) {
        try {
            $content = Get-Content $gitDir -Raw
            if ($content -match 'gitdir:\s*(.+)') { $gitDir = $matches[1].Trim() }
        } catch { return '(gitdir resolve failed)' }
    }
    $headFile = Join-Path $gitDir 'HEAD'
    if (-not (Test-Path $headFile)) { return '(no HEAD)' }
    $head = (Get-Content $headFile -Raw).Trim()
    if ($head -match '^ref:\s*(.+)$') {
        $refPath = Join-Path $gitDir $matches[1].Trim()
        if (Test-Path $refPath) { return (Get-Content $refPath -Raw).Trim() }
        # Packed refs fallback
        $packed = Join-Path $gitDir 'packed-refs'
        if (Test-Path $packed) {
            $ref = $matches[1].Trim()
            foreach ($line in Get-Content $packed) {
                if ($line -match "^([0-9a-f]+)\s+$([regex]::Escape($ref))$") { return $matches[1] }
            }
        }
        return "(unresolved ref: $($matches[1].Trim()))"
    }
    return $head  # detached HEAD: sha directly
}

function Get-GitBranch {
    param([string]$RepoRoot)
    $gitDir = Join-Path $RepoRoot '.git'
    if (Test-Path $gitDir -PathType Leaf) {
        $content = Get-Content $gitDir -Raw
        if ($content -match 'gitdir:\s*(.+)') { $gitDir = $matches[1].Trim() }
    }
    $headFile = Join-Path $gitDir 'HEAD'
    if (-not (Test-Path $headFile)) { return '(unknown)' }
    $head = (Get-Content $headFile -Raw).Trim()
    if ($head -match '^ref:\s*refs/heads/(.+)$') { return $matches[1].Trim() }
    return '(detached)'
}

function Get-DirectorySizeMB {
    param([string]$Path)
    if (-not (Test-Path $Path)) { return 0 }
    $bytes = (Get-ChildItem -LiteralPath $Path -Recurse -Force -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
    if (-not $bytes) { return 0 }
    return [math]::Round($bytes / 1MB, 2)
}

function New-BackupManifest {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][ValidateSet('weekly','monthly')][string]$Type,
        [Parameter(Mandatory)][string]$ProjectRoot,
        [Parameter(Mandatory)][hashtable]$Sections
    )
    $sha    = Get-GitSha -RepoRoot $ProjectRoot
    $branch = Get-GitBranch -RepoRoot $ProjectRoot
    $lines = @(
        "ClodV4 Backup Manifest"
        "======================"
        "Type       : $Type"
        "Created    : $((Get-Date).ToString('yyyy-MM-dd HH:mm:ss zzz'))"
        "Host       : $env:COMPUTERNAME"
        "User       : $env:USERNAME"
        "Git branch : $branch"
        "Git SHA    : $sha"
        ""
        "Sections:"
    )
    foreach ($k in ($Sections.Keys | Sort-Object)) {
        $lines += ("  - {0,-28} {1}" -f $k, $Sections[$k])
    }
    Set-Content -Path $Path -Value ($lines -join "`r`n") -Encoding UTF8
}

# --- Zip & rotation ----------------------------------------------------------

function Compress-Backup {
    param(
        [Parameter(Mandatory)][string]$StagingDir,
        [Parameter(Mandatory)][string]$ZipPath
    )
    if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }
    # Compress-Archive's -Path with wildcard captures staging contents (not staging dir itself).
    Compress-Archive -Path (Join-Path $StagingDir '*') -DestinationPath $ZipPath -CompressionLevel Optimal
}

function Invoke-Rotate {
    param(
        [Parameter(Mandatory)][string]$Dir,
        [Parameter(Mandatory)][string]$Pattern,
        [Parameter(Mandatory)][int]$Keep
    )
    if (-not (Test-Path $Dir)) { return }
    # @(...) — force to array, иначе при одном файле будет scalar и .Count упадёт со StrictMode.
    $files = @(Get-ChildItem -Path $Dir -Filter $Pattern -File -ErrorAction SilentlyContinue |
               Sort-Object LastWriteTime -Descending)
    if ($files.Count -le $Keep) { return }
    $toDelete = $files | Select-Object -Skip $Keep
    foreach ($f in $toDelete) {
        Remove-Item $f.FullName -Force -ErrorAction SilentlyContinue
        Write-BackupLog -Message "Rotated out: $($f.Name)"
    }
}

# --- SSH helpers (used by monthly only) -------------------------------------

function Invoke-SshFetch {
    <#
    .SYNOPSIS
      Забирает директорию с удалённого хоста через tar-over-ssh.
      Значительно быстрее scp -r: compression + exclusion на удалённой стороне,
      один TCP-стрим вместо per-file. Не тащит venv/__pycache__/*.pyc/buffer.db.
      С -Sudo запускает remote tar под sudo (нужно для root-owned файлов,
      например HA Docker volume с .storage/).
      Возвращает $true при успехе.
    #>
    param(
        [Parameter(Mandatory)][string]$RemoteUserHost,   # e.g. "stepan@100.95.73.8"
        [Parameter(Mandatory)][string]$RemotePath,       # абсолютный путь к папке на Pi
        [Parameter(Mandatory)][string]$LocalDir,         # локальная destination
        [int]$ConnectTimeoutSec = 15,
        [string[]]$Exclude = @('venv','.venv','__pycache__','*.pyc','buffer.db','sensor_buffer.db','sensor_buffer.db-wal','sensor_buffer.db-shm'),
        [switch]$Sudo
    )
    New-Item -ItemType Directory -Path $LocalDir -Force | Out-Null

    # Разбиваем $RemotePath на parent + leaf, чтобы tar -C parent leaf упаковал именно leaf.
    $rp = $RemotePath.TrimEnd('/')
    $parent = ($rp -replace '/[^/]+$','')
    if ([string]::IsNullOrEmpty($parent)) { $parent = '/' }
    $leaf = ($rp -split '/')[-1]

    $excludeArgs = ($Exclude | ForEach-Object { "--exclude='$_'" }) -join ' '
    $tarPrefix = if ($Sudo) { 'sudo tar' } else { 'tar' }
    $remoteCmd = "$tarPrefix -C '$parent' $excludeArgs -czf - '$leaf'"

    $sshOpts = @(
        '-o','BatchMode=yes',
        '-o',"ConnectTimeout=$ConnectTimeoutSec",
        '-o','StrictHostKeyChecking=accept-new',
        '-o','ServerAliveInterval=10',
        '-o','ServerAliveCountMax=3'
    )

    # Стримим tar.gz от ssh → локальный tar.gz, потом распаковываем.
    # ВАЖНО: PowerShell 5.1 `>` пишет в UTF-16 с BOM, что ломает бинарные данные.
    # Поэтому используем .NET Process и копируем BaseStream (сырые байты) в файл.
    # ServerAliveInterval=10 + CountMax=3 => если передача стоит >30 сек, ssh умрёт сам.
    $tmpTgz = Join-Path $LocalDir '_fetch.tgz'
    $started = Get-Date
    Write-BackupLog -Message "  ssh-tar fetching $RemoteUserHost`:$RemotePath ..."

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = 'ssh'
    # Собираем аргументы: опции как есть, remote command — в двойных кавычках
    # (в remoteCmd есть пробелы, но нет " — внутри одинарные кавычки для tar).
    $argList = @()
    foreach ($o in $sshOpts) { $argList += $o }
    $argList += $RemoteUserHost
    $argList += ('"' + $remoteCmd + '"')
    $psi.Arguments = $argList -join ' '
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError  = $true
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow  = $true
    $proc = [System.Diagnostics.Process]::Start($psi)
    $fs = [System.IO.File]::Create($tmpTgz)
    try {
        $proc.StandardOutput.BaseStream.CopyTo($fs)
    } finally { $fs.Close() }
    # stderr читаем, чтобы процесс не заблокировался на заполненном пайпе
    $stderr = $proc.StandardError.ReadToEnd()
    $proc.WaitForExit()
    $code = $proc.ExitCode

    $took = [math]::Round(((Get-Date) - $started).TotalSeconds, 1)
    $sizeMB = if (Test-Path $tmpTgz) { [math]::Round((Get-Item $tmpTgz).Length / 1MB, 2) } else { 0 }
    Write-BackupLog -Message "  fetched $sizeMB MB in ${took}s (exit=$code)"
    if ($code -ne 0 -and $stderr) {
        Write-BackupLog -Level WARN -Message "  ssh stderr: $($stderr.Trim())"
    }

    if ($code -ne 0 -or -not (Test-Path $tmpTgz) -or (Get-Item $tmpTgz).Length -eq 0) {
        if (Test-Path $tmpTgz) { Remove-Item $tmpTgz -Force -ErrorAction SilentlyContinue }
        Write-BackupLog -Level WARN -Message "tar-over-ssh $RemoteUserHost`:$RemotePath failed (exit $code)"
        return $false
    }

    # Явно зовём Windows bsdtar (`C:\Windows\System32\tar.exe`), НЕ `tar` из PATH.
    # В PATH может быть Git-вский GNU tar, который трактует `C:\...` как host:path
    # (SSH-синтаксис) и падает. bsdtar нормально ест Windows-пути.
    # --strip-components=1 убирает верхний уровень (leaf-папку), чтобы файлы оказались
    # прямо в $LocalDir — как раньше после scp -r.
    $bsdtar = Join-Path $env:SystemRoot 'System32\tar.exe'
    if (-not (Test-Path $bsdtar)) { $bsdtar = 'tar' }   # fallback, вдруг нет (очень редкий случай)
    $tarErrors = $null
    $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try {
        $tarErrors = & $bsdtar -xzf $tmpTgz -C $LocalDir --strip-components=1 2>&1 | ForEach-Object { $_.ToString() }
        $xcode = $LASTEXITCODE
    } finally { $ErrorActionPreference = $prev }
    Remove-Item $tmpTgz -Force -ErrorAction SilentlyContinue

    if ($xcode -ne 0) {
        # bsdtar часто возвращает exit 1 не из-за фатальной ошибки, а из-за warning'ов
        # (например: символические ссылки с абсолютными путями — они safely игнорируются;
        # или permission denied на mode/owner установке — на NTFS это ожидаемо).
        # Если распаковка дала больше 0 файлов — считаем успехом, но логируем stderr.
        $extracted = @(Get-ChildItem -LiteralPath $LocalDir -Recurse -Force -ErrorAction SilentlyContinue).Count
        $errSample = if ($tarErrors) { ($tarErrors | Select-Object -First 3) -join ' | ' } else { '(no stderr)' }
        if ($extracted -gt 0) {
            Write-BackupLog -Level WARN -Message "local tar -x exit $xcode for $RemotePath but extracted $extracted items; stderr sample: $errSample"
            return $true
        } else {
            Write-BackupLog -Level WARN -Message "local tar -x failed for $RemotePath (exit $xcode, 0 files); stderr: $errSample"
            return $false
        }
    }
    return $true
}

function Invoke-SshCommand {
    <#
    .SYNOPSIS
      Run an ssh command, return stdout string. On failure returns $null.
    #>
    param(
        [Parameter(Mandatory)][string]$RemoteUserHost,
        [Parameter(Mandatory)][string]$Command,
        [int]$ConnectTimeoutSec = 15
    )
    $sshOpts = @(
        '-o','BatchMode=yes',
        '-o',"ConnectTimeout=$ConnectTimeoutSec",
        '-o','StrictHostKeyChecking=accept-new'
    )
    $args = $sshOpts + @($RemoteUserHost, $Command)
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $out = $null
    try {
        $out = & ssh @args 2>&1 | ForEach-Object { $_.ToString() }
        $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = $prev }
    if ($code -ne 0) {
        Write-BackupLog -Level WARN -Message "ssh $RemoteUserHost '$Command' failed (exit $code): $(($out | Out-String).Trim())"
        return $null
    }
    return ($out | Out-String).Trim()
}

function Send-BackupReport {
    <#
    .SYNOPSIS
      Best-effort POST JSON-отчёта в Railway /api/backups/report.
      Ошибки репортинга НЕ роняют бэкап.
    .PARAMETER ProjectRoot
      Корень проекта для чтения server\.env (SERVER_URL + BACKUP_API_KEY).
    .PARAMETER Payload
      Hashtable с полями type/status/startedAt/finishedAt/sizeMB/sections/
      warnings/errorMessage/gitSha/gitBranch/host/logId (если обновляем запись).
    #>
    param(
        [Parameter(Mandatory)][string]$ProjectRoot,
        [Parameter(Mandatory)][hashtable]$Payload
    )
    $envFile = Join-Path $ProjectRoot 'server\.env'
    if (-not (Test-Path $envFile)) {
        Write-BackupLog -Level WARN -Message "Report skipped: server\.env not found"
        return
    }
    $serverUrl = Get-EnvValue -File $envFile -Key 'SERVER_URL'
    $apiKey    = Get-EnvValue -File $envFile -Key 'BACKUP_API_KEY'
    if (-not $serverUrl -or -not $apiKey) {
        Write-BackupLog -Level WARN -Message "Report skipped: SERVER_URL or BACKUP_API_KEY not set in server\.env"
        return
    }
    # Автоматически добавляем host если его нет
    if (-not $Payload.ContainsKey('host')) { $Payload['host'] = $env:COMPUTERNAME }

    $url = ($serverUrl.TrimEnd('/')) + '/api/backups/report'
    $json = $Payload | ConvertTo-Json -Depth 6 -Compress
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $resp = Invoke-RestMethod -Uri $url -Method POST -Body $json `
                -ContentType 'application/json' `
                -Headers @{ 'X-Backup-Api-Key' = $apiKey } `
                -TimeoutSec 20
        Write-BackupLog -Message "Report sent OK (logId=$($resp.logId))"
    } catch {
        Write-BackupLog -Level WARN -Message "Report POST failed: $($_.Exception.Message)"
    } finally {
        $ErrorActionPreference = $prev
    }
}

function Remove-IrrelevantPythonArtifacts {
    <#
    .SYNOPSIS
      After scp'ing Python projects, prune venv/__pycache__/*.pyc and SQLite
      runtime state files we don't want in backups.
    #>
    param([Parameter(Mandatory)][string]$Dir)
    if (-not (Test-Path $Dir)) { return }
    # Dirs to nuke
    $killDirs = @('venv', '__pycache__', '.venv', '.mypy_cache', '.pytest_cache')
    Get-ChildItem -Path $Dir -Recurse -Force -Directory -ErrorAction SilentlyContinue |
        Where-Object { $killDirs -contains $_.Name } |
        ForEach-Object { Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue }
    # Files to nuke (runtime SQLite state, compiled py)
    $killFiles = @('*.pyc','sensor_buffer.db','sensor_buffer.db-wal','sensor_buffer.db-shm')
    foreach ($pat in $killFiles) {
        Get-ChildItem -Path $Dir -Recurse -Force -File -Filter $pat -ErrorAction SilentlyContinue |
            ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue }
    }
}
