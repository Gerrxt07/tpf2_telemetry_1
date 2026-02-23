/**
 * TPF2 Real-Time Telemetry – Frontend
 * Connects via WebSocket to the FastAPI server,
 * renders the vehicle table and detail panel live.
 * Supports EN / DE UI language and dark / light theme.
 */

"use strict";

// ─── Localisation strings ────────────────────────────────────────────────────
const STRINGS = {
  de: {
    subtitle:         "Echtzeit-Fahrplan",
    connecting:       "Verbinde…",
    connected:        "Live",
    disconnected:     "Getrennt",
    vehicles:         "Fahrzeuge",
    passengers:       "Passagiere gesamt",
    lines:            "Linien",
    stations:         "Stationen",
    searchPlaceholder:"🔍  Fahrzeug / Linie / Station suchen…",
    all:              "Alle",
    train:            "🚆 Zug",
    bus:              "🚌 Bus",
    tram:             "🚋 Tram",
    ship:             "⛴ Schiff",
    plane:            "✈ Flugzeug",
    sortName:         "Sortierung: Name (Fahrzeug)",
    sortSpeed:        "Sortierung: Geschwindigkeit",
    sortPassengers:   "Sortierung: Passagiere",
    sortType:         "Sortierung: Typ",
    sortState:        "Sortierung: Zustand",
    sortLastStop:     "Sortierung: Letzter Halt",
    sortNextStop:     "Sortierung: Nächster Halt",
    sortOccupancy:    "Sortierung: Auslastung",
    sortLine:         "Sortierung: Linie",
    colVehicle:       "Fahrzeug",
    colType:          "Typ",
    colLine:          "Linie",
    colState:         "Zustand",
    colSpeed:         "Geschw.",
    colLastStop:      "Letzter Halt",
    colNextStop:      "Nächster Halt",
    colPax:           "Pax",
    colOccupancy:     "Auslastung",
    filterPlaceholder:"Filter…",
    waitingForData:   "Warte auf Daten…",
    noResults:        "Keine Ergebnisse für diese Filtereinstellungen.",
    waitingForVehicles:"Warte auf Fahrzeugdaten…",
    lastUpdated:      "Aktualisiert: ",
    justNow:          "gerade eben",
    secondsAgo:       "vor {n}s",
    minutesAgo:       "vor {n}min",
    typeRail:         "🚆 Zug",
    typeRoad:         "🚌 Bus",
    typeTram:         "🚋 Tram",
    typeWater:        "⛴ Schiff",
    typeAir:          "✈ Flug",
    stateMoving:      "Fährt",
    stateAtStop:      "Am Halt",
    stateStopped:     "Gestoppt",
    stateLoading:     "Beladung",
    stateUnloading:   "Entladung",
    stateWaiting:     "Wartet",
    dpID:             "ID",
    dpType:           "Typ",
    dpLine:           "Linie",
    dpState:          "Zustand",
    dpSpeed:          "Geschwindigkeit",
    dpDirection:      "Richtung",
    dpForward:        "→ vorwärts",
    dpBackward:       "← rückwärts",
    dpPassengers:     "Passagiere",
    dpCargo:          "Fracht",
    dpLastStop:       "Letzter Halt",
    dpNextStop:       "Nächster Halt",
    dpPosX:           "Position X",
    dpPosY:           "Position Y",
    dpPosZ:           "Position Z",
    exportCsv:        "CSV Export",
    apiDocs:          "API-Docs",
    rawJson:          "Raw JSON",
    filterActive:     "Filter aktiv: {v}",
    filterClick:      "Zum Filterfeld klicken",
  },
  en: {
    subtitle:         "Real-Time Schedule",
    connecting:       "Connecting…",
    connected:        "Live",
    disconnected:     "Disconnected",
    vehicles:         "Vehicles",
    passengers:       "Total Passengers",
    lines:            "Lines",
    stations:         "Stations",
    searchPlaceholder:"🔍  Search vehicle / line / station…",
    all:              "All",
    train:            "🚆 Train",
    bus:              "🚌 Bus",
    tram:             "🚋 Tram",
    ship:             "⛴ Ship",
    plane:            "✈ Plane",
    sortName:         "Sort: Name (Vehicle)",
    sortSpeed:        "Sort: Speed",
    sortPassengers:   "Sort: Passengers",
    sortType:         "Sort: Type",
    sortState:        "Sort: State",
    sortLastStop:     "Sort: Last Stop",
    sortNextStop:     "Sort: Next Stop",
    sortOccupancy:    "Sort: Occupancy",
    sortLine:         "Sort: Line",
    colVehicle:       "Vehicle",
    colType:          "Type",
    colLine:          "Line",
    colState:         "State",
    colSpeed:         "Speed",
    colLastStop:      "Last Stop",
    colNextStop:      "Next Stop",
    colPax:           "Pax",
    colOccupancy:     "Occupancy",
    filterPlaceholder:"Filter…",
    waitingForData:   "Waiting for data…",
    noResults:        "No results for the current filter settings.",
    waitingForVehicles:"Waiting for vehicle data…",
    lastUpdated:      "Updated: ",
    justNow:          "just now",
    secondsAgo:       "{n}s ago",
    minutesAgo:       "{n}min ago",
    typeRail:         "🚆 Train",
    typeRoad:         "🚌 Bus",
    typeTram:         "🚋 Tram",
    typeWater:        "⛴ Ship",
    typeAir:          "✈ Plane",
    stateMoving:      "Moving",
    stateAtStop:      "At stop",
    stateStopped:     "Stopped",
    stateLoading:     "Loading",
    stateUnloading:   "Unloading",
    stateWaiting:     "Waiting",
    dpID:             "ID",
    dpType:           "Type",
    dpLine:           "Line",
    dpState:          "State",
    dpSpeed:          "Speed",
    dpDirection:      "Direction",
    dpForward:        "→ forward",
    dpBackward:       "← backward",
    dpPassengers:     "Passengers",
    dpCargo:          "Cargo",
    dpLastStop:       "Last Stop",
    dpNextStop:       "Next Stop",
    dpPosX:           "Position X",
    dpPosY:           "Position Y",
    dpPosZ:           "Position Z",
    exportCsv:        "CSV Export",
    apiDocs:          "API Docs",
    rawJson:          "Raw JSON",
    filterActive:     "Filter active: {v}",
    filterClick:      "Click to focus filter",
  },
};

