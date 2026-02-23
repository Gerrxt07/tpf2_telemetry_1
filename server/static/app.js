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
let _state = { vehicles: [], lines: [], stations: [], stats: {}, game_time: null, timestamp: null };
let _selectedVid   = null;
let _ws            = null;
let _reconnecting  = false;
let _firstRender   = true;
let _stationById   = new Map();
let _lineById      = new Map();
let _stopNameById  = new Map(); // covers both station_id and raw_stop_id from line stops
let _columnFilters = { name:"", type:"", line_name:"", state:"", last_stop_name:"", next_stop_name:"" };

// WS connection state (read by tpf2HandleHtmx to avoid double-processing)
window.tpf2WsConnected = false;

// ─── DOM references ───────────────────────────────────────────────────────────
const connLabel     = document.getElementById("conn-label");
const tbody         = document.getElementById("vehicle-tbody");
const detailPanel   = document.getElementById("detail-panel");
const dpName        = document.getElementById("dp-name");
const dpGrid        = document.getElementById("dp-grid");
const searchInput   = document.getElementById("search-input");

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
  rebuildIndexes();
  renderStats();
  renderTable();
  if (_selectedVid != null) openDetail(_selectedVid, false);
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
