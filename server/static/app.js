/**
 * TPF2 Real-Time Telemetry – Frontend (app.js)
 *
 * Works in tandem with Alpine.js (store) and HTMX (REST polling fallback):
 *
 *  Alpine store  → owns reactive UI state (stats, connState, filterType, …)
 *  HTMX          → fires /api/telemetry on load + every 5 s as WS fallback
 *  app.js        → WebSocket, table rendering, filtering/sorting, CSV, i18n
 *
 * Public window globals exposed for Alpine / HTMX callbacks:
 *  window.tpf2Render      – re-render vehicle table
 *  window.tpf2T           – translation function
 *  window.tpf2ToggleLang  – toggle DE / EN
 *  window.tpf2CloseDetail – close detail panel
 *  window.tpf2HandleData  – process a raw telemetry payload object
 *  window.tpf2HandleHtmx  – HTMX after-request callback
 *  window.tpf2WsConnected – boolean, true while WS is open
 */

"use strict";

// ─── Motion One (CDN) – graceful fallback if offline ─────────────────────────
let _animate = null;
let _stagger = null;
try {
  const m = await import("https://cdn.jsdelivr.net/npm/motion@11/+esm");
  _animate = m.animate;
  _stagger = m.stagger;
} catch (_) { /* offline – animations disabled */ }

const doAnimate = (...args) => { if (_animate) _animate(...args); };

// Named easing presets for Motion One
const EASING_SPRING    = [0.34, 1.56, 0.64, 1]; // spring overshoot
const EASING_OUT_CUBIC = [0.33, 1, 0.68, 1];    // ease-out-cubic

// ─── Alpine store accessor ─────────────────────────────────────────────────
// Alpine is deferred and guaranteed to be initialized before this module runs.
const appStore = () => window.Alpine?.store('app');

// ─── Localisation strings ─────────────────────────────────────────────────────
const STRINGS = {
  de: {
    subtitle:          "Echtzeit-Fahrplan",
    connecting:        "Verbinde…",
    connected:         "Live",
    disconnected:      "Getrennt",
    vehicles:          "Fahrzeuge",
    passengers:        "Passagiere gesamt",
    lines:             "Linien",
    stations:          "Stationen",
    searchPlaceholder: "🔍  Fahrzeug / Linie / Station suchen…",
    all:               "Alle",
    train:             "🚆 Zug",
    bus:               "🚌 Bus",
    tram:              "🚋 Tram",
    ship:              "⛴ Schiff",
    plane:             "✈ Flugzeug",
    sortName:          "Sortierung: Name",
    sortSpeed:         "Sortierung: Geschwindigkeit",
    sortPassengers:    "Sortierung: Passagiere",
    sortType:          "Sortierung: Typ",
    sortState:         "Sortierung: Zustand",
    sortLastStop:      "Sortierung: Letzter Halt",
    sortNextStop:      "Sortierung: Nächster Halt",
    sortOccupancy:     "Sortierung: Auslastung",
    sortLine:          "Sortierung: Linie",
    colVehicle:        "Fahrzeug",
    colType:           "Typ",
    colLine:           "Linie",
    colState:          "Zustand",
    colSpeed:          "Geschw.",
    colLastStop:       "Letzter Halt",
    colNextStop:       "Nächster Halt",
    colPax:            "Pax",
    colOccupancy:      "Auslastung",
    filterPlaceholder: "Filter…",
    waitingForData:    "Warte auf Daten…",
    noResults:         "Keine Ergebnisse für diese Filtereinstellungen.",
    waitingForVehicles:"Warte auf Fahrzeugdaten…",
    lastUpdated:       "Aktualisiert: ",
    justNow:           "gerade eben",
    secondsAgo:        "vor {n}s",
    minutesAgo:        "vor {n}min",
    typeRail:          "🚆 Zug",
    typeRoad:          "🚌 Bus",
    typeTram:          "🚋 Tram",
    typeWater:         "⛴ Schiff",
    typeAir:           "✈ Flug",
    stateMoving:       "Fährt",
    stateAtStop:       "Am Halt",
    stateStopped:      "Gestoppt",
    stateLoading:      "Beladung",
    stateUnloading:    "Entladung",
    stateWaiting:      "Wartet",
    dpID:              "ID",
    dpType:            "Typ",
    dpLine:            "Linie",
    dpState:           "Zustand",
    dpSpeed:           "Geschwindigkeit",
    dpDirection:       "Richtung",
    dpForward:         "→ vorwärts",
    dpBackward:        "← rückwärts",
    dpPassengers:      "Passagiere",
    dpCargo:           "Fracht",
    dpLastStop:        "Letzter Halt",
    dpNextStop:        "Nächster Halt",
    dpPosX:            "Position X",
    dpPosY:            "Position Y",
    dpPosZ:            "Position Z",
    exportCsv:         "CSV Export",
    apiDocs:           "API-Docs",
    rawJson:           "Raw JSON",
    tabList:           "Listenansicht",
    tabMap:            "Kartenansicht",
    filterActive:      "Filter aktiv: {v}",
    filterClick:       "Zum Filterfeld klicken",
  },
  en: {
    subtitle:          "Real-Time Schedule",
    connecting:        "Connecting…",
    connected:         "Live",
    disconnected:      "Disconnected",
    vehicles:          "Vehicles",
    passengers:        "Total Passengers",
    lines:             "Lines",
    stations:          "Stations",
    searchPlaceholder: "🔍  Search vehicle / line / station…",
    all:               "All",
    train:             "🚆 Train",
    bus:               "🚌 Bus",
    tram:              "🚋 Tram",
    ship:              "⛴ Ship",
    plane:             "✈ Plane",
    sortName:          "Sort: Name",
    sortSpeed:         "Sort: Speed",
    sortPassengers:    "Sort: Passengers",
    sortType:          "Sort: Type",
    sortState:         "Sort: State",
    sortLastStop:      "Sort: Last Stop",
    sortNextStop:      "Sort: Next Stop",
    sortOccupancy:     "Sort: Occupancy",
    sortLine:          "Sort: Line",
    colVehicle:        "Vehicle",
    colType:           "Type",
    colLine:           "Line",
    colState:          "State",
    colSpeed:          "Speed",
    colLastStop:       "Last Stop",
    colNextStop:       "Next Stop",
    colPax:            "Pax",
    colOccupancy:      "Occupancy",
    filterPlaceholder: "Filter…",
    waitingForData:    "Waiting for data…",
    noResults:         "No results for the current filter settings.",
    waitingForVehicles:"Waiting for vehicle data…",
    lastUpdated:       "Updated: ",
    justNow:           "just now",
    secondsAgo:        "{n}s ago",
    minutesAgo:        "{n}min ago",
    typeRail:          "🚆 Train",
    typeRoad:          "🚌 Bus",
    typeTram:          "🚋 Tram",
    typeWater:         "⛴ Ship",
    typeAir:           "✈ Plane",
    stateMoving:       "Moving",
    stateAtStop:       "At stop",
    stateStopped:      "Stopped",
    stateLoading:      "Loading",
    stateUnloading:    "Unloading",
    stateWaiting:      "Waiting",
    dpID:              "ID",
    dpType:            "Type",
    dpLine:            "Line",
    dpState:           "State",
    dpSpeed:           "Speed",
    dpDirection:       "Direction",
    dpForward:         "→ forward",
    dpBackward:        "← backward",
    dpPassengers:      "Passengers",
    dpCargo:           "Cargo",
    dpLastStop:        "Last Stop",
    dpNextStop:        "Next Stop",
    dpPosX:            "Position X",
    dpPosY:            "Position Y",
    dpPosZ:            "Position Z",
    exportCsv:         "CSV Export",
    apiDocs:           "API Docs",
    rawJson:           "Raw JSON",
    tabList:           "List View",
    tabMap:            "Map View",
    filterActive:      "Filter active: {v}",
    filterClick:       "Click to focus filter",
  },
};

