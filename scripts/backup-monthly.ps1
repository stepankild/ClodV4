# backup-monthly.ps1 — полный месячный бэкап ClodV4.
# Всё, что делает weekly, плюс: живые файлы с Pi и Pi Zero, HA config,
# systemd unit-файлы. → C:\Backups\ClodV4\monthly\
# Ротация: последние 3 zip-а.
#
# SSH steps — best-effort: если Pi недоступен (Tailscale off/Pi off), бэкап
# собирается без них, MANIFEST помечает пропуски. Лучше частичный, чем пустой.

[CmdletBinding()]
param(
    [switch]$DryRun,
    [int]$KeepCount = 3,

    # Агент передаёт -BackupLogId при ручном запуске из UI.
    [string]$BackupLogId = $null,

    # Разрешаем переопределять через параметры, если хосты переедут.
    [string]$PiScaleUserHost = 'stepan@100.95.73.8',
    [string]$PiZeroUserHost  = 'pi@100.104.214.7',
    [string]$PiScalePath     = '/home/stepan/pi-scale-client/',
    [string]$PiZeroPath      = '/home/pi/iot-sensor-client/',
    [string[]]$HaFallbackPaths = @('/home/stepan/homeassistant/config', '/home/stepan/ha/config')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. "$PSScriptRoot\backup-lib.ps1"

$startTime = Get-Date
$stamp     = $startTime.ToString('yyyy-MM-dd_HH-mm')
$type      = 'monthly'
$staging   = Join-Path $env:TEMP "ClodV4-$type-$stamp"
$zipName   = "ClodV4-$type-$stamp.zip"

Initialize-BackupDirs
Write-BackupLog -Message "=== $type backup start === (DryRun=$([bool]$DryRun))"

$projectRoot = Get-ProjectRoot
Write-BackupLog -Message "Project root: $projectRoot"

# Preflight — те же проверки, что в weekly.
if (-not (Test-MongodumpAvailable)) {
    Write-BackupLog -Level ERROR -Message "mongodump not in PATH. Install: winget install MongoDB.DatabaseTools"
    exit 1
}
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
    Acquire-BackupLock -Owner "monthly-$PID"
} catch {
    Write-BackupLog -Level ERROR -Message $_.Exception.Message
    exit 2
}

$sections = [ordered]@{}
$warnings = @()
$exitCode = 0

