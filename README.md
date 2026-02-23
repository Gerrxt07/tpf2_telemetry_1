# TPF2 Real-Time Telemetry

**A Transport Fever 2 mod + web dashboard that shows live vehicle data from your game world – directly in your browser.**

Track every train, bus, tram, ship and plane in real time: speed, passengers, last / next stop, occupancy and more. Data is pushed via WebSocket whenever the game writes a new snapshot, so the dashboard always stays up to date without manual refreshing.

---

## Features

- 🚆 **Live vehicle table** – all vehicles with type, line, state, speed and passenger occupancy
- 🔍 **Global search** and **per-column filters**
- 📊 **Summary cards** – total vehicles, passengers, lines and stations at a glance
- 🗂️ **Sortable columns** – by name, speed, passengers, type, state, occupancy, line or stop
- 📋 **Detail panel** – click any row to see full vehicle info including position
- 💾 **CSV export** – download the currently filtered vehicle list
- 🌐 **UI language toggle** – switch between **German** and **English** (saved per browser)
- 🌙 **Dark / light mode** toggle (saved per browser)
- ⚡ **WebSocket live feed** – auto-reconnects on disconnect
- 🗺️ **Mod localisation** – mod name / description / settings in DE, EN, FR and ES

---

## Architecture

```
TPF2 (Game)                           Browser
───────────                           ───────
mod.lua                               index.html
  └── res/config/game_script/           └── app.js  (WebSocket)
        telemetry_runtime.lua                 │
              │  calls every ~2 s            │  Live updates
              ▼                              │
  res/scripts/telemetry/                     │
        collector.lua                        │
              │  writes                      │
              ▼                              │
        telemetry.json  ──►  server.py  ─────┘
        (mod folder)        (FastAPI +
                             Watchdog)
```

### Components

| File | Description |
|------|-------------|
| `mod.lua` | TPF2 mod definition; registers the game script |
| `strings.lua` | Mod localisation (DE / EN / FR / ES) |
| `res/config/game_script/telemetry_runtime.lua` | Loaded by TPF2 as a game script; drives the periodic data collection |
| `res/scripts/telemetry/collector.lua` | Collects vehicle, line and station data; writes `telemetry.json` |
| `server/server.py` | FastAPI + Watchdog server; watches `telemetry.json` and pushes changes via WebSocket |
| `server/static/index.html` | Web UI |
| `server/static/style.css` | Styling (dark mode default, light mode available) |
| `server/static/app.js` | Frontend logic (WebSocket, rendering, filters, i18n, theme, CSV export) |

---

## Installation

### 1. Activate the mod in TPF2

1. Copy (or clone) the `tpf2_telemetry_1` folder into your TPF2 mod directory:
   ```
   Steam/userdata/<user_id>/1066780/local/mods/tpf2_telemetry_1/
   ```
2. Launch TPF2 and go to **Manage Mods**, then enable **"Real-Time Telemetry"**.
3. Load any save. The mod immediately starts writing `telemetry.json` inside its folder.

> **Note:** The mod uses `game.interface` APIs available in the base game.
> For guaranteed per-tick updates CommonAPI2 is recommended but not required.

### 2. Start the Python server

```bash
cd server
pip install -r requirements.txt
python server.py
```

The server starts on **http://127.0.0.1:8765** by default.

#### Optional environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TPF2_HOST` | `127.0.0.1` | Bind address (`0.0.0.0` for network access) |
| `TPF2_PORT` | `8765` | TCP port |
| `TPF2_LOG_LEVEL` | `info` | Uvicorn log level |
| `TPF2_TELEMETRY_PATH` | *(auto)* | Explicit path to `telemetry.json` |

```bash
# Different port
TPF2_PORT=9000 python server.py

# Allow network access
TPF2_HOST=0.0.0.0 python server.py

# Explicit path to telemetry.json
python server.py "C:/path/to/telemetry.json"
# or
TPF2_TELEMETRY_PATH="C:/path/to/telemetry.json" python server.py
```

### 3. Open the dashboard

Navigate to **http://localhost:8765** in your browser.

---

## JSON schema (`telemetry.json`)

```jsonc
{
  "schema_version": 2,
  "timestamp": 1708615200,        // Unix time injected by the server
  "write_count": 42,              // Monotonic counter from the mod
  "game_time": { "date": { "year": 1950, "month": 6, "day": 15 } },
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
      "type": "RAIL",              // RAIL | ROAD | TRAM | WATER | AIR | UNKNOWN
      "state": "IN_TRANSIT",       // IN_TRANSIT | AT_TERMINAL | STOPPED | LOADING | ...
      "line_id": 67890,
      "line_name": "Line 1",
      "position": { "x": 1234.5, "y": 567.8, "z": 0.0 },
      "speed_ms": 69.44,
      "speed_kmh": 250.0,
      "direction": 1,              // 1 = forward, -1 = backward
      "passengers": 450,
      "capacity": 500,
      "cargo": 0,
      "cargo_capacity": 0,
      "last_stop_id": 11111,
      "last_stop_name": "Central Station",
      "next_stop_id": 22222,
      "next_stop_name": "North Station"
    }
  ],
  "lines": [ { "id": 1, "name": "Line 1", "stops": [ ... ] } ],
  "stations": [ { "id": 1, "name": "Central Station", "pos": { "x": 0, "y": 0, "z": 0 } } ]
}
```

---

## API endpoints

| Method | URL | Description |
|--------|-----|-------------|
| `GET` | `/` | Web dashboard |
| `GET` | `/api/telemetry` | Full telemetry snapshot |
| `GET` | `/api/vehicles` | Vehicle list only |
| `GET` | `/api/lines` | Lines only |
| `GET` | `/api/stations` | Stations only |
| `GET` | `/api/stats` | Summary statistics |
| `GET` | `/api/health` | Server health check |
| `GET` | `/docs` | OpenAPI documentation |
| `WS`  | `/ws` | WebSocket live feed |

---

## Mod settings

The mod exposes three parameters in the TPF2 mod settings screen:

| Setting | Options | Default | Description |
|---------|---------|---------|-------------|
| Write interval | 1 / 2 / 3 / 5 / 10 / 15 / 30 s | 2 s | How often `telemetry.json` is updated |
| Include cargo vehicles | Yes / No | Yes | Whether freight vehicles appear in data |
| Include buses / trams | Yes / No | No | Whether road / tram lines are included |

---

## Troubleshooting

### `telemetry.json` is not created
- Make sure the mod is enabled in TPF2.
- Check the TPF2 console for messages prefixed with `[TPF2-Telemetry]`.
- The mod needs write access to its own folder.

### Server does not start
- Run `pip install -r requirements.txt` again.
- Port 8765 in use? Use `TPF2_PORT=9000 python server.py`.

### Data stops updating
- Check whether the mod is still writing (timestamp should change every few seconds).
- Reload the page or wait for WebSocket auto-reconnect.
- As a fallback: install CommonAPI2 to enable event-based updates.

---

## Requirements

| Component | Version |
|-----------|---------|
| Transport Fever 2 | any (CommonAPI2 optional) |
| Python | >= 3.9 |
| fastapi | >= 0.111 |
| uvicorn[standard] | >= 0.30 |
| watchdog | >= 4.0 |

---

## License

MIT – Free to use and modify.