// ─── i18n helpers ─────────────────────────────────────────────────────────────
// _lang is kept in sync with Alpine store.app.lang
let _lang = appStore()?.lang ?? localStorage.getItem("tpf2_lang") ?? "de";

function t(key, vars) {
  let str = (STRINGS[_lang] || STRINGS.de)[key] || key;
  if (vars) for (const [k, v] of Object.entries(vars)) str = str.replace(`{${k}}`, v);
  return str;
}

function applyI18n() {
  document.querySelectorAll("[data-i18n]").forEach(el => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  document.documentElement.lang = _lang;
}

// Expose t() for Alpine inline expressions (conn-label text lookup)
window.tpf2T = t;

// ─── App config ───────────────────────────────────────────────────────────────
const WS_URL             = `ws://${location.host}/ws`;
const RECONNECT_DELAY_MS = 3000;

// ─── State ────────────────────────────────────────────────────────────────────
let _state = { vehicles: [], lines: [], stations: [], stats: {}, game_time: null, timestamp: null, paths: [], signals: [], tracks: [] };
let _selectedVid   = null;
let _ws            = null;
let _reconnecting  = false;
let _firstRender   = true;
let _stationById   = new Map();
let _lineById      = new Map();
let _stopNameById  = new Map(); // covers both station_id and raw_stop_id from line stops
let _columnFilters = { name:"", type:"", line_name:"", state:"", last_stop_name:"", next_stop_name:"" };
let _activeView    = "list";
let _lastMapData   = null;
const MAP_ZOOM_MIN = 0.5;
const MAP_ZOOM_MAX = 8;
let _mapHitTargets = [];
let _mapHover      = null;
const _mapUi = {
  showStationLabels: true,
  showVehicleLabels: false,
  spreadOverlaps: true,
};
let _mapViewState  = {
  zoom: 1,
  panX: 0,
  panY: 0,
  dragging: false,
  pointerId: null,
  lastX: 0,
  lastY: 0,
};

// WS connection state (read by tpf2HandleHtmx to avoid double-processing)
window.tpf2WsConnected = false;

// ─── DOM references ───────────────────────────────────────────────────────────
const connLabel     = document.getElementById("conn-label");
const tbody         = document.getElementById("vehicle-tbody");
const detailPanel   = document.getElementById("detail-panel");
const dpName        = document.getElementById("dp-name");
const dpGrid        = document.getElementById("dp-grid");
const searchInput   = document.getElementById("search-input");
const viewTabs      = document.querySelectorAll("#view-tabs .view-tab");
const listView      = document.getElementById("list-view");
const mapView       = document.getElementById("map-view");
const mapCanvas     = document.getElementById("telemetryMap");
const mapCtx        = mapCanvas ? mapCanvas.getContext("2d") : null;
const mapTooltip    = document.getElementById("map-tooltip");
const mapFitBtn     = document.getElementById("map-fit-btn");
const mapResetBtn   = document.getElementById("map-reset-btn");
const mapToggleStationLabels = document.getElementById("map-toggle-station-labels");
const mapToggleVehicleLabels = document.getElementById("map-toggle-vehicle-labels");
const mapToggleSpread        = document.getElementById("map-toggle-spread");

// ─── Utility ──────────────────────────────────────────────────────────────────
const esc = s => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

function fmtSpeed(kmh) {
  if (kmh === 0 || kmh == null) return `<span class="speed-cell speed-slow">0 km/h</span>`;
  const cls = kmh > 180 ? "speed-fast" : kmh > 60 ? "speed-medium" : "speed-slow";
  return `<span class="speed-cell ${cls}">${kmh} km/h</span>`;
}

function fmtType(type) {
  const labels = {
    RAIL: t("typeRail"), ROAD: t("typeRoad"), TRAM: t("typeTram"),
    WATER: t("typeWater"), AIR: t("typeAir"),
  };
  return `<span class="type-badge type-${type}">${esc(labels[type] || type)}</span>`;
}

function fmtState(state) {
  const raw = String(state || "UNKNOWN").toUpperCase();
  const map = {
    IN_TRANSIT:  { lk:"stateMoving",    cls:"moving"  },
    EN_ROUTE:    { lk:"stateMoving",    cls:"moving"  },
    AT_TERMINAL: { lk:"stateAtStop",    cls:"stop"    },
    STOPPED:     { lk:"stateStopped",   cls:"stopped" },
    LOADING:     { lk:"stateLoading",   cls:"service" },
    UNLOADING:   { lk:"stateUnloading", cls:"service" },
    WAITING:     { lk:"stateWaiting",   cls:"idle"    },
  };
  const m = map[raw];
  return `<span class="state-badge state-${m ? m.cls : "unknown"}">${esc(m ? t(m.lk) : (raw||"UNKNOWN"))}</span>`;
}

function fmtOccupancy(pax, cap) {
  if (!cap) return `<span class="pax-cell">–</span>`;
  const pct = Math.min(100, Math.round(pax / cap * 100));
  const cls = pct >= 80 ? "occ-high" : pct >= 50 ? "occ-mid" : "occ-low";
  return `<div class="occ-bar-wrap" title="${pax}/${cap} (${pct}%)"><div class="occ-bar ${cls}" style="width:${pct}%"></div></div>`;
}

function fmtPax(pax, cap) {
  if (!cap) return `<span class="pax-cell">${pax}</span>`;
  return `<span class="pax-cell">${pax} / ${cap}</span>`;
}

function timeAgo(ts) {
  if (!ts) return "–";
  const delta = Math.round(Date.now() / 1000 - ts);
  if (delta < 5)  return t("justNow");
  if (delta < 60) return t("secondsAgo", { n: delta });
  return t("minutesAgo", { n: Math.round(delta / 60) });
}

function fmtGameTime(gt) {
  if (!gt) return null;
  if (typeof gt === "number") return String(gt);
  if (typeof gt === "object") {
    const d = gt.date || gt;
    if (d.year != null) {
      const mo = String(d.month||1).padStart(2,"0");
      const dy = String(d.day||1).padStart(2,"0");
      if (d.hour != null || d.minute != null)
        return `🕐 ${d.year}-${mo}-${dy} ${String(d.hour||0).padStart(2,"0")}:${String(d.minute||0).padStart(2,"0")}`;
      return `📅 ${dy}.${mo}.${d.year}`;
    }
  }
  return JSON.stringify(gt);
}

// ─── Map helpers ──────────────────────────────────────────────────────────────
function normalizePoint(pt) {
  if (!pt) return null;
  if (Array.isArray(pt)) {
    const x = Number(pt[0]);
    const y = Number(pt[1]);
    if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
  }
  if (typeof pt === "object") {
    const x = Number(pt.x ?? pt[0]);
    const y = Number(pt.y ?? pt[1]);
    if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
  }
  return null;
}

function getMapStopNameOverrides(data) {
  const names = new Map();
  const addName = (id, name) => {
    const n = String(name || "").trim();
    const nid = Number(id || 0);
    if (!nid || !n || isPlaceholderName(n)) return;
    names.set(nid, n);
  };

  for (const l of data.lines || []) {
    for (const s of l.stops || []) {
      addName(s.station_id, s.name);
      addName(s.raw_stop_id, s.name);
    }
  }
  for (const v of data.vehicles || []) {
    addName(v.last_stop_id, v.last_stop_name);
    addName(v.next_stop_id, v.next_stop_name);
  }

  // Fallback for cases where line stops only expose raw stop ids that do not
  // equal station ids: infer station name by matching stop index to line-path
  // point and assigning the nearest station at that world position.
  const pathByLineId = new Map();
  for (const p of data.paths || []) pathByLineId.set(Number(p.line_id || 0), p);

  const stations = data.stations || [];
  const nearestStationId = (pt) => {
    const src = normalizePoint(pt);
    if (!src) return 0;
    let bestId = 0;
    let bestD2 = Infinity;
    for (const st of stations) {
      const sp = normalizePoint(st.pos);
      if (!sp) continue;
      const dx = sp.x - src.x;
      const dy = sp.y - src.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        bestId = Number(st.id || 0);
      }
    }
    // world-space threshold (meters-ish) to avoid wrong remaps
    return bestD2 <= 200 * 200 ? bestId : 0;
  };

  for (const line of data.lines || []) {
    const path = pathByLineId.get(Number(line.id || 0));
    if (!path || !Array.isArray(path.points)) continue;
    const stops = line.stops || [];
    for (let i = 0; i < stops.length && i < path.points.length; i++) {
      const stop = stops[i] || {};
      const stopName = String(stop.name || "").trim();
      if (!stopName || isPlaceholderName(stopName)) continue;

      const sid = nearestStationId(path.points[i]);
      if (!sid) continue;

      // Prefer explicit station-id mapping if available; otherwise nearest map
      // match upgrades stale station labels after in-game renames.
      if (!names.has(sid) || names.get(sid) !== stopName) names.set(sid, stopName);
    }
  }

  return names;
}

function nearestPointOnSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const denom = dx * dx + dy * dy;
  if (denom <= 1e-8) {
    const ddx = px - ax;
    const ddy = py - ay;
    return { x: ax, y: ay, d2: ddx * ddx + ddy * ddy };
  }
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / denom));
  const x = ax + t * dx;
  const y = ay + t * dy;
  const ddx = px - x;
  const ddy = py - y;
  return { x, y, d2: ddx * ddx + ddy * ddy };
}

function snapPointToPolyline(pt, polyline) {
  if (!pt || !Array.isArray(polyline) || polyline.length < 2) return null;
  let best = null;
  for (let i = 1; i < polyline.length; i++) {
    const a = polyline[i - 1];
    const b = polyline[i];
    const cand = nearestPointOnSegment(pt.x, pt.y, a.x, a.y, b.x, b.y);
    if (!best || cand.d2 < best.d2) best = cand;
  }
  return best;
}

function clusterByDistance(items, thresholdPx) {
  const clusters = [];
  for (const item of items) {
    let best = null;
    let bestD2 = Infinity;
    for (const c of clusters) {
      const dx = item.x - c.cx;
      const dy = item.y - c.cy;
      const d2 = dx * dx + dy * dy;
      if (d2 <= thresholdPx * thresholdPx && d2 < bestD2) {
        best = c;
        bestD2 = d2;
      }
    }
    if (!best) {
      clusters.push({ items: [item], cx: item.x, cy: item.y });
    } else {
      best.items.push(item);
      const n = best.items.length;
      best.cx = ((best.cx * (n - 1)) + item.x) / n;
      best.cy = ((best.cy * (n - 1)) + item.y) / n;
    }
  }
  return clusters;
}

function resolveStationRenderItems(data, project, stopNameOverrides) {
  const raw = [];
  for (const st of data.stations || []) {
    const p = project(st.pos);
    if (!p) continue;
    const sid = Number(st.id || 0);
    const override = stopNameOverrides.get(sid);
    raw.push({
      x: p.x,
      y: p.y,
      id: sid,
      baseLabel: String(st.name || "").trim(),
      label: String(override || st.name || "").trim(),
      hasOverride: Boolean(override),
    });
  }

  const clusters = clusterByDistance(raw, 12);
  const resolved = [];
  for (const c of clusters) {
    const labelScore = new Map();
    for (const it of c.items) {
      const lbl = it.label || it.baseLabel;
      if (!lbl) continue;
      const base = labelScore.get(lbl) || 0;
      labelScore.set(lbl, base + (it.hasOverride ? 100 : 1));
    }
    let bestLabel = "";
    let bestScore = -Infinity;
    for (const [lbl, score] of labelScore.entries()) {
      if (score > bestScore) {
        bestScore = score;
        bestLabel = lbl;
      }
    }

    resolved.push({
      x: c.cx,
      y: c.cy,
      label: bestLabel,
      count: c.items.length,
    });
  }
  return resolved;
}

function spreadVehicleMarkers(markers) {
  if (!markers.length) return { markers, clusters: [] };
  const clusters = clusterByDistance(markers, 10);
  for (const c of clusters) {
    if (c.items.length <= 1) {
      c.items[0].drawX = c.items[0].x;
      c.items[0].drawY = c.items[0].y;
      continue;
    }

    const radius = 8 + Math.min(14, c.items.length * 1.5);
    const ordered = [...c.items].sort((a, b) => String(a.id).localeCompare(String(b.id)));
    for (let i = 0; i < ordered.length; i++) {
      const a = (Math.PI * 2 * i) / ordered.length;
      ordered[i].drawX = c.cx + Math.cos(a) * radius;
      ordered[i].drawY = c.cy + Math.sin(a) * radius;
    }
  }
  return { markers, clusters };
}

function buildInferredSignals(data) {
  const keyOf = (p) => `${Math.round(p.x)}:${Math.round(p.y)}`;
  const points = new Map();

  for (const path of data.paths || []) {
    const seenInPath = new Set();
    for (const pt of path.points || []) {
      const p = normalizePoint(pt);
      if (!p) continue;
      const k = keyOf(p);
      if (seenInPath.has(k)) continue;
      seenInPath.add(k);
      const row = points.get(k) || { x: p.x, y: p.y, n: 0 };
      row.n += 1;
      points.set(k, row);
    }
  }

  const inferred = [];
  for (const row of points.values()) {
    if (row.n >= 3) {
      inferred.push({ id: -inferred.length - 1, pos: { x: row.x, y: row.y, z: 0 }, state: null, inferred: true });
    }
  }
  return inferred;
}

function hideMapTooltip() {
  if (!mapTooltip) return;
  mapTooltip.classList.add("hidden");
}

