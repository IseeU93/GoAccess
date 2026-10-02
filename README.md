# GoAccess-Lab

GoAccess 1.8.1 läuft in WSL2 (Ubuntu), da es keine native Windows-Version gibt. Dazu ein
Request-Simulator (Node, ohne Abhängigkeiten), der Log-Dateien erzeugt, die GoAccess auswertet.

## Schnellstart

```powershell
cd C:\Users\Fabian\goaccess-lab
.\demo.ps1          # Server + Traffic + Live-Report im Browser
.\stop.ps1          # alles beenden
```

Parameter: `.\demo.ps1 -Profile scan -Rps 50 -Duration 120`

## Simulator (`simulator\sim.mjs`)

| Befehl | Zweck |
|---|---|
| `node simulator/sim.mjs server [--port 8080]` | Webserver mit ~30 Routen (200/201/204/301/304/400/401/403/404/405/500/503), schreibt `logs\access.log` |
| `node simulator/sim.mjs traffic [--profile P] [--rps 20] [--duration 60]` | schickt echte Requests an den Server |
| `node simulator/sim.mjs generate [--days 14] [--lines 50000] [--seed 42]` | schreibt ein rückdatiertes Log `logs\history.log` (Tagesrhythmus, Wochenende, Scanner-Angriff, Fehlerwelle) |

**Report mit Bedienfeld:** `http://localhost:8080/__sim/report` – der GoAccess-Live-Report mit dem Button „⚙ Simulator“
unten rechts, der das Bedienfeld als Overlay öffnet (`demo.ps1` öffnet diese Adresse). Die Seite `/` zeigt eine kleine
Test-Seite mit Links.

**Bedienfeld einzeln im Browser:** `http://localhost:8080/__sim` ( nur Server + Report ohne
Zufallsverkehr: `.\demo.ps1 -NoTraffic`). Dort stellst du Anfrage (Methode, Pfad, IP, Browser, Referrer, Body) oder
Zufallsprofil ein, dazu Anzahl pro Runde (0 = endlos), Requests/Sekunde und optional Loop mit Pause. Presets wie
„Login Brute-Force“, „Scanner“, „404-Flut“ füllen das Formular vor. Das Bedienfeld selbst erscheint nicht im Access-Log.

**Manuell per Kommandozeile** (Server muss laufen, z. B. über `.\demo.ps1`; in PowerShell ausführen, Git Bash verändert Pfade wie `/about`):

```powershell
node simulator/sim.mjs shell                                   # interaktiv, siehe unten
node simulator/sim.mjs send GET /products/5
node simulator/sim.mjs send POST /api/login --ip 6.6.6.6 --ua curl --count 20 --body '{"u":1}'
```

In der `shell` tippst du Zeilen wie `GET /.env ip=6.6.6.6 ua=sqlmap x=20` (nur `/pfad` = GET, `x=N` = Anzahl).
Optionen: `ip`, `ua` (chrome, iphone, firefox, android, googlebot, curl, sqlmap oder eigener Text), `ref`, `body`.
Ohne `ip` bekommt jeder Request eine neue zufällige IP.

Traffic-Profile: `normal`, `spike` (8× Last), `scan` (Angriffe: `/.env`, `/wp-login.php`, SQL-Injection, Path-Traversal),
`errors` (500er, langsame Requests, fehlgeschlagene Logins), `bots` (Googlebot, curl, python-requests), `mixed`.

Die Besucher haben feste IPs, Browser und Referrer (Stammgäste häufiger als seltene Besucher). Die Client-IP
wird per `X-Forwarded-For` simuliert.

## Reports

| Skript | Ergebnis |
|---|---|
| `.\report-live.ps1` | HTML-Report mit Live-Updates (WebSocket, Port 7890) aus `logs\access.log` |
| `.\report-static.ps1` | statischer Report aus `logs\history.log` → `logs\history.html` |
| `.\report-terminal.ps1` | Dashboard im Terminal, folgt dem Log live (beenden mit `q`) |

Eigene Logs: `.\report-static.ps1 -Log pfad\zur\datei.log` (relativ zu diesem Ordner, im Format der `goaccess.conf`).

## Log-Format

Apache/Nginx COMBINED plus Antwortzeit in Sekunden am Zeilenende, siehe `goaccess.conf`. Für einen echten
Nginx: `log_format` mit `$request_time` am Ende, oder in der Konfiguration die Zeile `log-format` auf
`COMBINED` setzen und `%T` weglassen.

## Hinweise

- GoAccess selbst: `wsl -d Ubuntu -- goaccess --help`
- Läuft der Live-Report nicht im Browser, prüfen, ob `localhost`-Weiterleitung für WSL2 aktiv ist
  (`localhostForwarding` in `.wslconfig` nicht auf `false`).
