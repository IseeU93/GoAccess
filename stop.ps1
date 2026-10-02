# Beendet Server, Traffic-Generator und GoAccess aus demo.ps1.
$f = "$PSScriptRoot\.pids"
if (Test-Path $f) {
    Get-Content $f | ForEach-Object { Stop-Process -Id $_ -ErrorAction SilentlyContinue }
    Remove-Item $f
}
wsl -d Ubuntu -u root -- pkill goaccess
Write-Host 'Gestoppt.'