function showMapTooltip(x, y, html) {
  if (!mapTooltip || !mapCanvas || !mapView || !html) return;
  const rect = mapCanvas.getBoundingClientRect();
  mapTooltip.innerHTML = html;
  mapTooltip.classList.remove("hidden");

  const left = Math.max(8, Math.min(rect.width - 260, x + 12));
  const top  = Math.max(8, Math.min(rect.height - 80, y + 12));
  mapTooltip.style.left = `${left}px`;
  mapTooltip.style.top  = `${top}px`;
}

function mapLabelCanPlace(placed, x, y, w, h) {
  for (const b of placed) {
    const noOverlap = x + w < b.x || b.x + b.w < x || y + h < b.y || b.y + b.h < y;
    if (!noOverlap) return false;
  }
  placed.push({ x, y, w, h });
  return true;
}

function describeMapTarget(target) {
  if (!target) return "";
  if (target.kind === "vehicle") {
    return `<strong>${esc(target.name || "Vehicle")}</strong><br>${esc(target.line_name || "")}`;
  }
  if (target.kind === "station") {
    return `<strong>${esc(target.label || "Station")}</strong>${target.count > 1 ? `<br>${target.count} stops` : ""}`;
  }
  if (target.kind === "signal") {
    if (target.inferred) return `<strong>Inferred signal/junction</strong>`;
    return `<strong>Signal</strong><br>${Number(target.state) === 1 ? "Proceed" : "Stop"}`;
  }
  if (target.kind === "cluster") {
    return `<strong>${target.count} vehicles</strong>`;
  }
  return "";
}

function computeBounds(data) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const consider = (pt) => {
    const p = normalizePoint(pt);
    if (!p) return;
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  };

  (data.stations || []).forEach(s => consider(s.pos));
  (data.vehicles || []).forEach(v => consider(v.position));
  (data.signals  || []).forEach(s => consider(s.pos));
  (data.paths    || []).forEach(p => (p.points || []).forEach(consider));
  (data.tracks   || []).forEach(t => (t.points || []).forEach(consider));

  if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) return null;

  const spanX = Math.max(maxX - minX, 1);
  const spanY = Math.max(maxY - minY, 1);
  const pad   = 0.1 * Math.max(spanX, spanY);

  return {
    minX: minX - pad,
    maxX: maxX + pad,
    minY: minY - pad,
    maxY: maxY + pad,
  };
}

function resizeCanvasToDisplay() {
  if (!mapCanvas || !mapCtx) return { width: 0, height: 0 };
  const rect = mapCanvas.getBoundingClientRect();
  const cssWidth  = Math.max(1, Math.floor(rect.width));
  const cssHeight = Math.max(1, Math.floor(rect.height));
  const dpr = window.devicePixelRatio || 1;

  const width  = Math.floor(cssWidth * dpr);
  const height = Math.floor(cssHeight * dpr);

  if (mapCanvas.width !== width || mapCanvas.height !== height) {
    mapCanvas.width  = width;
    mapCanvas.height = height;
  }
  mapCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { width: cssWidth, height: cssHeight };
}