// ─── i18n helpers ────────────────────────────────────────────────────────────
let _lang = localStorage.getItem("tpf2_lang") || "de";

function t(key, vars) {
  let str = (STRINGS[_lang] || STRINGS.de)[key] || key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.replace(`{${k}}`, v);
    }
  }
  return str;
}

function applyI18n() {
  document.querySelectorAll("[data-i18n]").forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  // Update <html lang> attribute
  document.documentElement.lang = _lang;
}

// ─── Theme ───────────────────────────────────────────────────────────────────
let _darkMode = localStorage.getItem("tpf2_theme") !== "light";

function applyTheme() {
  document.documentElement.classList.toggle("light", !_darkMode);
  themeToggle.textContent = _darkMode ? "☀️" : "🌙";
}

// ─── Configuration ───────────────────────────────────────────────────────────
const WS_URL    = `ws://${location.host}/ws`;
const RECONNECT_DELAY_MS = 3000;

// ─── State ───────────────────────────────────────────────────────────────────
let _state = {
  vehicles:  [],
  lines:     [],
  stations:  [],
  stats:     {},
  game_time: null,
  timestamp: null,
};

let _filterType   = "ALL";
let _sortKey      = "name";
let _searchQuery  = "";
let _selectedVid  = null;
let _ws           = null;
let _reconnecting = false;
let _stationById  = new Map();
let _lineById     = new Map();
let _columnFilters = {
  name: "",
  type: "",
  line_name: "",
  state: "",
  last_stop_name: "",
  next_stop_name: "",
};

