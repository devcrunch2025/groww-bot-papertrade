$ErrorActionPreference = "Stop"

$projectRoot = "D:\Dubai2026\Groww\groww-bot-papertrade\top5-intrady"
$logsDir = Join-Path $projectRoot "logs"
$healthUrl = "http://localhost:3000/api/health"
$ngrokApiUrl = "http://127.0.0.1:4040/api/tunnels"
$healthIntervalSeconds = 300

Set-Location $projectRoot
if (-not (Test-Path $logsDir)) {
	New-Item -Path $logsDir -ItemType Directory -Force | Out-Null
}

$watchdogLog = Join-Path $logsDir "watchdog.log"
$appLog = Join-Path $logsDir "app.log"
$ngrokLog = Join-Path $logsDir "ngrok.log"

$appProcessId = $null
$ngrokProcessId = $null

function Write-Log {
	param([string]$Message)
	$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
	"[$timestamp] $Message" | Out-File -FilePath $watchdogLog -Append -Encoding utf8
	Write-Host "[$timestamp] $Message"
}

function Is-ProcessRunning {
	param([int]$ProcessId)
	if (-not $ProcessId) {
		return $false
	}

	try {
		$null = Get-Process -Id $ProcessId -ErrorAction Stop
		return $true
	} catch {
		return $false
	}
}

function Stop-ProcessSafe {
	param([int]$ProcessId, [string]$Name)

	if (-not $ProcessId) {
		return
	}

	try {
		Stop-Process -Id $ProcessId -Force -ErrorAction Stop
		Write-Log "Stopped $Name process (PID $ProcessId)."
	} catch {
		Write-Log "Could not stop $Name process (PID $ProcessId): $($_.Exception.Message)"
	}
}

function Start-App {
	if (Is-ProcessRunning -ProcessId $script:appProcessId) {
		return
	}

	$appCommand = "Set-Location '$projectRoot'; npm start *>> '$appLog'"
	$process = Start-Process -FilePath "powershell.exe" -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $appCommand -WindowStyle Hidden -PassThru
	$script:appProcessId = $process.Id
	Write-Log "Started app process (PID $($process.Id))."
}

function Start-Ngrok {
	if (Is-ProcessRunning -ProcessId $script:ngrokProcessId) {
		return
	}

	$ngrokCommand = "Set-Location '$projectRoot'; ngrok http 3000 *>> '$ngrokLog'"
	$process = Start-Process -FilePath "powershell.exe" -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $ngrokCommand -WindowStyle Hidden -PassThru
	$script:ngrokProcessId = $process.Id
	Write-Log "Started ngrok process (PID $($process.Id))."

	Start-Sleep -Seconds 2
	try {
		$tunnelInfo = Invoke-RestMethod -UseBasicParsing -Uri $ngrokApiUrl -TimeoutSec 10
		$publicUrl = ($tunnelInfo.tunnels | Where-Object { $_.proto -eq "https" } | Select-Object -First 1 -ExpandProperty public_url)
		if (-not $publicUrl) {
			$publicUrl = ($tunnelInfo.tunnels | Select-Object -First 1 -ExpandProperty public_url)
		}
		if ($publicUrl) {
			Write-Log "Ngrok public URL: $publicUrl"
		}
	} catch {
		Write-Log "Ngrok API not ready yet: $($_.Exception.Message)"
	}
}

function Test-AppHealth {
	try {
		$response = Invoke-WebRequest -UseBasicParsing -Uri $healthUrl -TimeoutSec 10
		return [int]$response.StatusCode -eq 200
	} catch {
		return $false
	}
}

function Test-NgrokHealth {
	try {
		$tunnelInfo = Invoke-RestMethod -UseBasicParsing -Uri $ngrokApiUrl -TimeoutSec 10
		return ($tunnelInfo.tunnels | Measure-Object).Count -gt 0
	} catch {
		return $false
	}
}

Write-Log "Watchdog started (5-minute health checks)."
Start-App
Start-Ngrok

while ($true) {
	if (-not (Is-ProcessRunning -ProcessId $appProcessId)) {
		Write-Log "App process is not running. Restarting app."
		Start-App
	}

	$appHealthy = Test-AppHealth
	if (-not $appHealthy) {
		Write-Log "App health check failed. Restarting app."
		Stop-ProcessSafe -ProcessId $appProcessId -Name "app"
		$appProcessId = $null
		Start-Sleep -Seconds 2
		Start-App
	} else {
		Write-Log "App health check passed."
	}

	if (-not (Is-ProcessRunning -ProcessId $ngrokProcessId)) {
		Write-Log "Ngrok process is not running. Restarting ngrok."
		Start-Ngrok
	}

	$ngrokHealthy = Test-NgrokHealth
	if (-not $ngrokHealthy) {
		Write-Log "Ngrok health check failed. Restarting ngrok."
		Stop-ProcessSafe -ProcessId $ngrokProcessId -Name "ngrok"
		$ngrokProcessId = $null
		Start-Sleep -Seconds 2
		Start-Ngrok
	} else {
		Write-Log "Ngrok health check passed."
	}

	Start-Sleep -Seconds $healthIntervalSeconds
}
