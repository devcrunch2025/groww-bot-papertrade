$ErrorActionPreference = "Stop"

$projectRoot = "D:\Dubai2026\Groww\groww-bot-papertrade\top5-intrady"
Set-Location $projectRoot

$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
"[$timestamp] Auto-start task triggered." | Out-File -FilePath ".\logs\auto-start.log" -Append -Encoding utf8

npm start *> ".\logs\auto-start.log"