// ─── DOM references ──────────────────────────────────────────────────────────
const connDot      = document.getElementById("conn-dot");
const connLabel    = document.getElementById("conn-label");
const gameTimeBox  = document.getElementById("game-time-box");
const lastUpdateBox= document.getElementById("last-update-box");
const tbody        = document.getElementById("vehicle-tbody");
const detailPanel  = document.getElementById("detail-panel");
const dpName       = document.getElementById("dp-name");
const dpGrid       = document.getElementById("dp-grid");
const searchInput  = document.getElementById("search-input");
const sortSelect   = document.getElementById("sort-select");
const langToggle   = document.getElementById("lang-toggle");
const themeToggle  = document.getElementById("theme-toggle");

// ─── Utility functions ───────────────────────────────────────────────────────
const esc = s => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

function fmtSpeed(kmh) {
  if (kmh === 0 || kmh == null) return `<span class="speed-slow">0 km/h</span>`;
  const cls = kmh > 180 ? "speed-fast" : kmh > 60 ? "speed-medium" : "speed-slow";
  return `<span class="speed-cell ${cls}">${kmh} km/h</span>`;
}

function fmtType(type) {
  const map = {
    RAIL:  t("typeRail"),
    ROAD:  t("typeRoad"),
    TRAM:  t("typeTram"),
    WATER: t("typeWater"),
    AIR:   t("typeAir"),
  };
  const label = map[type] || type;
  return `<span class="type-badge type-${type}">${esc(label)}</span>`;
}

function fmtState(state) {
  const raw = String(state || "UNKNOWN").toUpperCase();
  const map = {
    IN_TRANSIT:  { labelKey: "stateMoving",    cls: "moving"  },
    EN_ROUTE:    { labelKey: "stateMoving",    cls: "moving"  },
    AT_TERMINAL: { labelKey: "stateAtStop",    cls: "stop"    },
    STOPPED:     { labelKey: "stateStopped",   cls: "stopped" },
    LOADING:     { labelKey: "stateLoading",   cls: "service" },
    UNLOADING:   { labelKey: "stateUnloading", cls: "service" },
    WAITING:     { labelKey: "stateWaiting",   cls: "idle"    },
  };
  const meta = map[raw];
  const label = meta ? t(meta.labelKey) : (raw || "UNKNOWN");
  const cls   = meta ? meta.cls : "unknown";
  return `<span class="state-badge state-${cls}">${esc(label)}</span>`;
}

function fmtOccupancy(pax, cap) {
  if (!cap || cap === 0) return '<span class="pax-cell">–</span>';
  const pct = Math.min(100, Math.round(pax / cap * 100));
  const cls = pct >= 80 ? "occ-high" : pct >= 50 ? "occ-mid" : "occ-low";
  return `
    <div class="occ-bar-wrap" title="${pax}/${cap} (${pct}%)">
      <div class="occ-bar ${cls}" style="width:${pct}%"></div>
    </div>`;
}

function fmtPax(pax, cap) {
  if (!cap || cap === 0) return `<span class="pax-cell">${pax}</span>`;
  return `<span class="pax-cell">${pax} / ${cap}</span>`;
}

function fmtPos(pos) {
  if (!pos) return "–";
  return `(${pos.x}, ${pos.y}, ${pos.z})`;
}

function timeAgo(ts) {
  if (!ts) return "–";
  const delta = Math.round(Date.now() / 1000 - ts);
  if (delta < 5)  return t("justNow");
  if (delta < 60) return t("secondsAgo", { n: delta });
  return t("minutesAgo", { n: Math.round(delta / 60) });
}

