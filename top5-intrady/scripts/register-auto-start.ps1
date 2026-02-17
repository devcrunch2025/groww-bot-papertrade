$ErrorActionPreference = "Stop"

$taskName = "GrowwPaperTradeAutoStart"
$scriptPath = "D:\Dubai2026\Groww\groww-bot-papertrade\top5-intrady\scripts\run-server.ps1"
$taskCommand = "powershell -NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`""

schtasks /Create /F /TN $taskName /TR $taskCommand /SC WEEKLY /D MON,TUE,WED,THU,FRI /ST 08:30 | Out-Null

Write-Host "Task '$taskName' registered for Mon-Fri at 08:30."