try {
    if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
    New-Item -ItemType Directory -Path $staging -Force | Out-Null

    # 1. Code (как в weekly)
    $codeDest = Join-Path $staging 'code'
    Write-BackupLog -Message "Copying code -> $codeDest"
    if (-not $DryRun) { Copy-ProjectCode -Source $projectRoot -Dest $codeDest }
    $sections['code'] = if ($DryRun) { '(dry-run)' } else { "$(Get-DirectorySizeMB $codeDest) MB" }

    # 2. DB dump (локальная)
    $dumpDest = Join-Path $staging 'db-dump'
    Write-BackupLog -Message "mongodump (local) -> $dumpDest"
    if (-not $DryRun) { Invoke-MongoDump -Uri $mongoUri -OutDir $dumpDest | Out-Null }
    $sections['db-dump'] = if ($DryRun) { '(dry-run)' } else { "$(Get-DirectorySizeMB $dumpDest) MB" }

    # 2b. DB dump (production, если настроено server\.env.production)
    $prodDumpDest = Join-Path $staging 'db-dump-prod'
    if ($DryRun) {
        $sections['db-dump-prod'] = '(dry-run)'
    } else {
        try {
            $prodInfo = Invoke-OptionalProdDump -ProjectRoot $projectRoot -OutDir $prodDumpDest
            if ($prodInfo.dumped) {
                Write-BackupLog -Message "mongodump (prod) -> $prodDumpDest"
                $sections['db-dump-prod'] = "$(Get-DirectorySizeMB $prodDumpDest) MB"
                $sections['mongo-uri-prod'] = $prodInfo.uri
            } else {
                Write-BackupLog -Message "prod dump skipped: $($prodInfo.reason)"
                $sections['db-dump-prod'] = "SKIPPED ($($prodInfo.reason))"
            }
        } catch {
            Write-BackupLog -Level WARN -Message "prod mongodump failed: $($_.Exception.Message)"
            $warnings += 'prod-db: mongodump failed'
            $sections['db-dump-prod'] = "FAILED: $($_.Exception.Message)"
        }
    }

    # 3. Pi scale-client (live from farm Pi)
    $piScaleDest = Join-Path $staging 'pi-scale-client-live'
    Write-BackupLog -Message "scp $PiScaleUserHost`:$PiScalePath -> $piScaleDest"
    if ($DryRun) {
        $sections['pi-scale-client-live'] = '(dry-run)'
    } else {
        $ok = Invoke-SshFetch -RemoteUserHost $PiScaleUserHost -RemotePath $PiScalePath -LocalDir $piScaleDest
        if ($ok) {
            Remove-IrrelevantPythonArtifacts -Dir $piScaleDest
            $sections['pi-scale-client-live'] = "$(Get-DirectorySizeMB $piScaleDest) MB"
        } else {
            $warnings += "pi-scale-client: scp failed"
            $sections['pi-scale-client-live'] = 'SKIPPED (scp failed)'
        }
    }

    # 4. Pi Zero iot-sensor-client
    $piZeroDest = Join-Path $staging 'iot-sensor-client-live'
    Write-BackupLog -Message "scp $PiZeroUserHost`:$PiZeroPath -> $piZeroDest"
    if ($DryRun) {
        $sections['iot-sensor-client-live'] = '(dry-run)'
    } else {
        $ok = Invoke-SshFetch -RemoteUserHost $PiZeroUserHost -RemotePath $PiZeroPath -LocalDir $piZeroDest
        if ($ok) {
            Remove-IrrelevantPythonArtifacts -Dir $piZeroDest
            $sections['iot-sensor-client-live'] = "$(Get-DirectorySizeMB $piZeroDest) MB"
        } else {
            $warnings += "iot-sensor-client: scp failed"
            $sections['iot-sensor-client-live'] = 'SKIPPED (scp failed)'
        }
    }

    # 5. Home Assistant config — ищем mount path у docker-контейнера, потом fallback.
    $haDest = Join-Path $staging 'homeassistant-config'
    if ($DryRun) {
        $sections['homeassistant-config'] = '(dry-run)'
    } else {
        $haPath = $null
        Write-BackupLog -Message "Probing HA config path via docker inspect"
        $inspectFmt = "{{range .Mounts}}{{.Source}}`n{{end}}"
        $inspectOut = Invoke-SshCommand -RemoteUserHost $PiScaleUserHost `
                       -Command "sudo docker inspect homeassistant --format '$inspectFmt'"
        if ($inspectOut) {
            $candidate = $inspectOut -split "`r?`n" |
                         Where-Object { $_ -match '/config$' -or $_ -match '/homeassistant$' } |
                         Select-Object -First 1
            if ($candidate) { $haPath = $candidate.Trim() }
        }
        if (-not $haPath) {
            # Try fallback paths by testing existence.
            foreach ($p in $HaFallbackPaths) {
                $exists = Invoke-SshCommand -RemoteUserHost $PiScaleUserHost `
                          -Command "test -d '$p' && echo yes || echo no"
                if ($exists -eq 'yes') { $haPath = $p; break }
            }
        }
        if ($haPath) {
            Write-BackupLog -Message "HA config path: $haPath"
            # Бэкапим только то, что УНИКАЛЬНО для этой инсталяции HA:
            #   - *.yaml (configuration, automations, scenes, scripts, secrets)
            #   - .storage/ (состояние интеграций, токены, entity registry) ~10 MB
            #   - blueprints/ (пользовательские автоматизации)
            # Исключаем:
            #   - home-assistant_v2.db* (история метрик, ~260 MB) — не критично
            #   - custom_components/ (~54 MB) — ставится заново через HACS
            #   - deps/ (Python-пакеты) и tts/ (аудиокэш) — регенерируются
            #   - *.log* — ни к чему
            # Для списка установленных custom_components сохраняем текстовое listing отдельно.
            $haExclude = @(
                'venv','.venv','__pycache__','*.pyc',
                'home-assistant_v2.db','home-assistant_v2.db-wal','home-assistant_v2.db-shm',
                '*.log','*.log.*','*.log.fault',
                'deps','tts','custom_components'
            )
            # HA config в Docker volume → .storage/ и часть файлов root-owned.
            # Поэтому -Sudo — запускаем remote tar через sudo на Pi.
            $ok = Invoke-SshFetch -RemoteUserHost $PiScaleUserHost -RemotePath "$haPath/" `
                  -LocalDir $haDest -Exclude $haExclude -Sudo
            if ($ok) {
                # Сохраняем список custom_components отдельным текстовым файлом
                # (чтобы после восстановления знать, какие интеграции переустанавливать).
                $listing = Invoke-SshCommand -RemoteUserHost $PiScaleUserHost `
                    -Command "sudo ls -1 $haPath/custom_components/ 2>/dev/null"
                if ($listing) {
                    Set-Content -Path (Join-Path $haDest 'custom_components.list.txt') -Value $listing -Encoding UTF8
                }
            }
            if ($ok) {
                $sections['homeassistant-config'] = "$(Get-DirectorySizeMB $haDest) MB (from $haPath, только .storage+yamls+blueprints)"
            } else {
                $warnings += 'HA config: fetch failed'
                $sections['homeassistant-config'] = 'SKIPPED (fetch failed)'
            }
        } else {
            Write-BackupLog -Level WARN -Message "HA config path not found (docker inspect + fallbacks)"
            $warnings += 'HA config: path not found'
            $sections['homeassistant-config'] = 'SKIPPED (path unknown)'
        }
    }

    # 6. Systemd unit files (маленькие, забираем точечно)
    $systemdDest = Join-Path $staging 'pi-systemd'
    if (-not $DryRun) {
        New-Item -ItemType Directory -Path $systemdDest -Force | Out-Null
        # Список юнитов, которые реально установлены в /etc/systemd/system/.
        # mqtt_bridge.service лежит в iot-sensor-client/ (не установлен в systemd) —
        # он попадает в бэкап через iot-sensor-client-live, здесь его не ищем.
        $units = @(
            @{ Host = $PiScaleUserHost; Path = '/etc/systemd/system/scale-client.service'; Dest = 'scale-client.service' },
            @{ Host = $PiScaleUserHost; Path = '/etc/systemd/system/display-proxy.service'; Dest = 'display-proxy.service' },
            @{ Host = $PiZeroUserHost;  Path = '/etc/systemd/system/sensor-node.service';  Dest = 'sensor-node.service' }
        )
        $collected = 0
        foreach ($u in $units) {
            $dstFile = Join-Path $systemdDest $u.Dest
            # Use ssh + cat + redirect (avoids permissions issues on /etc).
            $content = Invoke-SshCommand -RemoteUserHost $u.Host -Command "sudo cat '$($u.Path)' 2>/dev/null || cat '$($u.Path)'"
            if ($content) {
                Set-Content -Path $dstFile -Value $content -Encoding UTF8
                $collected++
            }
        }
        $sections['pi-systemd'] = "$collected unit file(s)"
    } else {
        $sections['pi-systemd'] = '(dry-run)'
    }

    # 6b. Mosquitto config (MQTT broker на main Pi). /etc/mosquitto/ часто root-only,
    #     поэтому -Sudo. Сначала проверяем существование, чтобы не плодить warning'и
    #     на фермах где брокер не ставился.
    $mosqDest = Join-Path $staging 'mosquitto-config'
    if ($DryRun) {
        $sections['mosquitto-config'] = '(dry-run)'
    } else {
        $exists = Invoke-SshCommand -RemoteUserHost $PiScaleUserHost `
                   -Command "test -d /etc/mosquitto && echo yes || echo no"
        if ($exists -eq 'yes') {
            $ok = Invoke-SshFetch -RemoteUserHost $PiScaleUserHost `
                  -RemotePath '/etc/mosquitto/' -LocalDir $mosqDest -Sudo
            if ($ok) {
                $sections['mosquitto-config'] = "$(Get-DirectorySizeMB $mosqDest) MB"
            } else {
                $warnings += 'mosquitto: fetch failed'
                $sections['mosquitto-config'] = 'SKIPPED (fetch failed)'
            }
        } else {
            $sections['mosquitto-config'] = 'SKIPPED (/etc/mosquitto not present)'
        }
    }

    # 6c. SSH-ключи текущего пользователя Windows — без них после восстановления
    #     не зайдёшь на Pi. Берём публичные+приватные.
    $sshSrc  = Join-Path $env:USERPROFILE '.ssh'
    $sshDest = Join-Path $staging 'windows-ssh'
    if ($DryRun) {
        $sections['windows-ssh'] = '(dry-run)'
    } elseif (Test-Path $sshSrc) {
        New-Item -ItemType Directory -Path $sshDest -Force | Out-Null
        $sshFiles = @('id_ed25519','id_ed25519.pub','id_rsa','id_rsa.pub','config','known_hosts')
        $copied = 0
        foreach ($f in $sshFiles) {
            $p = Join-Path $sshSrc $f
            if (Test-Path $p) {
                Copy-Item -Path $p -Destination (Join-Path $sshDest $f) -Force
                $copied++
            }
        }
        $sections['windows-ssh'] = "$copied file(s)"
    } else {
        $sections['windows-ssh'] = 'SKIPPED (~/.ssh not found)'
    }

    # 6d. User-level Claude memory — файлы живут вне проекта (%USERPROFILE%\.claude\projects\...).
    #     Там токены HA, логины, структура архитектуры. Бэкапим ту папку, что относится к
    #     этому проекту.
    $claudeMemSrc = Join-Path $env:USERPROFILE '.claude\projects\C--Users-Stepa-Desktop-Harvest-scale-ClodV4\memory'
    $claudeMemDest = Join-Path $staging 'claude-memory'
    if ($DryRun) {
        $sections['claude-memory'] = '(dry-run)'
    } elseif (Test-Path $claudeMemSrc) {
        New-Item -ItemType Directory -Path $claudeMemDest -Force | Out-Null
        Copy-Item -Path (Join-Path $claudeMemSrc '*') -Destination $claudeMemDest -Recurse -Force
        $sections['claude-memory'] = "$(Get-DirectorySizeMB $claudeMemDest) MB"
    } else {
        $sections['claude-memory'] = 'SKIPPED (folder not found)'
    }

    # 6e. Railway environment variables (best-effort через railway CLI).
    #     Требует: railway CLI установлен и пользователь залогинен (`railway login`),
    #     и проект прилинкован (`railway link` в корне проекта). Если что-то не так —
    #     пишем понятную инструкцию в файл, чтобы ты увидел в бэкапе.
    $railwayDest = Join-Path $staging 'railway-env'
    if ($DryRun) {
        $sections['railway-env'] = '(dry-run)'
    } else {
        New-Item -ItemType Directory -Path $railwayDest -Force | Out-Null
        $railwayCmd = Get-Command railway -ErrorAction SilentlyContinue
        if ($railwayCmd) {
            $prev = $ErrorActionPreference
            $ErrorActionPreference = 'Continue'
            try {
                Push-Location $projectRoot
                $json = & railway variables --json 2>&1 | ForEach-Object { $_.ToString() }
                $code = $LASTEXITCODE
                Pop-Location
                if ($code -eq 0 -and $json) {
                    $out = Join-Path $railwayDest 'variables.json'
                    Set-Content -Path $out -Value ($json -join "`n") -Encoding UTF8
                    $sections['railway-env'] = 'OK (variables.json)'
                } else {
                    $msg = ($json | Out-String).Trim()
                    Write-BackupLog -Level WARN -Message "railway variables failed: $msg"
                    $warnings += 'railway-env: CLI call failed'
                    Set-Content -Path (Join-Path $railwayDest 'FAILED.txt') -Value @"
railway variables call failed (exit $code).
Output:
$msg

Manual fallback: открой Railway UI -> Project -> Variables -> Raw Editor,
скопируй всё в файл server\.env.production рядом с проектом.
Следующий бэкап заберёт этот файл автоматически.
"@ -Encoding UTF8
                    $sections['railway-env'] = "FAILED (see railway-env/FAILED.txt)"
                }
            } finally { $ErrorActionPreference = $prev }
        } else {
            Set-Content -Path (Join-Path $railwayDest 'NOT_INSTALLED.txt') -Value @"
Railway CLI не установлен. Варианты:
  1. Установить: npm i -g @railway/cli && railway login && railway link (в корне проекта)
     После этого следующий monthly-бэкап заберёт переменные автоматически.
  2. Вручную: в Railway UI -> Variables -> Raw Editor -> скопировать в
     server\.env.production. Этот файл подхватывается и weekly, и monthly.
"@ -Encoding UTF8
            Write-BackupLog -Message "railway CLI not installed (see railway-env/NOT_INSTALLED.txt)"
            $sections['railway-env'] = 'SKIPPED (railway CLI not installed)'
        }
    }

    # 7. MANIFEST
    $sections['mongo-uri']  = ($mongoUri -replace '://[^@]+@', '://***:***@')
    $sections['warnings']   = if ($warnings.Count) { ($warnings -join '; ') } else { 'none' }
    if (-not $DryRun) {
        $manifestPath = Join-Path $staging 'MANIFEST.txt'
        New-BackupManifest -Path $manifestPath -Type $type -ProjectRoot $projectRoot -Sections $sections
    }

    # 8. Zip
    $zipPath = Join-Path $script:MonthlyDir $zipName
    Write-BackupLog -Message "Compressing -> $zipPath"
    if (-not $DryRun) {
        Compress-Backup -StagingDir $staging -ZipPath $zipPath
    }
    $zipSizeMB = if ($DryRun -or -not (Test-Path $zipPath)) { 0 } else { [math]::Round((Get-Item $zipPath).Length / 1MB, 2) }

    # 9. Rotate
    if (-not $DryRun) {
        Invoke-Rotate -Dir $script:MonthlyDir -Pattern 'ClodV4-monthly-*.zip' -Keep $KeepCount
    }

    $duration = [math]::Round(((Get-Date) - $startTime).TotalSeconds, 1)
    $warnNote = if ($warnings.Count) { " (warnings: $($warnings.Count))" } else { '' }
    Write-BackupLog -Message "=== $type backup OK === zip=$zipSizeMB MB, duration=${duration}s$warnNote"

    # Report to Railway
    if (-not $DryRun) {
        $report = @{
            type        = if ($BackupLogId) { 'manual-monthly' } else { 'monthly' }
            status      = 'ok'
            startedAt   = $startTime.ToUniversalTime().ToString('o')
            finishedAt  = (Get-Date).ToUniversalTime().ToString('o')
            durationSec = [math]::Round($duration, 1)
            sizeMB      = $zipSizeMB
            gitSha      = Get-GitSha    -RepoRoot $projectRoot
            gitBranch   = Get-GitBranch -RepoRoot $projectRoot
            warnings    = $warnings
            sections    = ($sections.GetEnumerator() | ForEach-Object -Begin { $h=@{} } -Process { $h[$_.Key] = [string]$_.Value } -End { $h })
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
            type         = if ($BackupLogId) { 'manual-monthly' } else { 'monthly' }
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
