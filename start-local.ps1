# Запуск портала локально: сервер + фронт в двух окнах
$root = $PSScriptRoot
Write-Host "Farm Portal - запуск сервера и фронта..."
Write-Host ""

# Освобождаем порты
Get-NetTCPConnection -LocalPort 5000 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
Get-NetTCPConnection -LocalPort 5173 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 1

# Окно 1: бэкенд
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root'; npm run dev:server"

Start-Sleep -Seconds 2

# Окно 2: фронт
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root'; npm run dev:client"

Write-Host "Открыты два окна: сервер (порт 5000) и фронт (порт 5173)."
Write-Host "Через 5-10 сек откройте в браузере: http://localhost:5173"
Write-Host ""
