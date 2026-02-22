/**
 * TPF2 Echtzeit-Telemetrie – Frontend
 * Verbindet sich per WebSocket mit dem FastAPI-Server,
 * rendert die Fahrzeugtabelle und das Detail-Panel live.
 */

"use strict";

// ─── Konfiguration ───────────────────────────────────────────────────────────
const WS_URL    = `ws://${location.host}/ws`;
const RECONNECT_DELAY_MS = 3000;

// ─── Zustand ─────────────────────────────────────────────────────────────────
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

// ─── DOM-Referenzen ──────────────────────────────────────────────────────────
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

// ─── Hilfsfunktionen ─────────────────────────────────────────────────────────
const esc = s => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

function fmtSpeed(kmh) {
  if (kmh === 0 || kmh == null) return '<span class="speed-slow">0 km/h</span>';
  const cls = kmh > 180 ? "speed-fast" : kmh > 60 ? "speed-medium" : "speed-slow";
  return `<span class="speed-cell ${cls}">${kmh} km/h</span>`;
}

function fmtType(type) {
  const map = { RAIL:"🚆 Zug", ROAD:"🚌 Bus", TRAM:"🚋 Tram", WATER:"⛴ Schiff", AIR:"✈ Flug" };
  const label = map[type] || type;
  return `<span class="type-badge type-${type}">${esc(label)}</span>`;
}

function fmtState(state) {
  const raw = String(state || "UNKNOWN").toUpperCase();
  const map = {
    IN_TRANSIT:  { label: "Fährt", cls: "moving" },
    EN_ROUTE:    { label: "Fährt", cls: "moving" },
    AT_TERMINAL: { label: "Am Halt", cls: "stop" },
    STOPPED:     { label: "Gestoppt", cls: "stopped" },
    LOADING:     { label: "Beladung", cls: "service" },
    UNLOADING:   { label: "Entladung", cls: "service" },
    WAITING:     { label: "Wartet", cls: "idle" },
  };
  const meta = map[raw] || { label: raw || "UNKNOWN", cls: "unknown" };
  return `<span class="state-badge state-${meta.cls}">${esc(meta.label)}</span>`;
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
  if (delta < 5)  return "gerade eben";
  if (delta < 60) return `vor ${delta}s`;
  return `vor ${Math.round(delta/60)}min`;
}

