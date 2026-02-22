"""
TPF2 Echtzeit-Telemetrie Server
================================
FastAPI + WebSocket Server der telemetry.json beobachtet und live an
verbundene Browser pusht.

Start:  python server.py
Öffne:  http://localhost:8765
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
import time
from pathlib import Path
from typing import Any

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler, FileModifiedEvent

# ─────────────────────────────────────────────────────────────────────────────
# Konfiguration
# ─────────────────────────────────────────────────────────────────────────────

# Pfad zur telemetry.json (Standard: im selben Verzeichnis wie der Mod)
# Kann als Umgebungsvariable TPF2_TELEMETRY_PATH oder als Kommandozeilen-
# argument übergeben werden.
DEFAULT_TELEMETRY_PATH = Path(__file__).parent.parent / "telemetry.json"

HOST        = os.environ.get("TPF2_HOST", "127.0.0.1")
PORT        = int(os.environ.get("TPF2_PORT", "8765"))
LOG_LEVEL   = os.environ.get("TPF2_LOG_LEVEL", "info")

# Pfad überschreiben per Argument oder Env-Var
if len(sys.argv) > 1:
    TELEMETRY_PATH = Path(sys.argv[1])
elif "TPF2_TELEMETRY_PATH" in os.environ:
    TELEMETRY_PATH = Path(os.environ["TPF2_TELEMETRY_PATH"])
else:
    TELEMETRY_PATH = DEFAULT_TELEMETRY_PATH

# ─────────────────────────────────────────────────────────────────────────────
# Logging
# ─────────────────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("tpf2-telemetry")

# ─────────────────────────────────────────────────────────────────────────────
# Datenspeicher (in-memory, thread-safe via asyncio.Lock)
# ─────────────────────────────────────────────────────────────────────────────

class TelemetryStore:
    """Hält den aktuellen Telemetrie-Zustand und benachrichtigt Listener."""

    def __init__(self) -> None:
        self._data: dict[str, Any] = {}
        self._lock = asyncio.Lock()
        self._listeners: list[asyncio.Queue] = []
        self.last_update: float = 0.0
        self.file_mtime: float = 0.0

    async def update(self, raw: str) -> None:
        """Parst JSON-String und benachrichtigt alle WebSocket-Clients."""
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as exc:
            log.warning("Ungültiges JSON: %s", exc)
            return

        async with self._lock:
            self._data = data
            self.last_update = time.time()

        # Alle wartenden Queues befüllen (WebSocket-Handler)
        for q in list(self._listeners):
            try:
                q.put_nowait(raw)
            except asyncio.QueueFull:
                pass  # Client zu langsam – aktuellen Frame überspringen

        log.info(
            "Update: %d Fahrzeuge | %d Linien | %d Stationen",
            len(data.get("vehicles", [])),
            len(data.get("lines",    [])),
            len(data.get("stations", [])),
        )

    async def get(self) -> dict[str, Any]:
        async with self._lock:
            return dict(self._data)

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=4)
        self._listeners.append(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        try:
            self._listeners.remove(q)
        except ValueError:
            pass


store = TelemetryStore()

# ─────────────────────────────────────────────────────────────────────────────
# Watchdog: Datei beobachten
# ─────────────────────────────────────────────────────────────────────────────

class TelemetryFileHandler(FileSystemEventHandler):
    """Reagiert auf Änderungen der telemetry.json."""

    def __init__(self, path: Path, loop: asyncio.AbstractEventLoop) -> None:
        self._path = path.resolve()
        self._loop = loop

    def on_modified(self, event: FileModifiedEvent) -> None:
        if Path(event.src_path).resolve() != self._path:
            return
        # Datei asynchron lesen (im asyncio-Thread)
        asyncio.run_coroutine_threadsafe(self._reload(), self._loop)

    async def _reload(self) -> None:
        """Liest telemetry.json und aktualisiert den Store."""
        try:
            mtime = self._path.stat().st_mtime
            if mtime == store.file_mtime:
                return  # Keine echte Änderung
            store.file_mtime = mtime

            # Kurz warten, falls die Datei noch geschrieben wird
            await asyncio.sleep(0.05)

            content = self._path.read_text(encoding="utf-8")
            if not content.strip():
                return
            await store.update(content)
        except (OSError, PermissionError) as exc:
            log.debug("Datei-Lesefehler (wird ignoriert): %s", exc)


async def start_watchdog(loop: asyncio.AbstractEventLoop) -> None:
    """Startet den Watchdog-Observer in einem separaten Thread."""
    watch_dir = TELEMETRY_PATH.parent
    if not watch_dir.exists():
        log.warning("Watch-Verzeichnis existiert nicht: %s", watch_dir)
        return

    handler  = TelemetryFileHandler(TELEMETRY_PATH, loop)
    observer = Observer()
    observer.schedule(handler, str(watch_dir), recursive=False)
    observer.start()
    log.info("Beobachte: %s", TELEMETRY_PATH)

    # Initiale Lessung beim Start
    if TELEMETRY_PATH.exists():
        try:
            content = TELEMETRY_PATH.read_text(encoding="utf-8")
            if content.strip():
                await store.update(content)
        except OSError:
            pass

    # Observer läuft im Hintergrund – hier nur auf Shutdown warten
    try:
        while True:
            await asyncio.sleep(1)
            if not observer.is_alive():
                log.warning("Watchdog-Observer gestorben – Neustart")
                observer.start()
    finally:
        observer.stop()
        observer.join()


# ─────────────────────────────────────────────────────────────────────────────
# FastAPI App
# ─────────────────────────────────────────────────────────────────────────────

app = FastAPI(
    title       = "TPF2 Echtzeit-Telemetrie",
    description = "Zeigt Live-Daten aller Züge aus Transport Fever 2",
    version     = "1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins     = ["*"],
    allow_credentials = True,
    allow_methods     = ["*"],
    allow_headers     = ["*"],
)

# Statische Dateien (HTML/CSS/JS)
_static_dir = Path(__file__).parent / "static"
if _static_dir.exists():
    app.mount("/static", StaticFiles(directory=str(_static_dir)), name="static")


# ─── Startup / Shutdown ──────────────────────────────────────────────────────

@app.on_event("startup")
async def on_startup() -> None:
    loop = asyncio.get_running_loop()
    asyncio.create_task(start_watchdog(loop))
    log.info("Server gestartet auf http://%s:%d", HOST, PORT)


# ─── REST-Endpunkte ──────────────────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
async def root() -> HTMLResponse:
    """Liefert die Haupt-Web-UI."""
    index = _static_dir / "index.html"
    if index.exists():
        return HTMLResponse(content=index.read_text(encoding="utf-8"))
    return HTMLResponse("<h1>TPF2 Telemetrie</h1><p>static/index.html nicht gefunden.</p>")


@app.get("/api/telemetry", response_class=JSONResponse)
async def api_telemetry() -> JSONResponse:
    """Gibt den aktuellen Telemetrie-Snapshot als JSON zurück."""
    data = await store.get()
    return JSONResponse(content=data)


@app.get("/api/vehicles", response_class=JSONResponse)
async def api_vehicles() -> JSONResponse:
    """Gibt nur die Fahrzeugliste zurück."""
    data = await store.get()
    return JSONResponse(content=data.get("vehicles", []))


@app.get("/api/lines", response_class=JSONResponse)
async def api_lines() -> JSONResponse:
    """Gibt alle Linien zurück."""
    data = await store.get()
    return JSONResponse(content=data.get("lines", []))


@app.get("/api/stations", response_class=JSONResponse)
async def api_stations() -> JSONResponse:
    """Gibt alle Stationen zurück."""
    data = await store.get()
    return JSONResponse(content=data.get("stations", []))


@app.get("/api/stats", response_class=JSONResponse)
async def api_stats() -> JSONResponse:
    """Gibt Zusammenfassungsstatistiken zurück."""
    data = await store.get()
    return JSONResponse(content={
        "stats":       data.get("stats", {}),
        "last_update": store.last_update,
        "game_time":   data.get("game_time"),
        "timestamp":   data.get("timestamp"),
    })


@app.get("/api/health", response_class=JSONResponse)
async def api_health() -> JSONResponse:
    """Health-Check-Endpunkt."""
    age = time.time() - store.last_update if store.last_update else None
    return JSONResponse(content={
        "status":         "ok",
        "telemetry_path": str(TELEMETRY_PATH),
        "file_exists":    TELEMETRY_PATH.exists(),
        "last_update_age_seconds": round(age, 1) if age is not None else None,
    })


# ─── WebSocket ───────────────────────────────────────────────────────────────

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket) -> None:
    """
    WebSocket-Verbindung für Live-Updates.
    Sendet bei jeder Änderung der telemetry.json den vollständigen Snapshot.
    """
    await ws.accept()
    log.info("WebSocket verbunden: %s", ws.client)

    queue = store.subscribe()

    # Aktuellen Zustand sofort senden
    current = await store.get()
    if current:
        try:
            await ws.send_text(json.dumps(current))
        except Exception:
            pass

    try:
        while True:
            try:
                # Auf nächste Aktualisierung warten (Timeout 30s für Keepalive)
                raw = await asyncio.wait_for(queue.get(), timeout=30.0)
                await ws.send_text(raw)
            except asyncio.TimeoutError:
                # Keepalive-Ping
                try:
                    await ws.send_text(json.dumps({"type": "ping", "ts": time.time()}))
                except Exception:
                    break
    except WebSocketDisconnect:
        log.info("WebSocket getrennt: %s", ws.client)
    except Exception as exc:
        log.debug("WebSocket-Fehler: %s", exc)
    finally:
        store.unsubscribe(queue)


# ─────────────────────────────────────────────────────────────────────────────
# Einstiegspunkt
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    log.info("═" * 60)
    log.info("  TPF2 Echtzeit-Telemetrie Server v1.0")
    log.info("  Telemetrie-Datei : %s", TELEMETRY_PATH)
    log.info("  Web-Interface    : http://%s:%d", HOST, PORT)
    log.info("  API-Docs         : http://%s:%d/docs", HOST, PORT)
    log.info("═" * 60)

    uvicorn.run(
        "server:app",
        host      = HOST,
        port      = PORT,
        log_level = LOG_LEVEL,
        reload    = False,
    )
