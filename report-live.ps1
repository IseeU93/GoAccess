# Live-Report: GoAccess liest logs\access.log mit und aktualisiert logs\report.html im Browser
# (WebSocket auf Port 7890). Strg+C beendet GoAccess.
param([string]$Log = 'logs/access.log')

$dir = $PSScriptRoot
New-Item -ItemType Directory -Force "$dir\logs" | Out-Null
if (-not (Test-Path "$dir\$Log")) { New-Item -ItemType File "$dir\$Log" | Out-Null }

Start-Process "$dir\logs\report.html" -ErrorAction SilentlyContinue | Out-Null
wsl -d Ubuntu --cd $dir -- env LC_ALL=C goaccess $Log -p goaccess.conf -o logs/report.html --real-time-html --port=7890 --ws-url=localhost
