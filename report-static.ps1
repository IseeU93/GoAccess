# Statischer HTML-Report aus einer Log-Datei (z.B. dem generierten Verlauf) – oeffnet ihn im Browser.
param([string]$Log = 'logs/history.log', [string]$Out = 'logs/history.html')

$dir = $PSScriptRoot
wsl -d Ubuntu --cd $dir -- env LC_ALL=C goaccess $Log -p goaccess.conf -o $Out
if ($LASTEXITCODE -eq 0) { Start-Process "$dir\$Out" }
