# Terminal-Dashboard, folgt dem Log live. Beenden mit q.
param([string]$Log = 'logs/access.log')

wsl -d Ubuntu --cd $PSScriptRoot -- bash -c "LC_ALL=C tail -n +1 -F '$Log' | goaccess - -p goaccess.conf"