function drawMap(data) {
  _lastMapData = data;
  if (_activeView !== "map" || !mapCtx || !mapCanvas || !data) return;
  _mapHitTargets = [];

  const size   = resizeCanvasToDisplay();
  const width  = size.width;
  const height = size.height;

  mapCtx.fillStyle = "#1e1e1e";
  mapCtx.fillRect(0, 0, width, height);

  // subtle grid for orientation
  mapCtx.strokeStyle = "rgba(148,163,184,.08)";
  mapCtx.lineWidth = 1;
  const grid = 80;
  for (let x = 0; x < width; x += grid) {
    mapCtx.beginPath();
    mapCtx.moveTo(x, 0);
    mapCtx.lineTo(x, height);
    mapCtx.stroke();
  }
  for (let y = 0; y < height; y += grid) {
    mapCtx.beginPath();
    mapCtx.moveTo(0, y);
    mapCtx.lineTo(width, y);
    mapCtx.stroke();
  }

  const bounds = computeBounds(data);
  if (!bounds) return;

  const spanX  = bounds.maxX - bounds.minX;
  const spanY  = bounds.maxY - bounds.minY;
  const scale  = Math.min(width / spanX, height / spanY);
  const offX   = (width  - spanX * scale) / 2;
  const offY   = (height - spanY * scale) / 2;
  const project = (pt) => {
    const p = normalizePoint(pt);
    if (!p) return null;
    const baseX = offX + (p.x - bounds.minX) * scale;
    const baseY = height - (offY + (p.y - bounds.minY) * scale);
    return {
      x: baseX * _mapViewState.zoom + _mapViewState.panX,
      y: baseY * _mapViewState.zoom + _mapViewState.panY,
    };
  };

  // ── Track edges (real rail geometry) ──────────────────────────
  const trackEdges = data.tracks || [];
  if (trackEdges.length > 0) {
    for (const edge of trackEdges) {
      const pts = (edge.points || []).map(project).filter(Boolean);
      if (pts.length < 2) continue;
      mapCtx.beginPath();
      mapCtx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) mapCtx.lineTo(pts[i].x, pts[i].y);
      const isRail = (edge.type === "RAIL");
      mapCtx.strokeStyle = isRail ? "rgba(148,163,184,0.35)" : "rgba(234,179,8,0.25)";
      mapCtx.lineWidth   = isRail ? 1.5 : 1;
      mapCtx.stroke();
    }
  }

  const lineWorldPaths = new Map();

  // Paths (line routes – station-to-station)
  mapCtx.lineWidth   = 2;
  mapCtx.strokeStyle = "#444444";
  for (const path of data.paths || []) {
    const worldPts = [];
    for (const p of path.points || []) {
      const wp = normalizePoint(p);
      if (wp) worldPts.push(wp);
    }
    if (worldPts.length > 1) lineWorldPaths.set(Number(path.line_id || 0), worldPts);

    const pts = [];
    for (const p of path.points || []) {
      const pr = project(p);
      if (pr) pts.push(pr);
    }
    if (pts.length > 1) {
      mapCtx.beginPath();
      mapCtx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) mapCtx.lineTo(pts[i].x, pts[i].y);
      mapCtx.stroke();
    }
  }

  const signalsToDraw = (data.signals && data.signals.length > 0)
    ? data.signals
    : buildInferredSignals(data);

  // Signals
  for (const s of signalsToDraw) {
    const pr = project(s.pos);
    if (!pr) continue;
    mapCtx.beginPath();
    // Signalzustand: 1 = Fahrt/Grün, 0 = Halt/Rot, null = inferred/unknown
    mapCtx.fillStyle = s.state == null ? "#f59e0b" : (Number(s.state) === 1 ? "#00ff00" : "#ff0000");
    mapCtx.arc(pr.x, pr.y, 3, 0, Math.PI * 2);
    mapCtx.fill();
    mapCtx.beginPath();
    mapCtx.strokeStyle = "#111827";
    mapCtx.lineWidth = 1;
    mapCtx.arc(pr.x, pr.y, 4.5, 0, Math.PI * 2);
    mapCtx.stroke();

    _mapHitTargets.push({ kind: "signal", id: s.id, x: pr.x, y: pr.y, r: 7, state: s.state, inferred: Boolean(s.inferred) });
  }

  const stopNameOverrides = getMapStopNameOverrides(data);

  // Stations (clustered to avoid duplicate labels at the same location)
  const stationRenderItems = resolveStationRenderItems(data, project, stopNameOverrides);
  mapCtx.font = "10px 'Inter', system-ui, sans-serif";
  mapCtx.textBaseline = "middle";
  mapCtx.textAlign = "left";
  const placedLabels = [];
  for (const st of stationRenderItems) {
    mapCtx.fillStyle = "#d1d5db";
    mapCtx.fillRect(st.x - 3, st.y - 3, 6, 6);

    _mapHitTargets.push({ kind: "station", id: `${Math.round(st.x)}:${Math.round(st.y)}`, x: st.x, y: st.y, r: 8, label: st.label, count: st.count });

    if (_mapUi.showStationLabels && st.label) {
      const tx = st.x + 6;
      const ty = st.y;
      const textW = mapCtx.measureText(st.label).width + (st.count > 1 ? 26 : 0);
      if (!mapLabelCanPlace(placedLabels, tx - 1, ty - 6, textW + 2, 12)) continue;

      mapCtx.fillStyle = "#ffffff";
      mapCtx.fillText(st.label, tx, ty);
      if (st.count > 1) {
        mapCtx.fillStyle = "#9ca3af";
        mapCtx.fillText(`(${st.count})`, tx + mapCtx.measureText(st.label).width + 4, ty);
      }
    }
  }

  // Vehicles last (spread overlapping markers for crowded stations)
  const vehicleMarkers = [];
  for (const v of data.vehicles || []) {
    let worldPos = normalizePoint(v.position);
    if (!worldPos) continue;
    const lineId = Number(v.line_id || 0);
    const poly = lineWorldPaths.get(lineId);
    if (poly && poly.length > 1) {
      const snapped = snapPointToPolyline(worldPos, poly);
      if (snapped) worldPos = { x: snapped.x, y: snapped.y };
    }

    const pr = project(worldPos);
    if (!pr) continue;

    vehicleMarkers.push({
      id: v.id,
      name: v.name,
      line_name: v.line_name,
      type: getVehicleType(v),
      x: pr.x,
      y: pr.y,
      drawX: pr.x,
      drawY: pr.y,
    });
  }

  const spread = _mapUi.spreadOverlaps
    ? spreadVehicleMarkers(vehicleMarkers)
    : { markers: vehicleMarkers, clusters: clusterByDistance(vehicleMarkers, 10) };

  mapCtx.font = "12px 'Inter', system-ui, sans-serif";
  mapCtx.textAlign = "left";
  const placedVehicleLabels = [];
  for (const v of spread.markers) {
    const color = v.type === "RAIL" ? "#ff6666" : v.type === "ROAD" ? "#3b82f6" : "#ffffff";
    const isHover = _mapHover && _mapHover.kind === "vehicle" && String(_mapHover.id) === String(v.id);
    mapCtx.beginPath();
    mapCtx.fillStyle = color;
    mapCtx.arc(v.drawX, v.drawY, isHover ? 5.8 : 4, 0, Math.PI * 2);
    mapCtx.fill();

    _mapHitTargets.push({ kind: "vehicle", id: v.id, x: v.drawX, y: v.drawY, r: 8, name: v.name, line_name: v.line_name });

    const showLabel = (isHover || (_mapUi.showVehicleLabels && _mapViewState.zoom >= 1.6));
    if (showLabel && v.name) {
      const tx = v.drawX + 7;
      const ty = v.drawY;
      const tw = mapCtx.measureText(v.name).width;
      if (!mapLabelCanPlace(placedVehicleLabels, tx - 1, ty - 7, tw + 2, 14)) continue;
      mapCtx.fillStyle = "#ffffff";
      mapCtx.fillText(v.name, tx, ty);
    }
  }

  // Cluster count hint for overlapping trains
  mapCtx.font = "10px 'Inter', system-ui, sans-serif";
  mapCtx.textAlign = "center";
  for (const c of spread.clusters) {
    if (c.items.length <= 1) continue;
    if (!_mapUi.spreadOverlaps) continue;
    mapCtx.fillStyle = "rgba(17,24,39,0.85)";
    mapCtx.beginPath();
    mapCtx.arc(c.cx, c.cy, 7, 0, Math.PI * 2);
    mapCtx.fill();
    mapCtx.fillStyle = "#ffffff";
    mapCtx.textAlign = "center";
    mapCtx.textBaseline = "middle";
    mapCtx.fillText(String(c.items.length), c.cx, c.cy + 0.5);

    _mapHitTargets.push({ kind: "cluster", id: `${Math.round(c.cx)}:${Math.round(c.cy)}`, x: c.cx, y: c.cy, r: 9, count: c.items.length });
  }
  mapCtx.textAlign = "left";
  mapCtx.textBaseline = "middle";
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function resetMapView() {
  _mapViewState.zoom = 1;
  _mapViewState.panX = 0;
  _mapViewState.panY = 0;
  if (_activeView === "map") drawMap(_lastMapData || _state);
}

function setMapDragging(dragging) {
  _mapViewState.dragging = dragging;
  mapCanvas?.classList.toggle("dragging", dragging);
}

function findMapTargetAt(x, y) {
  let best = null;
  let bestD2 = Infinity;
  for (const t of _mapHitTargets) {
    const dx = x - t.x;
    const dy = y - t.y;
    const d2 = dx * dx + dy * dy;
    const r = Number(t.r || 0);
    if (d2 <= r * r && d2 < bestD2) {
      best = t;
      bestD2 = d2;
    }
  }
  return best;
}

function fitMapView() {
  resetMapView();
}

if (mapToggleStationLabels) mapToggleStationLabels.checked = _mapUi.showStationLabels;
if (mapToggleVehicleLabels) mapToggleVehicleLabels.checked = _mapUi.showVehicleLabels;
if (mapToggleSpread)        mapToggleSpread.checked        = _mapUi.spreadOverlaps;

mapFitBtn?.addEventListener("click", () => {
  fitMapView();
});
mapResetBtn?.addEventListener("click", () => {
  resetMapView();
});
mapToggleStationLabels?.addEventListener("change", (e) => {
  _mapUi.showStationLabels = Boolean(e.target?.checked);
  drawMap(_lastMapData || _state);
});
mapToggleVehicleLabels?.addEventListener("change", (e) => {
  _mapUi.showVehicleLabels = Boolean(e.target?.checked);
  drawMap(_lastMapData || _state);
});
mapToggleSpread?.addEventListener("change", (e) => {
  _mapUi.spreadOverlaps = Boolean(e.target?.checked);
  drawMap(_lastMapData || _state);
});