function fmtGameTime(gt) {
  if (!gt) return "–";
  
  if (typeof gt === "number") {
    return `Spielzeit: ${gt}`;
  }
  
  if (typeof gt === "object") {
    // TPF2 packt das Datum in ein "date"-Unterobjekt
    const dateObj = gt.date || gt;
    const { year, month, day, hour, minute } = dateObj;
    
    if (year != null) {
      const m = String(month||1).padStart(2,"0");
      const d = String(day||1).padStart(2,"0");
      
      // TPF2 liefert standardmäßig keine Uhrzeit mit, wir blenden sie aus, wenn sie fehlt
      if (hour != null || minute != null) {
          const h = String(hour||0).padStart(2,"0");
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
  const idKey = which === "last" ? "last_stop_id" : "next_stop_id";
  const nameKey = which === "last" ? "last_stop_name" : "next_stop_name";
  const stopId = Number(v[idKey] || 0);
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

// ─── Filterung & Sortierung ──────────────────────────────────────────────────
function filteredVehicles() {
  let list = _state.vehicles || [];

  // Typ-Filter
  if (_filterType !== "ALL") {
    list = list.filter(v => getVehicleType(v) === _filterType);
  }

  // Suche
  if (_searchQuery) {
    const q = _searchQuery.toLowerCase();
    list = list.filter(v =>
      (v.name       || "").toLowerCase().includes(q) ||
      (v.line_name  || "").toLowerCase().includes(q) ||
      resolveStopName(v, "last").toLowerCase().includes(q) ||
      resolveStopName(v, "next").toLowerCase().includes(q)
    );
  }

  // Spalten-Filter
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

  // Sortierung
  list = [...list].sort((a, b) => {
    const aOcc = (a.capacity || 0) > 0 ? (a.passengers || 0) / a.capacity : -1;
    const bOcc = (b.capacity || 0) > 0 ? (b.passengers || 0) / b.capacity : -1;

    switch (_sortKey) {
      case "speed":      return (b.speed_kmh || 0) - (a.speed_kmh || 0);
      case "passengers": return (b.passengers || 0) - (a.passengers || 0);
      case "type": {
        // Typ-Sortierung nur sinnvoll bei "Alle"; bei aktivem Typ-Filter fallback auf Name
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
    const key = th.dataset.filterKey;
    const active = Boolean(_columnFilters[key]);
    th.classList.toggle("filtered", active);
    th.title = active
      ? `Filter aktiv: ${_columnFilters[key]}`
      : "Zum Filterfeld klicken";
  });

  document.querySelectorAll(".col-filter-input[data-filter-key]").forEach(input => {
    const key = input.dataset.filterKey;
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
    lastUpdateBox.textContent = "Aktualisiert: " + timeAgo(_state.timestamp);
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
      ${_searchQuery || _filterType !== "ALL" ? "Keine Ergebnisse für diese Filtereinstellungen." : "Warte auf Fahrzeugdaten…"}
    </td></tr>`;
    return;
  }

  // Leere/Placeholder-Zeilen entfernen, wenn echte Daten vorhanden sind
  for (const row of tbody.querySelectorAll("tr:not([data-vid])")) {
    row.remove();
  }

  // Effizientes Diff-Update: nur geänderte Zeilen neu rendern
  const existing = new Map();
  for (const row of tbody.querySelectorAll("tr[data-vid]")) {
    existing.set(String(row.dataset.vid), row);
  }

  const seen = new Set();
  let cursor = tbody.firstElementChild;

  for (const v of list) {
    const vid = String(v.id);
    seen.add(vid);
    const vType = getVehicleType(v);
    const lastStopName = resolveStopName(v, "last");
    const nextStopName = resolveStopName(v, "next");

    const pct = v.capacity > 0 ? Math.round(v.passengers / v.capacity * 100) : 0;
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
      // Prüfen ob sich etwas geändert hat
      const newInner = rowHTML.trim();
      if (row.innerHTML.trim() !== newInner) {
        row.innerHTML = rowHTML;
      }
    } else {
      row = document.createElement("tr");
      row.dataset.vid = vid;
      row.innerHTML = rowHTML;
      row.addEventListener("click", () => openDetail(vid));
    }

    if (String(vid) === String(_selectedVid)) row.classList.add("selected");
    else row.classList.remove("selected");

    // Nur verschieben, wenn wirklich nötig (verhindert unnötiges "Neu"-Verhalten)
    if (row === cursor) {
      cursor = cursor ? cursor.nextElementSibling : null;
    } else {
      tbody.insertBefore(row, cursor);
    }
  }

  // Entferne Zeilen, die nicht mehr sichtbar sind
  for (const [vid, row] of existing) {
    if (!seen.has(vid)) row.remove();
  }
}

// ─── Detail-Panel ────────────────────────────────────────────────────────────
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
    ["ID",            v.id],
    ["Typ",           getVehicleType(v)],
    ["Linie",         v.line_name || `#${v.line_id}`],
    ["Zustand",       v.state],
    null, // divider
    ["Geschwindigkeit", `${v.speed_kmh} km/h (${v.speed_ms} m/s)`],
    ["Richtung",      v.direction === 1 ? "→ vorwärts" : "← rückwärts"],
    null,
    ["Passagiere",    `${v.passengers} / ${v.capacity || "?"}`],
    v.cargo_capacity > 0 ? ["Fracht", `${v.cargo} / ${v.cargo_capacity}`] : null,
    null,
    ["Letzter Halt",  lastStopName || `#${v.last_stop_id}`],
    ["Nächster Halt", nextStopName || `#${v.next_stop_id}`],
    null,
    ["Position X",    v.position ? v.position.x : "–"],
    ["Position Y",    v.position ? v.position.y : "–"],
    ["Position Z",    v.position ? v.position.z : "–"],
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

  // Aktive Zeile in Tabelle markieren
  if (rerenderTable) renderTable();
}

document.getElementById("detail-close").addEventListener("click", () => {
  _selectedVid = null;
  detailPanel.classList.add("hidden");
  renderTable();
});

// ─── Filter-Events ───────────────────────────────────────────────────────────
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
  const key = th.dataset.filterKey;
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

// ─── WebSocket-Verbindung ────────────────────────────────────────────────────
function setConnState(state) {
  // state: "connecting" | "connected" | "disconnected"
  connDot.className = "dot " + state;
  const labels = { connecting: "Verbinde…", connected: "Live", disconnected: "Getrennt" };
  connLabel.textContent = labels[state] || state;
}

function connectWS() {
  if (_ws && _ws.readyState <= 1) return; // bereits verbunden / verbindend
  setConnState("connecting");

  _ws = new WebSocket(WS_URL);

  _ws.onopen = () => {
    setConnState("connected");
    _reconnecting = false;
  };

  _ws.onmessage = evt => {
    try {
      const data = JSON.parse(evt.data);
      // Keepalive-Ping ignorieren
      if (data.type === "ping") return;
      _state = data;
      rebuildIndexes();
      renderStats();
      renderTable();
      // Detail-Panel aktualisieren falls offen
      if (_selectedVid != null) openDetail(_selectedVid, false);
    } catch (e) {
      console.warn("WebSocket-Parsefehler:", e);
    }
  };

  _ws.onerror = err => {
    console.warn("WebSocket-Fehler:", err);
  };

  _ws.onclose = () => {
    setConnState("disconnected");
    if (!_reconnecting) {
      _reconnecting = true;
      setTimeout(connectWS, RECONNECT_DELAY_MS);
    }
  };
}

// ─── Init ────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  // Initialen Datenabruf über REST (falls WS noch nicht bereit)
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

  // WebSocket starten
  connectWS();
  updateHeaderFilterIndicators();

  // Statusleiste jede Sekunde aktualisieren (Zeitanzeige)
  setInterval(() => {
    if (_state.timestamp) {
      lastUpdateBox.textContent = "Aktualisiert: " + timeAgo(_state.timestamp);
    }
  }, 1000);
});
