"""
TPF2 Real-Time Telemetry Server
================================
FastAPI + WebSocket server that watches telemetry.json and pushes live
updates to connected browsers.

Start:  python server.py
Open:   http://localhost:8765
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
import time
from contextlib import asynccontextmanager
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
# Configuration
# ─────────────────────────────────────────────────────────────────────────────

# Path to telemetry.json (default: same directory as the mod)
# Can be overridden via environment variable TPF2_TELEMETRY_PATH or as a
# command-line argument.
DEFAULT_TELEMETRY_PATH = Path(__file__).parent.parent / "telemetry.json"

HOST        = os.environ.get("TPF2_HOST", "127.0.0.1")
PORT        = int(os.environ.get("TPF2_PORT", "8765"))
LOG_LEVEL   = os.environ.get("TPF2_LOG_LEVEL", "info")

# Override path via argument or env var
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
# Data store (in-memory, thread-safe via asyncio.Lock)
# ─────────────────────────────────────────────────────────────────────────────

class TelemetryStore:
    """Holds the current telemetry state and notifies listeners."""

    def __init__(self) -> None:
        self._data: dict[str, Any] = {}
        self._lock = asyncio.Lock()
        self._listeners: list[asyncio.Queue] = []
        self.last_update: float = 0.0
        self.file_mtime: float = 0.0

    async def update(self, raw: str) -> None:
        """Parses a JSON string and notifies all WebSocket clients."""
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as exc:
            log.warning("Invalid JSON: %s", exc)
            return

        # Inject a server-side Unix timestamp when the game doesn't supply one.
        # The TPF2 Lua sandbox has no os.time(), so write_count is used instead.
        if not data.get("timestamp"):
            data["timestamp"] = int(time.time())

        broadcast_raw = json.dumps(data)

        async with self._lock:
            self._data = data
            self.last_update = time.time()

        # Fill all waiting queues (WebSocket handlers)
        for q in list(self._listeners):
            try:
                q.put_nowait(broadcast_raw)
            except asyncio.QueueFull:
                pass  # Client too slow – skip current frame

        log.info(
            "Update: %d vehicles | %d lines | %d stations",
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
# Watchdog: watch file for changes
# ─────────────────────────────────────────────────────────────────────────────

class TelemetryFileHandler(FileSystemEventHandler):
    """Reacts to changes in telemetry.json."""

    def __init__(self, path: Path, loop: asyncio.AbstractEventLoop) -> None:
        self._path = path.resolve()
        self._loop = loop

    def on_modified(self, event: FileModifiedEvent) -> None:
        if Path(event.src_path).resolve() != self._path:
            return
        # Read file asynchronously (in the asyncio thread)
        asyncio.run_coroutine_threadsafe(self._reload(), self._loop)

    async def _reload(self) -> None:
        """Reads telemetry.json and updates the store."""
        try:
            mtime = self._path.stat().st_mtime
            if mtime == store.file_mtime:
                return  # No real change
            store.file_mtime = mtime

            # Wait briefly in case the file is still being written
            await asyncio.sleep(0.05)

            content = self._path.read_text(encoding="utf-8")
            if not content.strip():
                return
            await store.update(content)
        except (OSError, PermissionError) as exc:
            log.debug("File read error (ignored): %s", exc)


async def start_watchdog(loop: asyncio.AbstractEventLoop) -> None:
    """Starts the watchdog observer in a separate thread."""
    watch_dir = TELEMETRY_PATH.parent
    if not watch_dir.exists():
        log.warning("Watch directory does not exist: %s", watch_dir)
        return

    handler  = TelemetryFileHandler(TELEMETRY_PATH, loop)
    observer = Observer()
    observer.schedule(handler, str(watch_dir), recursive=False)
    observer.start()
    log.info("Watching: %s", TELEMETRY_PATH)

    # Initial read on startup
    if TELEMETRY_PATH.exists():
        try:
            content = TELEMETRY_PATH.read_text(encoding="utf-8")
            if content.strip():
                await store.update(content)
        except OSError:
            pass

    # Observer runs in the background – just wait for shutdown here
    try:
        while True:
            await asyncio.sleep(1)
            if not observer.is_alive():
                log.warning("Watchdog observer died – restarting")
                observer.start()
    finally:
        observer.stop()
        observer.join()


# ─────────────────────────────────────────────────────────────────────────────
# FastAPI App
# ─────────────────────────────────────────────────────────────────────────────

APP_VERSION = "1.1.0"

@asynccontextmanager
async def lifespan(app: FastAPI):
    loop = asyncio.get_running_loop()
    asyncio.create_task(start_watchdog(loop))
    log.info("Server started on http://%s:%d", HOST, PORT)
    yield


app = FastAPI(
    title       = "TPF2 Real-Time Telemetry",
    description = "Shows live data of all trains from Transport Fever 2",
    version     = APP_VERSION,
    lifespan    = lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins     = ["*"],
    allow_credentials = True,
    allow_methods     = ["*"],
    allow_headers     = ["*"],
)

# Static files (HTML/CSS/JS)
_static_dir = Path(__file__).parent / "static"
if _static_dir.exists():
    app.mount("/static", StaticFiles(directory=str(_static_dir)), name="static")


# ─── REST endpoints ──────────────────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
async def root() -> HTMLResponse:
    """Serves the main web UI."""
    index = _static_dir / "index.html"
    if index.exists():
        return HTMLResponse(content=index.read_text(encoding="utf-8"))
    return HTMLResponse("<h1>TPF2 Telemetry</h1><p>static/index.html not found.</p>")


@app.get("/api/telemetry", response_class=JSONResponse)
async def api_telemetry() -> JSONResponse:
    """Returns the current telemetry snapshot as JSON."""
    data = await store.get()
    return JSONResponse(content=data)


@app.get("/api/vehicles", response_class=JSONResponse)
async def api_vehicles() -> JSONResponse:
    """Returns only the vehicle list."""
    data = await store.get()
    return JSONResponse(content=data.get("vehicles", []))


@app.get("/api/lines", response_class=JSONResponse)
async def api_lines() -> JSONResponse:
    """Returns all lines."""
    data = await store.get()
    return JSONResponse(content=data.get("lines", []))


@app.get("/api/stations", response_class=JSONResponse)
async def api_stations() -> JSONResponse:
    """Returns all stations."""
    data = await store.get()
    return JSONResponse(content=data.get("stations", []))


@app.get("/api/stats", response_class=JSONResponse)
async def api_stats() -> JSONResponse:
    """Returns summary statistics."""
    data = await store.get()
    return JSONResponse(content={
        "stats":       data.get("stats", {}),
        "last_update": store.last_update,
        "game_time":   data.get("game_time"),
        "timestamp":   data.get("timestamp"),
    })


@app.get("/api/health", response_class=JSONResponse)
async def api_health() -> JSONResponse:
    """Health-check endpoint."""
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
    WebSocket connection for live updates.
    Sends the full snapshot on every telemetry.json change.
    """
    await ws.accept()
    log.info("WebSocket connected: %s", ws.client)

    queue = store.subscribe()

    # Send current state immediately
    current = await store.get()
    if current:
        try:
            await ws.send_text(json.dumps(current))
        except Exception:
            pass

    try:
        while True:
            try:
                # Wait for the next update (30 s timeout for keepalive)
                raw = await asyncio.wait_for(queue.get(), timeout=30.0)
                await ws.send_text(raw)
            except asyncio.TimeoutError:
                # Keepalive ping
                try:
                    await ws.send_text(json.dumps({"type": "ping", "ts": time.time()}))
                except Exception:
                    break
    except WebSocketDisconnect:
        log.info("WebSocket disconnected: %s", ws.client)
    except Exception as exc:
        log.debug("WebSocket error: %s", exc)
    finally:
        store.unsubscribe(queue)


# ─────────────────────────────────────────────────────────────────────────────
# Entry point
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    log.info("═" * 60)
    log.info("  TPF2 Real-Time Telemetry Server v%s", APP_VERSION)
    log.info("  Telemetry file : %s", TELEMETRY_PATH)
    log.info("  Web interface  : http://%s:%d", HOST, PORT)
    log.info("  API docs       : http://%s:%d/docs", HOST, PORT)
    log.info("═" * 60)

    uvicorn.run(
        "server:app",
        host      = HOST,
        port      = PORT,
        log_level = LOG_LEVEL,
        reload    = False,
    )