if (mapCanvas) {
  mapCanvas.addEventListener("wheel", (e) => {
    if (_activeView !== "map") return;
    e.preventDefault();
    const rect = mapCanvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;

    const zoomFactor = e.deltaY < 0 ? 1.12 : 0.9;
    const nextZoom = clamp(_mapViewState.zoom * zoomFactor, MAP_ZOOM_MIN, MAP_ZOOM_MAX);
    if (nextZoom === _mapViewState.zoom) return;

    const logicalX = (cx - _mapViewState.panX) / _mapViewState.zoom;
    const logicalY = (cy - _mapViewState.panY) / _mapViewState.zoom;

    _mapViewState.zoom = nextZoom;
    _mapViewState.panX = cx - logicalX * nextZoom;
    _mapViewState.panY = cy - logicalY * nextZoom;

    drawMap(_lastMapData || _state);
  }, { passive: false });

  mapCanvas.addEventListener("pointerdown", (e) => {
    if (_activeView !== "map") return;
    if (e.button !== 0 && e.pointerType !== "touch") return;
    _mapViewState.pointerId = e.pointerId;
    _mapViewState.lastX = e.clientX;
    _mapViewState.lastY = e.clientY;
    setMapDragging(true);
    mapCanvas.setPointerCapture(e.pointerId);
  });

  mapCanvas.addEventListener("pointermove", (e) => {
    if (_activeView !== "map") return;

    if (_mapViewState.dragging) {
      if (_mapViewState.pointerId != null && e.pointerId !== _mapViewState.pointerId) return;

      const dx = e.clientX - _mapViewState.lastX;
      const dy = e.clientY - _mapViewState.lastY;
      _mapViewState.lastX = e.clientX;
      _mapViewState.lastY = e.clientY;
      _mapViewState.panX += dx;
      _mapViewState.panY += dy;

      drawMap(_lastMapData || _state);
      hideMapTooltip();
      return;
    }

    const rect = mapCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const hit = findMapTargetAt(x, y);
    _mapHover = hit || null;
    mapCanvas.classList.toggle("hovering", Boolean(hit));
    if (hit) showMapTooltip(x, y, describeMapTarget(hit));
    else hideMapTooltip();
    drawMap(_lastMapData || _state);
  });

  const endDrag = (e) => {
    if (_mapViewState.pointerId != null && e.pointerId != null && e.pointerId !== _mapViewState.pointerId) return;
    setMapDragging(false);
    _mapViewState.pointerId = null;
  };

  mapCanvas.addEventListener("pointerup", endDrag);
  mapCanvas.addEventListener("pointercancel", endDrag);
  mapCanvas.addEventListener("lostpointercapture", endDrag);
  mapCanvas.addEventListener("pointerleave", () => {
    _mapHover = null;
    mapCanvas.classList.remove("hovering");
    hideMapTooltip();
    if (_activeView === "map") drawMap(_lastMapData || _state);
  });
  mapCanvas.addEventListener("dblclick", () => resetMapView());
}

function setView(view) {
  _activeView = view === "map" ? "map" : "list";
  viewTabs.forEach(btn => btn.classList.toggle("active", (btn.dataset.view || "list") === _activeView));
  if (listView) listView.classList.toggle("hidden", _activeView !== "list");
  if (mapView)  mapView.classList.toggle("hidden", _activeView !== "map");
  if (_activeView !== "map") {
    _mapHover = null;
    hideMapTooltip();
    mapCanvas?.classList.remove("hovering");
  }
  if (_activeView === "map") {
    drawMap(_lastMapData || _state);
  }
}

if (viewTabs.length) {
  viewTabs.forEach(btn => btn.addEventListener("click", () => setView(btn.dataset.view || "list")));
}

function rebuildIndexes() {
  _stationById = new Map();
  for (const s of (_state.stations || [])) if (s?.id != null) _stationById.set(Number(s.id), s.name || "");
  _lineById = new Map();
  for (const l of (_state.lines || [])) if (l?.id != null) _lineById.set(Number(l.id), l);
  // Build a name lookup from all line-stop IDs (station_id and raw_stop_id) to cover
  // cases where terminal IDs in vehicle data don't match station-group IDs in _stationById.
  _stopNameById = new Map();
  for (const l of (_state.lines || [])) {
    for (const stop of (l.stops || [])) {
      const name = stop.name || "";
      if (!isPlaceholderName(name)) {
        if (stop.station_id  && Number(stop.station_id)  !== 0) _stopNameById.set(Number(stop.station_id),  name);
        if (stop.raw_stop_id && Number(stop.raw_stop_id) !== 0) _stopNameById.set(Number(stop.raw_stop_id), name);
      }
    }
  }
}

function isPlaceholderName(name) {
  return !name || /^(stop|station)\s*#\d+$/i.test(String(name).trim());
}

function getVehicleType(v) {
  const raw = String(v.type || "UNKNOWN").toUpperCase();
  if (raw === "TRAM") return "TRAM";
  if (raw === "ROAD") {
    const text = `${v.line_name||""} ${v.name||""}`.toLowerCase();
    if (/\btram\b|straßenbahn|strassenbahn|streetcar/.test(text)) return "TRAM";
  }
  return raw;
}

function resolveStopName(v, which) {
  const stopId  = Number(v[which === "last" ? "last_stop_id" : "next_stop_id"] || 0);
  const rawName = (v[which === "last" ? "last_stop_name" : "next_stop_name"] || "").trim();
  if (rawName && !isPlaceholderName(rawName)) return rawName;
  const byStation = _stationById.get(stopId);
  if (byStation && !isPlaceholderName(byStation)) return byStation;
  // Try the comprehensive stop-name map (covers raw_stop_id / terminal IDs)
  const byStop = _stopNameById.get(stopId);
  if (byStop && !isPlaceholderName(byStop)) return byStop;
  const line = _lineById.get(Number(v.line_id || 0));
  if (line?.stops) {
    // Match by station_id OR raw_stop_id to handle terminal-vs-station-group ID mismatch
    const stop = line.stops.find(s =>
      Number(s.station_id||0) === stopId ||
      Number(s.raw_stop_id||0) === stopId
    );
    if (stop?.name && !isPlaceholderName(stop.name)) return stop.name;
  }
  return rawName || (stopId ? `Stop #${stopId}` : "–");
}

// ─── Filtering & sorting ──────────────────────────────────────────────────────
// Read reactive state from Alpine store (primary) with local fallback
function getFilterType()  { return appStore()?.filterType   ?? "ALL";  }
function getSortKey()     { return appStore()?.sortKey       ?? "name"; }
function getSearchQuery() { return appStore()?.searchQuery   ?? "";     }