function fmtGameTime(gt) {
  if (!gt) return "–";

  if (typeof gt === "number") {
    return `${gt}`;
  }

  if (typeof gt === "object") {
    const dateObj = gt.date || gt;
    const { year, month, day, hour, minute } = dateObj;

    if (year != null) {
      const m = String(month||1).padStart(2,"0");
      const d = String(day||1).padStart(2,"0");

      if (hour != null || minute != null) {
        const h   = String(hour||0).padStart(2,"0");
        const min = String(minute||0).padStart(2,"0");
        return `🕐 ${year}-${m}-${d} ${h}:${min}`;
      }
      return `📅 ${d}.${m}.${year}`;
    }
  }
  return JSON.stringify(gt);
}

function rebuildIndexes() {
  _stationById = new Map();
  for (const s of (_state.stations || [])) {
    if (s && s.id != null) _stationById.set(Number(s.id), s.name || "");
  }

  _lineById = new Map();
  for (const l of (_state.lines || [])) {
    if (l && l.id != null) _lineById.set(Number(l.id), l);
  }
}

function isPlaceholderStopName(name) {
  if (!name) return true;
  return /^(stop|station)\s*#\d+$/i.test(String(name).trim());
}

function getVehicleType(v) {
  const raw = String(v.type || "UNKNOWN").toUpperCase();
  if (raw === "TRAM") return "TRAM";
  if (raw === "ROAD") {
    const text = `${v.line_name || ""} ${v.name || ""}`.toLowerCase();
    if (/\btram\b|straßenbahn|strassenbahn|streetcar/.test(text)) return "TRAM";
  }
  return raw;
}

function resolveStopName(v, which) {
  const idKey   = which === "last" ? "last_stop_id"   : "next_stop_id";
  const nameKey = which === "last" ? "last_stop_name"  : "next_stop_name";
  const stopId  = Number(v[idKey] || 0);
  const rawName = (v[nameKey] || "").trim();

  if (rawName && !isPlaceholderStopName(rawName)) return rawName;

  const byStation = _stationById.get(stopId);
  if (byStation && !isPlaceholderStopName(byStation)) return byStation;

  const line = _lineById.get(Number(v.line_id || 0));
  if (line && Array.isArray(line.stops)) {
    const stop = line.stops.find(s => Number(s.station_id || 0) === stopId);
    if (stop && stop.name && !isPlaceholderStopName(stop.name)) return stop.name;
  }

  return rawName || (stopId ? `Stop #${stopId}` : "–");
}

// ─── Filtering & sorting ─────────────────────────────────────────────────────
function filteredVehicles() {
  let list = _state.vehicles || [];

  if (_filterType !== "ALL") {
    list = list.filter(v => getVehicleType(v) === _filterType);
  }

  if (_searchQuery) {
    const q = _searchQuery.toLowerCase();
    list = list.filter(v =>
      (v.name       || "").toLowerCase().includes(q) ||
      (v.line_name  || "").toLowerCase().includes(q) ||
      resolveStopName(v, "last").toLowerCase().includes(q) ||
      resolveStopName(v, "next").toLowerCase().includes(q)
    );
  }

  if (_columnFilters.name) {
    const q = _columnFilters.name.toLowerCase();
    list = list.filter(v => (v.name || "").toLowerCase().includes(q));
  }
  if (_columnFilters.type) {
    const q = _columnFilters.type.toLowerCase();
    list = list.filter(v => getVehicleType(v).toLowerCase().includes(q));
  }
  if (_columnFilters.line_name) {
    const q = _columnFilters.line_name.toLowerCase();
    list = list.filter(v => (v.line_name || "").toLowerCase().includes(q));
  }
  if (_columnFilters.state) {
    const q = _columnFilters.state.toLowerCase();
    list = list.filter(v => (v.state || "").toLowerCase().includes(q));
  }
  if (_columnFilters.last_stop_name) {
    const q = _columnFilters.last_stop_name.toLowerCase();
    list = list.filter(v => resolveStopName(v, "last").toLowerCase().includes(q));
  }
  if (_columnFilters.next_stop_name) {
    const q = _columnFilters.next_stop_name.toLowerCase();
    list = list.filter(v => resolveStopName(v, "next").toLowerCase().includes(q));
  }

  list = [...list].sort((a, b) => {
    const aOcc = (a.capacity || 0) > 0 ? (a.passengers || 0) / a.capacity : -1;
    const bOcc = (b.capacity || 0) > 0 ? (b.passengers || 0) / b.capacity : -1;

    switch (_sortKey) {
      case "speed":      return (b.speed_kmh || 0) - (a.speed_kmh || 0);
      case "passengers": return (b.passengers || 0) - (a.passengers || 0);
      case "type": {
        if (_filterType === "ALL") {
          return getVehicleType(a).localeCompare(getVehicleType(b)) ||
                 (a.name || "").localeCompare(b.name || "");
        }
        return (a.name || "").localeCompare(b.name || "");
      }
      case "state":
        return (a.state || "").localeCompare(b.state || "") ||
               (a.name || "").localeCompare(b.name || "");
      case "last_stop":
        return resolveStopName(a, "last").localeCompare(resolveStopName(b, "last")) ||
               (a.name || "").localeCompare(b.name || "");
      case "next_stop":
        return resolveStopName(a, "next").localeCompare(resolveStopName(b, "next")) ||
               (a.name || "").localeCompare(b.name || "");
      case "occupancy":
        return bOcc - aOcc || (b.passengers || 0) - (a.passengers || 0);
      case "line":       return (a.line_name || "").localeCompare(b.line_name || "");
      default:           return (a.name || "").localeCompare(b.name || "");
    }
  });

  return list;
}

