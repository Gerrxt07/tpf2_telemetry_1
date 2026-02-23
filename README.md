# Transport Fever 2 – Real-Time Telemetry

This mod writes live vehicle, line, and station data from your Transport Fever 2 world into a `telemetry.json` file. An optional FastAPI server watches that file and streams updates to a browser dashboard via WebSocket.

## What the mod does
- Collects every vehicle’s position, speed, passenger/cargo load, current line, last/next stop, and direction.
- Captures all lines (with stop metadata) and station positions for mapping.
- Emits lightweight stats (vehicle counts by type, passenger totals, line/station totals).
- Writes everything to `telemetry.json` inside the mod folder on a short interval so external tools can visualize or analyze it.
- Optional companion server (`server/server.py`) serves a web UI and a WebSocket feed that pushes new snapshots immediately to the browser.

### How it works (at a glance)
```
TPF2 (Mod)                          Optional Dashboard
───────────                        ───────────────────
mod.lua                             server/server.py (FastAPI)
  └─ res/scripts/telemetry/           └─ watches telemetry.json
        collector.lua                     └─ /ws streams to browser
           ⇣ writes telemetry.json            (static/index.html)
```

## Installation
1) **Enable the mod in TPF2**
   - Place the folder `tpf2_telemetry_1` in `Steam/userdata/.../1066780/local/mods/`.
   - In-game, open **Manage Mods** and enable **“Real-Time Telemetry”**.
   - Load a save; the mod will start writing `telemetry.json` into its own directory.

2) **(Optional) Start the dashboard server**
   ```bash
   cd server
   pip install -r requirements.txt
   python server.py
   ```
   - Default: http://127.0.0.1:8765  
   - Override host/port: `TPF2_HOST=0.0.0.0 TPF2_PORT=9000 python server.py`  
   - Custom telemetry path: `TPF2_TELEMETRY_PATH="C:/path/to/telemetry.json" python server.py`

3) **Open the dashboard**  
   Visit **http://localhost:8765** to see the live map/list once data is present.

## Configuration (mod parameters)
- **Write interval (seconds):** `1, 2, 3, 5, 10, 15, 30` (runtime script defaults to 2s; UI exposes the same options).
- **Include cargo vehicles:** on/off.
- **Include buses/trams:** on/off.

> Tip: Lower intervals increase disk writes and CPU usage; pick a value that fits your hardware and map size.

## Data snapshot (telemetry.json)
The collector currently writes:
- `schema_version`: 2  
- `write_count`: monotonically increasing counter (TPF2 sandbox lacks a wall-clock API; this supplements `game_time` when present)  
- `game_time`: current game time (from `game.interface` when available)  
- `stats`: totals for vehicles, passengers, lines, stations, and vehicle counts by type  
- `vehicles`: per-vehicle state (id, name, type, speed m/s & km/h, passengers/capacity, cargo, line id/name, last & next stop ids/names, position, direction, state)  
- `lines`: id, name, stop list (with resolved station/terminal info where possible)  
- `stations`: id, name, position  

`server.py` watches the file, keeps the latest snapshot in memory, exposes REST endpoints (`/api/telemetry`, `/api/vehicles`, `/api/lines`, `/api/stations`, `/api/stats`, `/api/health`) and a WebSocket feed at `/ws`.

## Current optimizations and easy update ideas (no big features)
- The collector already throttles writes via an in-game call counter and rebuilds station caches per snapshot to avoid stale data.
- Settings UI exposes interval/cargo/bus toggles; wiring those settings directly into `telemetry_runtime.lua` would let players tune performance without edits.
- Logging is concise (`[TPF2-Telemetry]`); keeping the interval >1s minimizes file writes on slower disks.
- If desired, a small guard could skip writes when no vehicles are returned, further reducing churn on empty saves.

## Future feature ideas
- **Map overlay:** Bundle the dashboard with a simple background map/tiles for vehicle positions.
- **Historical trends:** Optional rolling buffer of snapshots (in-memory or rotating files) for charts.
- **Filtering/presets:** Allow filtering by vehicle type or line directly in the Web UI.
- **Multi-save support:** Let the server watch multiple telemetry files and switch between them.
- **Localized UI:** Add language toggles in the dashboard matching the mod’s DE/EN strings.

## Troubleshooting
- **`telemetry.json` not created:** Ensure the mod is enabled and the game can write to its mod folder; check in-game console for `[TPF2-Telemetry]` messages.
- **Server not starting:** Re-run `pip install -r requirements.txt`; if port 8765 is busy, set `TPF2_PORT=9000`.
- **Data feels stale:** Very low intervals require `game.interface.setUpdateCallback`; otherwise updates happen on ticks/events. CommonAPI2 can help fire events more often.

## License
MIT – free to use and modify.
