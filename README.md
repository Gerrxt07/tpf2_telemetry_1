# TPF2 Echtzeit-Fahrplan-Web-Interface

Zeigt in Echtzeit, wo sich alle Züge (und optional Busse/Schiffe) in deiner
Transport Fever 2-Welt befinden – Geschwindigkeit, Passagiere, letzte/nächste
Station und mehr. Live im Browser via WebSocket.

---

## Architektur

```
TPF2 (Spiel)                       Browser
────────────                       ───────
mod.lua                             index.html
  └── telemetry/                      └── app.js (WebSocket)
        collector.lua                       │
              │  schreibt alle ~3s          │  Live-Updates
              ▼                             │
        telemetry.json  ──►  server.py  ────┘
        (im Mod-Ordner)     (FastAPI +
                             Watchdog)
```

### Komponenten

| Datei | Beschreibung |
|-------|-------------|
| `mod.lua` | TPF2-Mod-Definition; lädt den Collector und registriert ihn |
| `strings.lua` | Lokalisierung (DE/EN) |
| `res/scripts/telemetry/collector.lua` | Sammelt Fahrzeug-, Linien- und Stationsdaten; schreibt `telemetry.json` |
| `server/server.py` | FastAPI + Watchdog-Server; überwacht `telemetry.json` und pusht Änderungen per WebSocket |
| `server/static/index.html` | Web-UI |
| `server/static/style.css` | Styling (Dark Mode) |
| `server/static/app.js` | Frontend-Logik (WebSocket, Rendering, Filter) |

---

## Installation & Start

### 1. Mod in TPF2 aktivieren

1. Der Mod-Ordner `tpf2_telemetry_1` liegt bereits im richtigen Verzeichnis
   (`Steam/userdata/.../1066780/local/mods/`).
2. Starte TPF2, gehe zu **Mods verwalten** und aktiviere **„Echtzeit-Telemetrie"**.
3. Lade eine Welt. Der Mod schreibt sofort `telemetry.json` in seinen Ordner.

> **Hinweis**: Falls `game.interface.setUpdateCallback` in deiner TPF2-Version
> nicht verfügbar ist, werden Daten nur bei Fahrzeugereignissen (Ankunft/Abfahrt)
> und beim Laden aktualisiert. Für echte Sekunden-Updates ist CommonAPI2 empfohlen.

### 2. Python-Server starten

```bash
cd server
pip install -r requirements.txt
python server.py
```

Der Server startet standardmäßig auf **http://127.0.0.1:8765**.

#### Optionale Parameter

```bash
# Anderen Port nutzen
TPF2_PORT=9000 python server.py

# Anderen Host (Netzwerk-Zugriff)
TPF2_HOST=0.0.0.0 python server.py

# Expliziten Pfad zur telemetry.json angeben
python server.py "C:/Pfad/zur/telemetry.json"

# Oder als Umgebungsvariable
TPF2_TELEMETRY_PATH="C:/Pfad/zur/telemetry.json" python server.py
```

### 3. Browser öffnen

**http://localhost:8765**

---

## JSON-Schema (telemetry.json)

```jsonc
{
  "schema_version": 2,
  "timestamp": 1708615200,        // Unix-Zeit (Echtzeit)
  "game_time": { ... },           // Spielzeit-Objekt (TPF2-abhängig)
  "stats": {
    "total_vehicles": 42,
    "total_passengers": 8300,
    "total_lines": 15,
    "total_stations": 30,
    "vehicles_by_type": { "RAIL": 20, "ROAD": 22 }
  },
  "vehicles": [
    {
      "id": 12345,
      "name": "ICE 1",
      "type": "RAIL",              // RAIL | ROAD | WATER | AIR | UNKNOWN
      "state": "IN_TRANSIT",       // IN_TRANSIT | AT_TERMINAL | STOPPED
      "line_id": 67890,
      "line_name": "Linie 1",
      "position": { "x": 1234.5, "y": 567.8, "z": 0.0 },
      "speed_ms": 69.44,           // m/s
      "speed_kmh": 250.0,
      "direction": 1,              // 1 = vorwärts, -1 = rückwärts
      "passengers": 450,
      "capacity": 500,
      "cargo": 0,
      "cargo_capacity": 0,
      "last_stop_id": 11111,
      "last_stop_name": "Berlin Hbf",
      "next_stop_id": 22222,
      "next_stop_name": "Hamburg Hbf"
    }
  ],
  "lines": [ { "id": ..., "name": ..., "stops": [...] } ],
  "stations": [ { "id": ..., "name": ..., "pos": { "x":..., "y":..., "z":... } } ]
}
```

---

## API-Endpunkte

| Methode | URL | Beschreibung |
|---------|-----|-------------|
| `GET` | `/` | Web-UI |
| `GET` | `/api/telemetry` | Vollständiger Snapshot |
| `GET` | `/api/vehicles` | Nur Fahrzeugliste |
| `GET` | `/api/lines` | Nur Linien |
| `GET` | `/api/stations` | Nur Stationen |
| `GET` | `/api/stats` | Statistiken |
| `GET` | `/api/health` | Status-Check |
| `GET` | `/docs` | OpenAPI-Dokumentation |
| `WS`  | `/ws` | WebSocket Live-Feed |

---

## Troubleshooting

### `telemetry.json` wird nicht erstellt
- Stelle sicher, dass der Mod in TPF2 aktiviert ist.
- Prüfe die TPF2-Konsole auf Fehlermeldungen (`[TPF2-Telemetry]`-Präfix).
- Der Mod benötigt Schreibrechte auf sein eigenes Verzeichnis.

### Server startet nicht
- `pip install -r requirements.txt` erneut ausführen.
- Port 8765 belegt? `TPF2_PORT=9000 python server.py`

### Daten veralten (werden nicht aktualisiert)
- Prüfe, ob der Mod `game.interface.setUpdateCallback` unterstützt.
- Als Fallback: CommonAPI2 installieren und aktivieren – dann werden Events gefeuert.
- Oder: Server manuell neuladen via `GET /api/health`.

---

## Lizenz
MIT – Frei verwendbar und modifizierbar.