function updateHeaderFilterIndicators() {
  document.querySelectorAll("th[data-filter-key]").forEach(th => {
    const key    = th.dataset.filterKey;
    const active = Boolean(_columnFilters[key]);
    th.classList.toggle("filtered", active);
    th.title = active
      ? t("filterActive", { v: _columnFilters[key] })
      : t("filterClick");
  });

  document.querySelectorAll(".col-filter-input[data-filter-key]").forEach(input => {
    const key     = input.dataset.filterKey;
    const current = _columnFilters[key] || "";
    if (input.value !== current) input.value = current;
  });
}

// ─── Rendering ───────────────────────────────────────────────────────────────
function renderStats() {
  const s = _state.stats || {};
  document.getElementById("sv-vehicles").textContent   = s.total_vehicles   ?? "–";
  document.getElementById("sv-passengers").textContent = s.total_passengers ?? "–";
  document.getElementById("sv-lines").textContent      = s.total_lines      ?? "–";
  document.getElementById("sv-stations").textContent   = s.total_stations   ?? "–";

  if (_state.timestamp) {
    lastUpdateBox.textContent = t("lastUpdated") + timeAgo(_state.timestamp);
  }
  if (_state.game_time) {
    gameTimeBox.textContent = fmtGameTime(_state.game_time);
    gameTimeBox.style.display = "";
  }
}

