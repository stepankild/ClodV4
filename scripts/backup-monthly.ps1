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

    # 3. Main Pi: ВСЯ /home/stepan/ целиком (с разумными exclude'ами).
    #    Раньше бэкапили отдельно pi-scale-client/, homeassistant/ — но там рядом
    #    лежит куча "живого" кода которого нет в git: iot-sensor-client (mqtt_bridge,
    #    display_proxy, r2_uploader, timelapse*), doorbell.py, humidity_controller.py,
    #    .ha_token, bridge_config.yaml. Забираем всё одним tar'ом под sudo
    #    (часть файлов root-owned — например home-assistant_v2.db, humidity_controller.py).
    $piHomeDest = Join-Path $staging 'main-pi-home-live'
    if ($DryRun) {
        $sections['main-pi-home-live'] = '(dry-run)'
    } else {
        $homeExclude = @(
            # Python/Node junk
            'venv','.venv','__pycache__','*.pyc','node_modules',
            # Desktop/OS cache (Pi с GUI — бесполезный мусор)
            # .config/systemd/user содержит symlinks для rpi-connect, которые Windows
            # не умеет создавать при распаковке (нужны elevated). Фильтруем всё .config.
            '.cache','.local','.npm','.docker','.mozilla','.thunderbird',
            '.config',
            '.gnupg','.Xauthority','.xsession-errors','.xsession-errors.old',
            '.bash_history','.viminfo','.wget-hsts','.sudo_as_admin_successful',
            # Пустые default XDG-папки
            'Desktop','Downloads','Music','Pictures','Videos','Public','Templates','Documents',
            # HA history DB (~260 MB) и HACS components (~54 MB, регенерируемы)
            'home-assistant_v2.db','home-assistant_v2.db-wal','home-assistant_v2.db-shm',
            'deps','tts','custom_components',
            # Timelapse media (~131 MB, растёт со временем). Снимки и видео загружаются
            # в Cloudflare R2 через r2_uploader.py — это первичный бэкап этой истории.
            # Если R2 умрёт — история с начала использования портала теряется, но для
            # защиты именно от этого случая лучше иметь отдельный rclone-sync R2→local,
            # а не дублировать тут.
            'timelapse',
            # Логи, runtime-буферы
            '*.log','*.log.*','*.log.fault',
            'buffer.db','bridge_buffer.db','sensor_buffer.db',
            'sensor_buffer.db-wal','sensor_buffer.db-shm'
        )
        # -Sudo обязателен: на Pi есть root-owned файлы (humidity_controller.py,
        # HA .storage/, в homeassistant некоторые файлы тоже от root).
        $ok = Invoke-SshFetch -RemoteUserHost $PiScaleUserHost `
              -RemotePath '/home/stepan/' -LocalDir $piHomeDest -Exclude $homeExclude -Sudo
        if ($ok) {
            # Сохраняем listing HACS-компонентов отдельно — зная список после восстановления
            # можно переустановить custom_components заново через HACS.
            $haBase = '/home/stepan/homeassistant'
            $listing = Invoke-SshCommand -RemoteUserHost $PiScaleUserHost `
                -Command "sudo ls -1 $haBase/custom_components/ 2>/dev/null || true"
            if ($listing) {
                $target = Join-Path $piHomeDest 'homeassistant\custom_components.list.txt'
                New-Item -ItemType Directory -Path (Split-Path $target) -Force | Out-Null
                Set-Content -Path $target -Value $listing -Encoding UTF8
            }
            $sections['main-pi-home-live'] = "$(Get-DirectorySizeMB $piHomeDest) MB"
        } else {
            $warnings += 'main-pi-home: scp failed'
            $sections['main-pi-home-live'] = 'SKIPPED (scp failed)'
        }
    }

    # 4. Pi Zero iot-sensor-client (отдельный хост, user pi)
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

    # 6. Systemd unit files (маленькие, забираем точечно)
    $systemdDest = Join-Path $staging 'pi-systemd'
    if (-not $DryRun) {
        New-Item -ItemType Directory -Path $systemdDest -Force | Out-Null
        # Забираем все non-system юниты с main Pi одним махом через wildcard.
        # Фильтруем системные (cloud-*, ssh, docker, networkd, nfs-*, tailscaled, ...) —
        # они воспроизводятся при установке пакетов, и их часто нет в /etc/systemd/system/
        # (они в /lib/systemd/system/).
        # С Pi Zero — только sensor-node.service (больше там нет кастомного).
        $collected = 0
        $listRaw = Invoke-SshCommand -RemoteUserHost $PiScaleUserHost `
                    -Command "sudo ls -1 /etc/systemd/system/*.service 2>/dev/null | grep -vE '/(ssh|ssh\.service|getty|console-setup|keyboard-setup|networkd-dispatcher|NetworkManager|ModemManager|wpa_supplicant|bluetooth|avahi-daemon|cups|ufw|fake-hwclock|rsyslog|iscsi|dbus-|accounts-daemon|polkit|acpi|upower|udisks2|apparmor|apport|cron|e2scrub|emergency|rescue|rfkill|unattended|kmod|packagekit|plymouth|systemd-|multi-user|default|sysinit|graphical|basic|cloud-init|cloud-config|cloud-final|netfilter-persistent|iptables|ip6tables|redis|mysql|postgresql|nginx|apache2|snap)' || true"
        if ($listRaw) {
            foreach ($path in ($listRaw -split "`r?`n")) {
                $path = $path.Trim()
                if (-not $path -or $path -notmatch '\.service$') { continue }
                $name = ($path -split '/')[-1]
                $dst  = Join-Path $systemdDest $name
                $content = Invoke-SshCommand -RemoteUserHost $PiScaleUserHost `
                    -Command "sudo cat '$path' 2>/dev/null"
                if ($content) {
                    Set-Content -Path $dst -Value $content -Encoding UTF8
                    $collected++
                }
            }
        }
        # Pi Zero: единственный кастомный юнит
        $zeroUnit = Invoke-SshCommand -RemoteUserHost $PiZeroUserHost `
                    -Command "sudo cat /etc/systemd/system/sensor-node.service 2>/dev/null"
        if ($zeroUnit) {
            Set-Content -Path (Join-Path $systemdDest 'sensor-node.service') -Value $zeroUnit -Encoding UTF8
            $collected++
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

    # 6b2. Zigbee2MQTT config (/opt/zigbee2mqtt/data/). Там configuration.yaml
    # с serial-портом, network_key, paired devices — БЕЗ этого после переустановки
    # пришлось бы заново сопрягать все Zigbee-устройства. Root-owned → -Sudo.
    $z2mDest = Join-Path $staging 'zigbee2mqtt-data'
    if ($DryRun) {
        $sections['zigbee2mqtt-data'] = '(dry-run)'
    } else {
        $exists = Invoke-SshCommand -RemoteUserHost $PiScaleUserHost `
                   -Command "test -d /opt/zigbee2mqtt/data && echo yes || echo no"
        if ($exists -eq 'yes') {
            # log.log и base_db.db excluded: логи не нужны, база соседей —
            # регенерируется. Всё что НУЖНО: configuration.yaml, state.json,
            # database.db (paired devices), coordinator_backup.json.
            $z2mExclude = @('log','log.log','*.log','*.log.*')
            $ok = Invoke-SshFetch -RemoteUserHost $PiScaleUserHost `
                  -RemotePath '/opt/zigbee2mqtt/data/' -LocalDir $z2mDest `
                  -Exclude $z2mExclude -Sudo
            if ($ok) {
                $sections['zigbee2mqtt-data'] = "$(Get-DirectorySizeMB $z2mDest) MB"
            } else {
                $warnings += 'zigbee2mqtt-data: fetch failed'
                $sections['zigbee2mqtt-data'] = 'SKIPPED (fetch failed)'
            }
        } else {
            $sections['zigbee2mqtt-data'] = 'SKIPPED (/opt/zigbee2mqtt/data not present)'
        }
    }

    # 6b3. iptables persistent rules (наш UDP-блок 41641 для DERP-forced Tailscale).
    # Без этого файла после восстановления Pi придётся вручную повторять настройку
    # из PI_USB_DEVICES.md (это не здесь документировано). Мелкий — просто cat.
    $iptDest = Join-Path $staging 'iptables-rules'
    if (-not $DryRun) {
        New-Item -ItemType Directory -Path $iptDest -Force | Out-Null
        $iptCount = 0
        foreach ($f in @('rules.v4', 'rules.v6')) {
            $content = Invoke-SshCommand -RemoteUserHost $PiScaleUserHost `
                -Command "sudo cat /etc/iptables/$f 2>/dev/null"
            if ($content) {
                Set-Content -Path (Join-Path $iptDest $f) -Value $content -Encoding UTF8
                $iptCount++
            }
        }
        $sections['iptables-rules'] = if ($iptCount) { "$iptCount file(s)" } else { 'SKIPPED (not installed)' }
    } else {
        $sections['iptables-rules'] = '(dry-run)'
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
