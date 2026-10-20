# Перенос данных с компьютера в свой аккаунт на сайте (Neon).
# Запуск из папки проекта:  powershell -ExecutionPolicy Bypass -File scripts\import-to-cloud.ps1
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot)

$username = Read-Host 'Твой логин на сайте'
$target = Read-Host 'Строка подключения Neon (postgresql://...)'
if ($target -notmatch '^postgres(ql)?://') { throw 'Строка должна начинаться с postgresql://' }

Write-Host 'Запускаю локальную базу…'
docker compose up -d db | Out-Null
for ($i = 0; $i -lt 30; $i++) {
    docker compose exec -T db pg_isready -U lifehub -d lifehub *> $null
    if ($LASTEXITCODE -eq 0) { break }
    Start-Sleep -Seconds 1
}

$net = docker network ls --format '{{.Name}}' | Where-Object { $_ -like '*life-hub*_default' } | Select-Object -First 1
if (-not $net) { throw 'Не нашёл сеть docker compose проекта life-hub' }

docker run --rm --network $net -v "${PSScriptRoot}:/scripts:ro" `
    -e SOURCE_URL="postgres://lifehub:lifehub@db:5432/lifehub" `
    -e TARGET_URL="$target" -e USERNAME="$username" `
    postgres:17-alpine sh /scripts/import-to-cloud.sh