function filteredVehicles() {
  let list         = _state.vehicles || [];
  const filterType = getFilterType();
  const searchQ    = getSearchQuery();

  if (filterType !== "ALL") list = list.filter(v => getVehicleType(v) === filterType);

  if (searchQ) {
    const q = searchQ.toLowerCase();
    list = list.filter(v =>
      (v.name||"").toLowerCase().includes(q) ||
      (v.line_name||"").toLowerCase().includes(q) ||
      resolveStopName(v,"last").toLowerCase().includes(q) ||
      resolveStopName(v,"next").toLowerCase().includes(q)
    );
  }

  if (_columnFilters.name) {
    const q = _columnFilters.name.toLowerCase();
    list = list.filter(v => (v.name||"").toLowerCase().includes(q));
  }
  if (_columnFilters.type) {
    const q = _columnFilters.type.toLowerCase();
    list = list.filter(v => getVehicleType(v).toLowerCase().includes(q));
  }
  if (_columnFilters.line_name) {
    const q = _columnFilters.line_name.toLowerCase();
    list = list.filter(v => (v.line_name||"").toLowerCase().includes(q));
  }
  if (_columnFilters.state) {
    const q = _columnFilters.state.toLowerCase();
    list = list.filter(v => (v.state||"").toLowerCase().includes(q));
  }
  if (_columnFilters.last_stop_name) {
    const q = _columnFilters.last_stop_name.toLowerCase();
    list = list.filter(v => resolveStopName(v,"last").toLowerCase().includes(q));
  }
  if (_columnFilters.next_stop_name) {
    const q = _columnFilters.next_stop_name.toLowerCase();
    list = list.filter(v => resolveStopName(v,"next").toLowerCase().includes(q));
  }

  const sortKey = getSortKey();
  return [...list].sort((a, b) => {
    const aOcc = (a.capacity||0)>0 ? (a.passengers||0)/a.capacity : -1;
    const bOcc = (b.capacity||0)>0 ? (b.passengers||0)/b.capacity : -1;
    switch (sortKey) {
      case "speed":      return (b.speed_kmh||0)-(a.speed_kmh||0);
      case "passengers": return (b.passengers||0)-(a.passengers||0);
      case "type":       return getFilterType()==="ALL"
        ? getVehicleType(a).localeCompare(getVehicleType(b))||(a.name||"").localeCompare(b.name||"")
        : (a.name||"").localeCompare(b.name||"");
      case "state":      return (a.state||"").localeCompare(b.state||"")||(a.name||"").localeCompare(b.name||"");
      case "last_stop":  return resolveStopName(a,"last").localeCompare(resolveStopName(b,"last"))||(a.name||"").localeCompare(b.name||"");
      case "next_stop":  return resolveStopName(a,"next").localeCompare(resolveStopName(b,"next"))||(a.name||"").localeCompare(b.name||"");
      case "occupancy":  return bOcc-aOcc||(b.passengers||0)-(a.passengers||0);
      case "line":       return (a.line_name||"").localeCompare(b.line_name||"");
      default:           return (a.name||"").localeCompare(b.name||"");
    }
  });
}

function updateHeaderFilterIndicators() {
  document.querySelectorAll("th[data-filter-key]").forEach(th => {
    const key    = th.dataset.filterKey;
    const active = Boolean(_columnFilters[key]);
    th.classList.toggle("filtered", active);
    th.title = active ? t("filterActive", { v: _columnFilters[key] }) : t("filterClick");
  });
  document.querySelectorAll(".col-filter-input[data-filter-key]").forEach(input => {
    const current = _columnFilters[input.dataset.filterKey] || "";
    if (input.value !== current) input.value = current;
  });
}

// ─── Stats animation helper ───────────────────────────────────────────────────
function updateStatCard(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  const newText = value ?? "–";
  if (el.textContent === String(newText)) return;
  // Alpine x-text manages the value; we only animate the flash
  doAnimate(el, { scale: [1.18, 1], color: ["#3b82f6", ""] }, { duration: 0.35, easing: EASING_SPRING });
}

// ─── Render stats into Alpine store ──────────────────────────────────────────
function renderStats() {
  const store = appStore();
  const s     = _state.stats || {};
  if (store) {
    // Animate flash if value changed before Alpine x-text updates it
    if (store.stats.total_vehicles !== s.total_vehicles)   updateStatCard("sv-vehicles",   s.total_vehicles);
    if (store.stats.total_passengers !== s.total_passengers) updateStatCard("sv-passengers", s.total_passengers);
    if (store.stats.total_lines !== s.total_lines)         updateStatCard("sv-lines",      s.total_lines);
    if (store.stats.total_stations !== s.total_stations)   updateStatCard("sv-stations",   s.total_stations);

    // Update Alpine store (x-text bindings update automatically)
    store.stats       = { ...s };
    store.gameTime    = fmtGameTime(_state.game_time);
    store.lastUpdated = t("lastUpdated") + timeAgo(_state.timestamp);
  }
}

// ─── Render table ─────────────────────────────────────────────────────────────
function renderTable() {
  const list = filteredVehicles();

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="empty-cell">
      ${getSearchQuery() || getFilterType() !== "ALL" ? t("noResults") : t("waitingForVehicles")}
    </td></tr>`;
    return;
  }

  for (const row of tbody.querySelectorAll("tr:not([data-vid])")) row.remove();

  const existing = new Map();
  for (const row of tbody.querySelectorAll("tr[data-vid]"))
    existing.set(String(row.dataset.vid), row);

  const seen    = new Set();
  let   cursor  = tbody.firstElementChild;
  const newRows = [];

  for (const v of list) {
    const vid          = String(v.id);
    seen.add(vid);
    const vType        = getVehicleType(v);
    const lastStopName = resolveStopName(v, "last");
    const nextStopName = resolveStopName(v, "next");

    const rowHTML = `
      <td class="td-name"      title="${esc(v.name)}">${esc(v.name)}</td>
      <td>${fmtType(vType || "UNKNOWN")}</td>
      <td class="td-secondary" title="${esc(v.line_name)}">${esc(v.line_name || "–")}</td>
      <td>${fmtState(v.state || "UNKNOWN")}</td>
      <td>${fmtSpeed(v.speed_kmh)}</td>
      <td class="td-secondary" title="${esc(lastStopName)}">${esc(lastStopName || "–")}</td>
      <td class="td-secondary" title="${esc(nextStopName)}">${esc(nextStopName || "–")}</td>
      <td>${fmtPax(v.passengers, v.capacity)}</td>
      <td>${fmtOccupancy(v.passengers, v.capacity)}</td>
    `;

    let row = existing.get(vid);
    if (row) {
      if (row.innerHTML.trim() !== rowHTML.trim()) row.innerHTML = rowHTML;
    } else {
      row = document.createElement("tr");
      row.dataset.vid = vid;
      row.innerHTML   = rowHTML;
      row.addEventListener("click", () => openDetail(vid));
      newRows.push(row);
    }

    row.classList.toggle("selected", String(vid) === String(_selectedVid));
    if (row === cursor) cursor = cursor.nextElementSibling;
    else tbody.insertBefore(row, cursor);
  }

  for (const [vid, row] of existing) if (!seen.has(vid)) row.remove();

  if (_firstRender && tbody.querySelectorAll("tr[data-vid]").length > 0) {
    const rows = Array.from(tbody.querySelectorAll("tr[data-vid]"));
    doAnimate(rows, { opacity: [0, 1], y: [6, 0] },
      { delay: _stagger ? _stagger(0.025) : 0, duration: 0.2, easing: "ease-out" });
    _firstRender = false;
  } else if (newRows.length > 0) {
    doAnimate(newRows, { opacity: [0, 1] }, { duration: 0.2 });
  }
}

// Expose for Alpine store callbacks
window.tpf2Render = renderTable;

// ─── Detail panel ─────────────────────────────────────────────────────────────
function openDetail(vid, rerenderTable = true) {
  const v = (_state.vehicles || []).find(x => String(x.id) === String(vid));
  if (!v) return;

  _selectedVid = String(vid);
  const lastStopName = resolveStopName(v, "last");
  const nextStopName = resolveStopName(v, "next");

  dpName.textContent = v.name;

  const rows = [
    [t("dpID"),        v.id],
    [t("dpType"),      getVehicleType(v)],
    [t("dpLine"),      v.line_name || `#${v.line_id}`],
    [t("dpState"),     v.state],
    null,
    [t("dpSpeed"),     `${v.speed_kmh} km/h (${v.speed_ms} m/s)`],
    [t("dpDirection"), v.direction === 1 ? t("dpForward") : t("dpBackward")],
    null,
    [t("dpPassengers"),`${v.passengers} / ${v.capacity || "?"}`],
    v.cargo_capacity > 0 ? [t("dpCargo"), `${v.cargo} / ${v.cargo_capacity}`] : null,
    null,
    [t("dpLastStop"),  lastStopName || `#${v.last_stop_id}`],
    [t("dpNextStop"),  nextStopName || `#${v.next_stop_id}`],
    null,
    [t("dpPosX"),      v.position ? v.position.x : "–"],
    [t("dpPosY"),      v.position ? v.position.y : "–"],
    [t("dpPosZ"),      v.position ? v.position.z : "–"],
  ];

  dpGrid.innerHTML = rows.map(row => {
    if (!row) return `<div class="dp-divider"></div><div></div>`;
    return `<div class="dp-key">${esc(row[0])}</div><div class="dp-value">${esc(String(row[1] ?? "–"))}</div>`;
  }).join("");

  // Alpine x-show / x-transition handle visibility + animation
  const store = appStore();
  if (store) store.detailVisible = true;

  if (rerenderTable) renderTable();
}