function renderTable() {
  const list = filteredVehicles();
  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="empty-row">
      ${_searchQuery || _filterType !== "ALL" ? t("noResults") : t("waitingForVehicles")}
    </td></tr>`;
    return;
  }

  for (const row of tbody.querySelectorAll("tr:not([data-vid])")) {
    row.remove();
  }

  const existing = new Map();
  for (const row of tbody.querySelectorAll("tr[data-vid]")) {
    existing.set(String(row.dataset.vid), row);
  }

  const seen   = new Set();
  let   cursor = tbody.firstElementChild;

  for (const v of list) {
    const vid          = String(v.id);
    seen.add(vid);
    const vType        = getVehicleType(v);
    const lastStopName = resolveStopName(v, "last");
    const nextStopName = resolveStopName(v, "next");

    const rowHTML = `
      <td class="vname" title="${esc(v.name)}">${esc(v.name)}</td>
      <td>${fmtType(vType || "UNKNOWN")}</td>
      <td title="${esc(v.line_name)}">${esc(v.line_name || "–")}</td>
      <td>${fmtState(v.state || "UNKNOWN")}</td>
      <td>${fmtSpeed(v.speed_kmh)}</td>
      <td title="${esc(lastStopName)}">${esc(lastStopName || "–")}</td>
      <td title="${esc(nextStopName)}">${esc(nextStopName || "–")}</td>
      <td>${fmtPax(v.passengers, v.capacity)}</td>
      <td>${fmtOccupancy(v.passengers, v.capacity)}</td>
    `;

    let row = existing.get(vid);
    if (row) {
      const newInner = rowHTML.trim();
      if (row.innerHTML.trim() !== newInner) {
        row.innerHTML = rowHTML;
      }
    } else {
      row = document.createElement("tr");
      row.dataset.vid = vid;
      row.innerHTML   = rowHTML;
      row.addEventListener("click", () => openDetail(vid));
    }

    if (String(vid) === String(_selectedVid)) row.classList.add("selected");
    else row.classList.remove("selected");

    if (row === cursor) {
      cursor = cursor ? cursor.nextElementSibling : null;
    } else {
      tbody.insertBefore(row, cursor);
    }
  }

  for (const [vid, row] of existing) {
    if (!seen.has(vid)) row.remove();
  }
}

// ─── Detail panel ─────────────────────────────────────────────────────────────
function openDetail(vid, rerenderTable = true) {
  const vidKey = String(vid);
  const v = (_state.vehicles || []).find(x => String(x.id) === vidKey);
  if (!v) return;

  _selectedVid = vidKey;
  detailPanel.classList.remove("hidden");

  dpName.textContent = v.name;

  const lastStopName = resolveStopName(v, "last");
  const nextStopName = resolveStopName(v, "next");

  const rows = [
    [t("dpID"),    v.id],
    [t("dpType"),  getVehicleType(v)],
    [t("dpLine"),  v.line_name || `#${v.line_id}`],
    [t("dpState"), v.state],
    null,
    [t("dpSpeed"),     `${v.speed_kmh} km/h (${v.speed_ms} m/s)`],
    [t("dpDirection"), v.direction === 1 ? t("dpForward") : t("dpBackward")],
    null,
    [t("dpPassengers"), `${v.passengers} / ${v.capacity || "?"}`],
    v.cargo_capacity > 0 ? [t("dpCargo"), `${v.cargo} / ${v.cargo_capacity}`] : null,
    null,
    [t("dpLastStop"), lastStopName || `#${v.last_stop_id}`],
    [t("dpNextStop"), nextStopName || `#${v.next_stop_id}`],
    null,
    [t("dpPosX"), v.position ? v.position.x : "–"],
    [t("dpPosY"), v.position ? v.position.y : "–"],
    [t("dpPosZ"), v.position ? v.position.z : "–"],
  ];

  let html = "";
  for (const row of rows) {
    if (!row) {
      html += `<div class="dp-divider"></div><div></div>`;
      continue;
    }
    const [key, val] = row;
    html += `<div class="dp-key">${esc(key)}</div><div class="dp-value">${esc(String(val ?? "–"))}</div>`;
  }
  dpGrid.innerHTML = html;

  if (rerenderTable) renderTable();
}

document.getElementById("detail-close").addEventListener("click", () => {
  _selectedVid = null;
  detailPanel.classList.add("hidden");
  renderTable();
});

