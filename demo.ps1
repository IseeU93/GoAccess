# Startet alles: Simulator-Server, Traffic (Profil "mixed") und den GoAccess-Live-Report im Browser.
# Beenden: .\stop.ps1
param([string]$Profile = 'mixed', [int]$Rps = 25, [int]$Duration = 0, [switch]$NoTraffic)   # Duration 0 = endlos; -NoTraffic = nur Server + Report, Requests dann ueber das Bedienfeld

$dir = $PSScriptRoot
$sim = "$dir\simulator\sim.mjs"
New-Item -ItemType Directory -Force "$dir\logs" | Out-Null
Remove-Item "$dir\logs\access.log" -ErrorAction SilentlyContinue

$pids = @()
$pids += (Start-Process node -ArgumentList "`"$sim`" server --port 8080" -WindowStyle Hidden -PassThru).Id
Start-Sleep 1
if (-not $NoTraffic) {
    $pids += (Start-Process node -ArgumentList "`"$sim`" traffic --profile $Profile --rps $Rps --duration $Duration" -WindowStyle Hidden -PassThru).Id
}
$pids | Set-Content "$dir\.pids"

Start-Process wsl -ArgumentList "-d Ubuntu --cd `"$dir`" -- env LC_ALL=C goaccess logs/access.log -p goaccess.conf -o logs/report.html --real-time-html --port=7890 --ws-url=localhost" -WindowStyle Hidden
Start-Sleep 2
Start-Process "http://localhost:8080/__sim/report"
Write-Host "Laeuft: Report mit Bedienfeld (Button 'Simulator' unten rechts): http://localhost:8080/__sim/report   Beenden mit .\stop.ps1"