// Close detail panel (called by Alpine store.closeDetail())
window.tpf2CloseDetail = () => {
  _selectedVid = null;
  const store = appStore();
  if (store) store.detailVisible = false;
  renderTable();
};

// ─── Central data handler ─────────────────────────────────────────────────────
function handleTelemetryData(data) {
  if (!data || typeof data !== "object") return;
  _state = data;
  _lastMapData = data;
  rebuildIndexes();
  renderStats();
  renderTable();
  if (_selectedVid != null) openDetail(_selectedVid, false);
  if (_activeView === "map") drawMap(_state);
}
window.tpf2HandleData = handleTelemetryData;

// ─── CSV export ───────────────────────────────────────────────────────────────
function exportCSV() {
  const list    = filteredVehicles();
  const headers = ["ID","Name","Type","Line","State","Speed (km/h)",
    "Last Stop","Next Stop","Passengers","Capacity","Cargo","Cargo Capacity",
    "Pos X","Pos Y","Pos Z"];
  const rows = list.map(v => [
    v.id, v.name, getVehicleType(v), v.line_name||"", v.state, v.speed_kmh,
    resolveStopName(v,"last"), resolveStopName(v,"next"),
    v.passengers, v.capacity, v.cargo, v.cargo_capacity,
    v.position?.x??"", v.position?.y??"", v.position?.z??"",
  ]);
  const csv = [headers,...rows]
    .map(r => r.map(c => `"${String(c??"").replace(/"/g,'""')}"`).join(","))
    .join("\r\n");
  const a = Object.assign(document.createElement("a"), {
    href:     URL.createObjectURL(new Blob([csv], { type:"text/csv;charset=utf-8;" })),
    download: `tpf2_${new Date().toISOString().slice(0,19).replace(/:/g,"-")}.csv`,
  });
  a.click();
  URL.revokeObjectURL(a.href);
}
document.getElementById("export-csv").addEventListener("click", exportCSV);

// ─── Column filter inputs (remain in app.js – complex, not Alpine) ────────────
document.querySelector("#vehicle-table thead").addEventListener("click", e => {
  const th = e.target.closest("th[data-filter-key]");
  if (!th) return;
  document.querySelector(`.col-filter-input[data-filter-key="${th.dataset.filterKey}"]`)?.focus();
});

document.querySelectorAll(".col-filter-input[data-filter-key]").forEach(input => {
  input.addEventListener("input", () => {
    _columnFilters[input.dataset.filterKey] = input.value.trim();
    updateHeaderFilterIndicators();
    renderTable();
  });
});

window.addEventListener("resize", () => {
  if (_activeView === "map" && (_lastMapData || _state)) {
    drawMap(_lastMapData || _state);
  }
});

// ─── Language toggle (called by Alpine store.toggleLang()) ───────────────────
window.tpf2ToggleLang = () => {
  _lang = _lang === "de" ? "en" : "de";
  localStorage.setItem("tpf2_lang", _lang);

  // Sync Alpine store.lang so x-text on the button updates
  const store = appStore();
  if (store) store.lang = _lang;

  applyI18n();
  renderStats();
  renderTable();
  updateHeaderFilterIndicators();
  if (_selectedVid != null) openDetail(_selectedVid, false);
};

// ─── HTMX callback ────────────────────────────────────────────────────────────
// Called by hx-on::after-request on the polling div in index.html.
// Only uses REST data when the WebSocket is NOT connected (true fallback).
window.tpf2HandleHtmx = (event) => {
  const xhr = event?.detail?.xhr;
  if (!xhr || xhr.status !== 200) return;
  if (window.tpf2WsConnected) return; // WS is live – REST data not needed
  try {
    handleTelemetryData(JSON.parse(xhr.responseText));
  } catch (_) {}
};

// ─── Connection state ─────────────────────────────────────────────────────────
function setConnState(state) {
  // Update Alpine store (badge :class + dot :class animate reactively)
  const store = appStore();
  if (store) store.connState = state;

  // Also update the static text label (applyI18n handles translation)
  const labels = {
    connecting:   t("connecting"),
    connected:    t("connected"),
    disconnected: t("disconnected"),
  };
  if (connLabel) connLabel.textContent = labels[state] || state;

  window.tpf2WsConnected = (state === "connected");
}

// ─── WebSocket ────────────────────────────────────────────────────────────────
function connectWS() {
  if (_ws && _ws.readyState <= 1) return;
  setConnState("connecting");
  _ws = new WebSocket(WS_URL);

  _ws.onopen = () => {
    setConnState("connected");
    _reconnecting = false;
  };

  _ws.onmessage = evt => {
    try {
      const data = JSON.parse(evt.data);
      if (data.type === "ping") return;
      handleTelemetryData(data);
    } catch (e) { console.warn("WebSocket parse error:", e); }
  };

  _ws.onerror = err => console.warn("WebSocket error:", err);

  _ws.onclose = () => {
    setConnState("disconnected");
    if (!_reconnecting) { _reconnecting = true; setTimeout(connectWS, RECONNECT_DELAY_MS); }
  };
}

// ─── Init ─────────────────────────────────────────────────────────────────────
// Alpine is already initialized (defer + module ordering guarantee).
// Apply i18n to data-i18n elements (Alpine owns the reactive values,
// app.js owns the static text labels and placeholders).
applyI18n();
setView("list");

// Initialise Lucide icons
if (window.lucide) window.lucide.createIcons();

// Animate stats cards in
doAnimate(
  document.querySelectorAll(".stat-card"),
  { opacity: [0, 1], y: [12, 0] },
  { delay: _stagger ? _stagger(0.07) : 0, duration: 0.35, easing: EASING_OUT_CUBIC }
);

connectWS();
updateHeaderFilterIndicators();

// Refresh "last updated" label every second via Alpine store
setInterval(() => {
  const store = appStore();
  if (store && _state.timestamp) {
    store.lastUpdated = t("lastUpdated") + timeAgo(_state.timestamp);
  }
}, 1000);