// ─── CSV export ──────────────────────────────────────────────────────────────
function exportCSV() {
  const list = filteredVehicles();
  const headers = [
    "ID", "Name", "Type", "Line", "State",
    "Speed (km/h)", "Last Stop", "Next Stop",
    "Passengers", "Capacity", "Cargo", "Cargo Capacity",
    "Position X", "Position Y", "Position Z",
  ];
  const rows = list.map(v => [
    v.id,
    v.name,
    getVehicleType(v),
    v.line_name || "",
    v.state,
    v.speed_kmh,
    resolveStopName(v, "last"),
    resolveStopName(v, "next"),
    v.passengers,
    v.capacity,
    v.cargo,
    v.cargo_capacity,
    v.position ? v.position.x : "",
    v.position ? v.position.y : "",
    v.position ? v.position.z : "",
  ]);

  const csvLines = [headers, ...rows].map(row =>
    row.map(cell => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")
  );
  const blob = new Blob([csvLines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `tpf2_telemetry_${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

document.getElementById("export-csv").addEventListener("click", exportCSV);

// ─── Filter events ────────────────────────────────────────────────────────────
document.getElementById("type-filter").addEventListener("click", e => {
  const pill = e.target.closest(".pill");
  if (!pill) return;
  document.querySelectorAll(".pill").forEach(p => p.classList.remove("active"));
  pill.classList.add("active");
  _filterType = pill.dataset.type;
  renderTable();
});

document.querySelector("#vehicle-table thead").addEventListener("click", e => {
  const th = e.target.closest("th[data-filter-key]");
  if (!th) return;
  const key   = th.dataset.filterKey;
  const input = document.querySelector(`.col-filter-input[data-filter-key="${key}"]`);
  if (input) input.focus();
});

document.querySelectorAll(".col-filter-input[data-filter-key]").forEach(input => {
  input.addEventListener("input", () => {
    const key = input.dataset.filterKey;
    _columnFilters[key] = input.value.trim();
    updateHeaderFilterIndicators();
    renderTable();
  });
});

searchInput.addEventListener("input", () => {
  _searchQuery = searchInput.value.trim();
  renderTable();
});

sortSelect.addEventListener("change", () => {
  _sortKey = sortSelect.value;
  renderTable();
});

// ─── Language & theme controls ───────────────────────────────────────────────
langToggle.addEventListener("click", () => {
  _lang = _lang === "de" ? "en" : "de";
  localStorage.setItem("tpf2_lang", _lang);
  langToggle.textContent = _lang.toUpperCase();
  applyI18n();
  // Re-render dynamic content that uses t()
  renderStats();
  renderTable();
  updateHeaderFilterIndicators();
  if (_selectedVid != null) openDetail(_selectedVid, false);
});

themeToggle.addEventListener("click", () => {
  _darkMode = !_darkMode;
  localStorage.setItem("tpf2_theme", _darkMode ? "dark" : "light");
  applyTheme();
});

// ─── WebSocket connection ─────────────────────────────────────────────────────
function setConnState(state) {
  connDot.className = "dot " + state;
  const labels = {
    connecting:   t("connecting"),
    connected:    t("connected"),
    disconnected: t("disconnected"),
  };
  connLabel.textContent = labels[state] || state;
}

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
      _state = data;
      rebuildIndexes();
      renderStats();
      renderTable();
      if (_selectedVid != null) openDetail(_selectedVid, false);
    } catch (e) {
      console.warn("WebSocket parse error:", e);
    }
  };

  _ws.onerror = err => {
    console.warn("WebSocket error:", err);
  };

  _ws.onclose = () => {
    setConnState("disconnected");
    if (!_reconnecting) {
      _reconnecting = true;
      setTimeout(connectWS, RECONNECT_DELAY_MS);
    }
  };
}

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  // Apply saved preferences
  langToggle.textContent = _lang.toUpperCase();
  applyTheme();
  applyI18n();

  // Initial REST fetch (in case WS is not ready yet)
  fetch("/api/telemetry")
    .then(r => r.json())
    .then(data => {
      if (data && Object.keys(data).length > 0) {
        _state = data;
        rebuildIndexes();
        renderStats();
        renderTable();
      }
    })
    .catch(() => {});

  connectWS();
  updateHeaderFilterIndicators();

  // Update "last updated" label every second
  setInterval(() => {
    if (_state.timestamp) {
      lastUpdateBox.textContent = t("lastUpdated") + timeAgo(_state.timestamp);
    }
  }, 1000);
});
