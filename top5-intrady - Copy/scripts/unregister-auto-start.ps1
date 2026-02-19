$ErrorActionPreference = "Stop"

$taskName = "GrowwPaperTradeAutoStart"
schtasks /Delete /F /TN $taskName | Out-Null
Write-Host "Task '$taskName' removed."