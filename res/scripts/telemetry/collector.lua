--- TPF2 Telemetrie-Collector
-- Sammelt Echtzeitdaten aller Fahrzeuge und schreibt sie in eine JSON-Datei.
-- @module telemetry.collector

local collector = {}

-- ─────────────────────────────────────────────────────────────────────────────
-- Konfiguration
-- ─────────────────────────────────────────────────────────────────────────────
local _outputPath     = nil
local _writeInterval  = 2
-- os.time() ist in TPF2 nicht verfuegbar; wir zaehlen Aufrufe als Throttle
local _callCounter    = 0
local _lastWriteCall  = 0
local _lastEventCall  = 0

-- ─────────────────────────────────────────────────────────────────────────────
-- Hilfsfunktionen: sicheres API-Aufruf-Wrapper
-- ─────────────────────────────────────────────────────────────────────────────

local function safeCall(fn, ...)
    local ok, result = pcall(fn, ...)
    if ok then return result end
    return nil
end

--- Gibt eine Ganzzahl oder 0 zurueck
local function safeInt(v)
    if type(v) == "number" then return math.floor(v) end
    return 0
end

--- Extrahiert eine Entity-ID aus Zahl oder Tabelle.
local function toEntityId(v)
    if type(v) == "number" then return safeInt(v) end
    if type(v) == "table" then
        return safeInt(v.entity or v.id or v.entityId or v.entity_id or 0)
    end
    return 0
end

--- Gibt einen String oder "" zurueck
local function safeStr(v)
    if type(v) == "string" then return v end
    return ""
end

--- Gibt einen Float oder 0.0 zurueck (gerundet auf 2 Stellen)
local function safeFloat(v, digits)
    digits = digits or 2
    if type(v) == "number" then
        local factor = 10 ^ digits
        return math.floor(v * factor + 0.5) / factor
    end
    return 0.0
end

-- ─────────────────────────────────────────────────────────────────────────────
-- JSON-Serialisierung (leichtgewichtig, ohne externe Bibliothek)
-- ─────────────────────────────────────────────────────────────────────────────

local JSON = {}

local function jsonEscape(s)
    s = tostring(s)
    s = s:gsub('\\', '\\\\')
    s = s:gsub('"',  '\\"')
    s = s:gsub('\n', '\\n')
    s = s:gsub('\r', '\\r')
    s = s:gsub('\t', '\\t')
    return s
end

function JSON.encode(val, indent, level)
    indent = indent or ""
    level  = level or 0
    local t = type(val)

    if t == "nil"     then return "null"
    elseif t == "boolean" then return tostring(val)
    elseif t == "number"  then
        if val ~= val then return "null" end  -- NaN guard
        if val == math.huge or val == -math.huge then return "null" end
        return tostring(val)
    elseif t == "string" then
        return '"' .. jsonEscape(val) .. '"'
    elseif t == "table" then
        -- Pruefe, ob es ein Array ist (aufeinanderfolgende Integer-Schluessel ab 1)
        local isArray = true
        local maxN = 0
        for k, _ in pairs(val) do
            if type(k) ~= "number" or k ~= math.floor(k) or k < 1 then
                isArray = false; break
            end
            if k > maxN then maxN = k end
        end
        if isArray and maxN == #val then
            -- Array
            local parts = {}
            for i = 1, #val do
                parts[i] = JSON.encode(val[i], indent, level + 1)
            end
            if indent == "" then
                return "[" .. table.concat(parts, ",") .. "]"
            else
                local nl   = "\n" .. string.rep(indent, level + 1)
                local nlE  = "\n" .. string.rep(indent, level)
                return "[\n" .. string.rep(indent, level+1) .. table.concat(parts, "," .. nl) .. nlE .. "]"
            end
        else
            -- Objekt
            local parts = {}
            local keys  = {}
            for k in pairs(val) do keys[#keys+1] = k end
            table.sort(keys, function(a, b)
                return tostring(a) < tostring(b)
            end)
            for _, k in ipairs(keys) do
                local keyStr = '"' .. jsonEscape(tostring(k)) .. '"'
                local sep    = indent == "" and ":" or ": "
                parts[#parts+1] = keyStr .. sep .. JSON.encode(val[k], indent, level + 1)
            end
            if indent == "" then
                return "{" .. table.concat(parts, ",") .. "}"
            else
                local nl  = ",\n" .. string.rep(indent, level + 1)
                local nlS = "\n" .. string.rep(indent, level + 1)
                local nlE = "\n" .. string.rep(indent, level)
                return "{" .. nlS .. table.concat(parts, nl) .. nlE .. "}"
            end
        end
    end
    return "null"
end

-- ─────────────────────────────────────────────────────────────────────────────
-- TPF2 API Abstraktion
-- game.interface ist die stabilste Schnittstelle; api.engine als Erweiterung
-- ─────────────────────────────────────────────────────────────────────────────

-- Schreibt eine Diagnose-Datei mit allen verfuegbaren API-Infos.
-- Kann mehrfach aufgerufen werden (unterschiedliche Dateinamen = unterschiedliche Kontexte).
local _diagWritten = false
local function writeDiag(path, filename)
    filename = filename or "telemetry_diag.txt"
    local f = io.open(path .. filename, "w")
    if not f then return end
    f:write("=== TPF2 Telemetrie Diagnose [" .. filename .. "] ===\n")
    f:write("game available: "           .. tostring(game ~= nil) .. "\n")
    f:write("game.interface available: " .. tostring(game ~= nil and game.interface ~= nil) .. "\n")
    if game and game.interface then
        local gi = game.interface
        -- Alle bekannten Funktionen pruefen
        for _, fn in ipairs({"getEntity","getEntityList","getVehicle","getLine",
                              "getLines","getStation","getStations","getSimulationTime",
                              "getGameTime","getTransportLine","getTransportLines"}) do
            f:write("gi." .. fn .. ": " .. tostring(type(gi[fn])) .. "\n")
        end
    end
    f:write("api available: "   .. tostring(api ~= nil) .. "\n")
    if api then
        f:write("api.engine: "  .. tostring(type(api.engine)) .. "\n")
        if api.engine then
            f:write("api.engine.getEntityList: " .. tostring(type(api.engine.getEntityList)) .. "\n")
        end
        f:write("api.type: "    .. tostring(type(api.type)) .. "\n")
        if api.type then
            f:write("api.type.ComponentType: " .. tostring(type(api.type.ComponentType)) .. "\n")
            f:write("api.type.EntityType: "    .. tostring(type(api.type.EntityType))    .. "\n")
            -- EntityType-Inhalt dumpen (die eigentlichen Konstanten)
            if api.type.EntityType then
                f:write("EntityType contents:\n")
                local et = api.type.EntityType
                local keys = {}
                for k in pairs(et) do keys[#keys+1] = k end
                table.sort(keys, function(a,b) return tostring(a) < tostring(b) end)
                for _, k in ipairs(keys) do
                    f:write("  " .. tostring(k) .. " = " .. tostring(et[k]) .. "\n")
                end
            end
            -- ComponentType-Inhalt dumpen
            if api.type.ComponentType then
                f:write("ComponentType contents (first 20):\n")
                local ct = api.type.ComponentType
                local keys = {}
                for k in pairs(ct) do keys[#keys+1] = k end
                table.sort(keys, function(a,b) return tostring(a) < tostring(b) end)
                for i = 1, math.min(20, #keys) do
                    local k = keys[i]
                    f:write("  " .. tostring(k) .. " = " .. tostring(ct[k]) .. "\n")
                end
            end
        end
    end
    -- Zeige was api.type selbst enthaelt
    if api and api.type then
        f:write("api.type keys: ")
        local keys = {}
        for k in pairs(api.type) do keys[#keys+1] = tostring(k) end
        table.sort(keys)
        f:write(table.concat(keys, ", ") .. "\n")
    end
    -- Teste Fahrzeug-Enumeration und zeige Ergebnis
    f:write("--- Fahrzeug-Test ---\n")
    if api and api.engine and api.engine.getEntityList then
        if api.type and api.type.EntityType then
            local ET = api.type.EntityType
            if ET.VEHICLE then
                local ok2, r = pcall(api.engine.getEntityList, ET.VEHICLE)
                f:write("getEntityList(ET.VEHICLE=" .. tostring(ET.VEHICLE) .. "): ok=" .. tostring(ok2) .. " count=" .. (ok2 and r and tostring(#r) or "err") .. "\n")
            end
        end
        -- Rohe Zahlen ausprobieren
        for _, v in ipairs({1,2,3,4,5,6,7,8,9,10,11,12}) do
            local ok2, r = pcall(api.engine.getEntityList, v)
            if ok2 and r and #r > 0 then
                f:write("getEntityList(" .. v .. "): count=" .. #r .. " [TREFFER]\n")
            end
        end
    else
        f:write("api.engine.getEntityList nicht verfuegbar\n")
    end
    f:close()
end

-- Gibt alle Fahrzeug-IDs zurueck.
-- Funktioniert nur im Runtime-Kontext (nach game.interface-Injection)!
local function getAllVehicleIds()
    -- Weg 0: game.interface.getVehicles() (stabilster Weg in GUI-/Runtime-State)
    if game and game.interface and game.interface.getVehicles then
        local r = safeCall(game.interface.getVehicles)
        if r and type(r) == "table" and #r > 0 then
            local ids = {}
            for _, v in ipairs(r) do
                local id = toEntityId(v)
                if id ~= 0 then ids[#ids+1] = id end
            end
            if #ids > 0 then return ids end
        end
    end

    -- Weg 1: api.engine mit api.type.EntityType (der korrekte TPF2-Weg)
    if api and api.engine and api.engine.getEntityList then
        if api.type and api.type.EntityType then
            local ET = api.type.EntityType
            -- Direkt VEHICLE versuchen
            for _, k in ipairs({"VEHICLE", "TRANSPORT_VEHICLE", "Vehicle", "vehicle"}) do
                if ET[k] then
                    local r = safeCall(api.engine.getEntityList, ET[k])
                    if r and #r > 0 then return r end
                end
            end
            -- Alle EntityType-Eintraege mit "VEHICLE" im Namen
            for k, v in pairs(ET) do
                if type(k) == "string" and k:upper():find("VEHICLE") then
                    local r = safeCall(api.engine.getEntityList, v)
                    if r and #r > 0 then return r end
                end
            end
        end
        -- Weg 2: Rohe Ganzzahl-IDs durchprobieren (1-15)
        for _, id in ipairs({10, 9, 8, 7, 6, 5, 4, 3, 11, 12, 13, 14, 15, 2, 1}) do
            local r = safeCall(api.engine.getEntityList, id)
            if r and type(r) == "table" and #r > 0 then return r end
        end
    end
    return {}
end

local function getAllLineIds()
    if game and game.interface then
        local gi = game.interface
        -- game.interface.getLines() ist der Standard-Weg
        if gi.getLines then
            local r = safeCall(gi.getLines)
            if r and type(r) == "table" and #r > 0 then
                local ids = {}
                for _, v in ipairs(r) do
                    local id = toEntityId(v)
                    if id ~= 0 then ids[#ids+1] = id end
                end
                if #ids > 0 then return ids end
            end
        end
        for _, t in ipairs({"LINE", "entity.LINE", "TRANSPORT_LINE"}) do
            if gi.getEntityList then
                local r = safeCall(gi.getEntityList, t)
                if r and #r > 0 then return r end
            end
        end
    end
    return {}
end

local function getAllStationIds()
    if game and game.interface then
        local gi = game.interface
        if gi.getStations then
            local r = safeCall(gi.getStations)
            if r and type(r) == "table" and #r > 0 then
                local ids = {}
                for _, v in ipairs(r) do
                    local id = toEntityId(v)
                    if id ~= 0 then ids[#ids+1] = id end
                end
                if #ids > 0 then return ids end
            end
        end
        for _, t in ipairs({"STATION", "entity.STATION"}) do
            if gi.getEntityList then
                local r = safeCall(gi.getEntityList, t)
                if r and #r > 0 then return r end
            end
        end
    end
    return {}
end

-- Gibt alle Signal-IDs zurueck
local function getAllSignalIds()
    local ids = {}
    if api and api.engine and api.engine.getEntityList and api.type and api.type.EntityType then
        local ET = api.type.EntityType
        for _, k in ipairs({"SIGNAL", "RAIL_SIGNAL", "RAILROAD_SIGNAL"}) do
            if ET[k] then
                local r = safeCall(api.engine.getEntityList, ET[k])
                if r and #r > 0 then return r end
            end
        end
        for k, v in pairs(ET) do
            if type(k) == "string" and k:upper():find("SIGNAL") then
                local r = safeCall(api.engine.getEntityList, v)
                if r and #r > 0 then return r end
            end
        end
        -- Fallback: bekannte Signal-EntityType-IDs aus TPF2 (robust gegen API-Namensabweichungen)
        for _, raw in ipairs({18, 17, 16, 19, 20}) do
            local r = safeCall(api.engine.getEntityList, raw)
            if r and #r > 0 then return r end
        end
    end
    return ids
end

-- Gibt eine Entitaet zurueck (game.interface.getEntity ist am zuverlaessigsten)
local function getEntity(id)
    if game and game.interface and game.interface.getEntity then
        return safeCall(game.interface.getEntity, id)
    end
    return nil
end

-- Gibt eine Linie zurueck
local function getLine(id)
    if game and game.interface then
        if game.interface.getLine then
            local r = safeCall(game.interface.getLine, id)
            if r then return r end
        end
        if game.interface.getEntity then
            return safeCall(game.interface.getEntity, id)
        end
    end
    return nil
end

-- Gibt ein Fahrzeug zurueck.
local function getVehicle(id)
    if game and game.interface then
        if game.interface.getVehicle then
            local r = safeCall(game.interface.getVehicle, id)
            if r then return r end
        end
        if game.interface.getEntity then
            local r = safeCall(game.interface.getEntity, id)
            if r then return r end
        end
    end
    return nil
end

-- ─────────────────────────────────────────────────────────────────────────────
-- Spielzeiterfassung
-- ─────────────────────────────────────────────────────────────────────────────

local function getGameTime()
    -- Versuche Spielzeit (In-Game-Jahr / Datum) zu ermitteln
    if game and game.interface and game.interface.getGameTime then
        local t = safeCall(game.interface.getGameTime)
        if t then return t end
    end
    if api and api.engine and api.engine.getGameTime then
        local t = safeCall(api.engine.getGameTime)
        if t then return t end
    end
    return nil
end

-- ─────────────────────────────────────────────────────────────────────────────
-- Stationsdaten-Cache (wird bei jedem Schreiben neu aufgebaut)
-- ─────────────────────────────────────────────────────────────────────────────

local _stationCache = {}
local _terminalToStation = {} -- NEU: Mapping Terminal -> Station

local function buildStationCache()
    _stationCache = {}
    _terminalToStation = {}
    local ids = getAllStationIds()
    for _, sid in ipairs(ids) do
        local name   = ""
        local pos    = {x = 0, y = 0, z = 0}
        local sidInt = safeInt(sid)

        local ent = getEntity(sid)
        if ent then
            name = safeStr(ent.name or "")
            -- Position: TPF2 liefert entweder .position oder .transform (4x4-Matrix)
            if ent.position then
                pos = {
                    x = safeFloat(ent.position[1] or ent.position.x or 0),
                    y = safeFloat(ent.position[2] or ent.position.y or 0),
                    z = safeFloat(ent.position[3] or ent.position.z or 0),
                }
            elseif ent.transform then
                pos = {
                    x = safeFloat(ent.transform[13] or 0),
                    y = safeFloat(ent.transform[14] or 0),
                    z = safeFloat(ent.transform[15] or 0),
                }
            end

            -- Sub-Entitaeten der Station auslesen und im Mapping speichern
            -- Verschiedene Feldnamen fuer Sub-Entitaeten ausprobieren
            for _, field in ipairs({"terminals", "components", "platforms", "nodes", "stops", "tracks"}) do
                if type(ent[field]) == "table" then
                    for _, subId in ipairs(ent[field]) do
                        local subIdInt = safeInt(subId)
                        if subIdInt ~= 0 then
                            _terminalToStation[subIdInt] = sidInt
                        end
                    end
                end
            end
        end

        _stationCache[sidInt] = {
            id   = sidInt,
            name = name ~= "" and name or ("Station #" .. sidInt),
            pos  = pos,
        }
    end
    return _stationCache
end

-- ─────────────────────────────────────────────────────────────────────────────
-- Liniendaten
-- ─────────────────────────────────────────────────────────────────────────────

local function collectLines()
    local lines = {}
    local ids = getAllLineIds()

    -- NEU: Hilfsfunktion, um aus einer ID (Station oder Terminal) die Station zu finden
    local function resolveToStationId(id)
        id = safeInt(id)
        if id == 0 then return 0 end
        if _stationCache[id] then return id end
        if _terminalToStation[id] then return _terminalToStation[id] end
        
        -- Fallback: Terminal-Entity laden und prüfen
        local tEnt = getEntity(id)
        if tEnt then
            for _, field in ipairs({"station", "stationGroup", "stationEntity", "owner", "parent", "group"}) do
                local sId = safeInt(tEnt[field] or 0)
                if sId ~= 0 and _stationCache[sId] then
                    _terminalToStation[id] = sId -- cachen
                    return sId
                end
            end
        end
        return 0
    end

    local function findStationIdDeep(val, depth, visited)
        depth = depth or 0
        visited = visited or {}
        if depth > 5 then return 0 end

        local t = type(val)
        if t == "number" then
            return resolveToStationId(val)
        end

        if t ~= "table" then return 0 end
        if visited[val] then return 0 end
        visited[val] = true

        local preferred = {
            "stationEntity", "stationEntityId", "station", "stationId",
            "station_id", "terminalEntity", "terminalEntityId", "terminal",
            "terminalId", "entity", "entityId", "id",
        }
        for _, k in ipairs(preferred) do
            local v = val[k]
            if type(v) == "number" then
                local sId = resolveToStationId(v)
                if sId ~= 0 then return sId end
            elseif type(v) == "table" then
                local nested = findStationIdDeep(v, depth + 1, visited)
                if nested ~= 0 then return nested end
            end
        end

        for _, v in pairs(val) do
            local nested = findStationIdDeep(v, depth + 1, visited)
            if nested ~= 0 then return nested end
        end

        return 0
    end

    local function extractStationIdFromStop(stop)
        if type(stop) == "number" then
            local n = safeInt(stop)
            local sId = resolveToStationId(n)
            if sId ~= 0 then return sId, n end
            return 0, n 
        end

        if type(stop) ~= "table" then return 0, 0 end

        local rawId = safeInt(
            stop.stationEntity or stop.stationEntityId or
            stop.station or stop.stationId or
            stop.terminalEntity or stop.terminalEntityId or
            stop.stopEntity or stop.stopEntityId or
            stop.stop or stop.stopId or
            stop.entity or stop.id or 0
        )

        local sId = resolveToStationId(rawId)
        if sId ~= 0 then return sId, rawId end

        local deep = findStationIdDeep(stop, 0, {})
        if deep ~= 0 then return deep, rawId end

        return 0, rawId
    end

    local function resolveStopDisplayName(stopId, stopObj)
        if type(stopObj) == "table" then
            local direct = safeStr(
                stopObj.name or stopObj.stopName or stopObj.stationName or
                stopObj.terminalName or stopObj.label or ""
            )
            if direct ~= "" then return direct end
        end

        local cached = _stationCache[safeInt(stopId)]
        if cached and cached.name and cached.name ~= "" then
            return cached.name
        end

        if stopId ~= 0 then
            local ent = getEntity(stopId)
            if ent then
                local entName = safeStr(ent.name or ent.stationName or ent.terminalName or "")
                if entName ~= "" then
                    return entName
                end
            end
        end

        return ""
    end

    for _, lid in ipairs(ids) do
        local ent = getLine(lid)
        local name = ""
        local stops = {}
        local vehicleType = "UNKNOWN"

        if ent then
            name = safeStr(ent.name or "")
            local rawStops = ent.stops or ent.waypoints or {}
            for i, stop in ipairs(rawStops) do
                local stopId, rawStopId = extractStationIdFromStop(stop)

                local resolvedName = resolveStopDisplayName(stopId, stop)
                local stopInfo = _stationCache[stopId]
                stops[#stops+1] = {
                    index      = i,
                    station_id = stopId,
                    raw_stop_id= rawStopId,
                    name       = resolvedName ~= "" and resolvedName
                                 or (stopInfo and stopInfo.name)
                                 or (stopId ~= 0 and ("Stop #" .. stopId) or ("Stop #" .. safeInt(rawStopId))),
                }
            end
            vehicleType = safeStr(ent.vehicleType or ent.transportMode or "UNKNOWN")
        end

        lines[#lines+1] = {
            id           = safeInt(lid),
            name         = name ~= "" and name or ("Line #" .. safeInt(lid)),
            vehicle_type = vehicleType,
            stops        = stops,
            stop_count   = #stops,
        }
    end
    return lines
end

-- ─────────────────────────────────────────────────────────────────────────────
-- Strecken / Pfade
-- ─────────────────────────────────────────────────────────────────────────────

local function normalizePoint(pt)
    if type(pt) ~= "table" then return nil end
    local x = pt.x or pt[1] or pt[0]
    local y = pt.y or pt[2] or pt[1]
    if x == nil or y == nil then return nil end
    return { x = safeFloat(x), y = safeFloat(y) }
end

local function extractEdgePoints(edgeId)
    if not (api and api.engine and api.engine.getComponent and api.type and api.type.ComponentType) then
        return {}
    end
    local CT = api.type.ComponentType
    local comp = safeCall(api.engine.getComponent, edgeId, CT.BASE_EDGE)
              or (CT.TRACK_EDGE and safeCall(api.engine.getComponent, edgeId, CT.TRACK_EDGE))
              or (CT.STREET_EDGE and safeCall(api.engine.getComponent, edgeId, CT.STREET_EDGE))
              or (CT.SIGNAL and safeCall(api.engine.getComponent, edgeId, CT.SIGNAL))

    if not comp then return {} end

    local geom = comp.geometry or comp.geo or comp.geom
    local coords = nil
    if geom then
        coords = geom.coords or geom.points or geom.vertices or geom.samples or geom.middle or geom.positions
        if not coords and geom.params and geom.params.pos then coords = geom.params.pos end
    end

    local pts = {}
    if type(coords) == "table" then
        for _, p in ipairs(coords) do
            local np = normalizePoint(p)
            if np then pts[#pts+1] = np end
        end
    elseif comp.node0 and comp.node1 then
        local n0 = safeCall(api.engine.getComponent, comp.node0, CT.BASE_NODE)
        local n1 = safeCall(api.engine.getComponent, comp.node1, CT.BASE_NODE)
        if n0 and n0.position and n1 and n1.position then
            pts[#pts+1] = { x = safeFloat(n0.position.x or n0.position[1] or 0), y = safeFloat(n0.position.y or n0.position[2] or 0) }
            pts[#pts+1] = { x = safeFloat(n1.position.x or n1.position[1] or 0), y = safeFloat(n1.position.y or n1.position[2] or 0) }
        end
    end
    return pts
end

local function collectLinePath(lineId, lineStops)
    local points = {}
    local tn = api and api.engine and api.engine.system and api.engine.system.transportNetwork
    if tn then
        local ldata = safeCall(tn.getLine, lineId)
                  or safeCall(tn.getLineObject, lineId)
                  or safeCall(tn.getLineData, lineId)
        local edgeLists = {}
        if type(ldata) == "table" then
            for _, key in ipairs({"edgeList","edges","edgeIds","segments"}) do
                if type(ldata[key]) == "table" then edgeLists[#edgeLists+1] = ldata[key] end
            end
        end
        if tn.getLineEdges then
            local extra = safeCall(tn.getLineEdges, lineId)
            if type(extra) == "table" then edgeLists[#edgeLists+1] = extra end
        end
        for _, edgeList in ipairs(edgeLists) do
            for _, e in ipairs(edgeList) do
                local eid = toEntityId(e)
                if eid ~= 0 then
                    local pts = extractEdgePoints(eid)
                    for _, p in ipairs(pts) do points[#points+1] = p end
                end
            end
            if #points > 0 then break end
        end
    end

    if #points == 0 and type(lineStops) == "table" then
        for _, s in ipairs(lineStops) do
            local pos = nil
            if s.station_id and _stationCache[s.station_id] then
                pos = _stationCache[s.station_id].pos
            end
            if (not pos) and s.raw_stop_id and s.raw_stop_id ~= 0 then
                local ent = getEntity(s.raw_stop_id)
                if ent and ent.position then
                    pos = {
                        x = safeFloat(ent.position[1] or ent.position.x or 0),
                        y = safeFloat(ent.position[2] or ent.position.y or 0)
                    }
                elseif ent and ent.transform then
                    pos = {
                        x = safeFloat(ent.transform[13] or 0),
                        y = safeFloat(ent.transform[14] or 0)
                    }
                end
            end
            if pos then points[#points+1] = { x = safeFloat(pos.x), y = safeFloat(pos.y) } end
        end
    end

    return points
end

local function collectPaths(lines)
    local paths = {}
    for _, line in ipairs(lines) do
        local pts = collectLinePath(line.id, line.stops)
        if #pts > 0 then
            paths[#paths+1] = { line_id = line.id, points = pts }
        end
    end
    return paths
end

-- ─────────────────────────────────────────────────────────────────────────────
-- Fahrzeugdaten
-- ─────────────────────────────────────────────────────────────────────────────

-- Konvertiert m/s in km/h
local function msToKmh(ms)
    if type(ms) == "number" then
        return safeFloat(ms * 3.6, 1)
    end
    return 0.0
end

-- Extrahiert die Position aus einem Transform-Array (4x4 Matrix, row-major)
-- In TPF2: xf[13], xf[14], xf[15] = Translation X, Y, Z
local function extractPosition(xf)
    if type(xf) ~= "table" then return {x=0, y=0, z=0} end
    -- Spalten-Format (Standard): col4 = translation
    local x = xf[13] or xf[4]  or 0
    local y = xf[14] or xf[8]  or 0
    local z = xf[15] or xf[12] or 0
    return {
        x = safeFloat(x),
        y = safeFloat(y),
        z = safeFloat(z),
    }
end

local function collectVehicles()
    local vehicles = {}
    local ids = getAllVehicleIds()

    for _, vid in ipairs(ids) do
        -- game.interface.getVehicle liefert oft die besten Runtime-Daten
        local ent = getVehicle(vid)
        if not ent then goto continue end

        -- Name
        local vName = safeStr(ent.name or "")
        if vName == "" then vName = "Vehicle #" .. safeInt(vid) end

        -- Position
        local pos = {x=0, y=0, z=0}
        if ent.position then
            pos = {
                x = safeFloat(ent.position[1] or ent.position.x or 0),
                y = safeFloat(ent.position[2] or ent.position.y or 0),
                z = safeFloat(ent.position[3] or ent.position.z or 0),
            }
        elseif ent.transform then
            pos = extractPosition(ent.transform)
        end

        -- Geschwindigkeit
        local speed_ms  = safeFloat(ent.speed or ent.velocity or 0, 3)
        local speed_kmh = msToKmh(speed_ms)

        -- Linie
        local lineId = safeInt(
            ent.lineIdx or ent.line or ent.lineId or
            ent.lineEntity or ent.lineEntityId or
            (ent.transportVehicle and ent.transportVehicle.lineIdx) or 0
        )

        -- Passagiere & Fracht (TPF2 speichert das in cargoLoad und capacities)
        local passengers = 0
        local capacity = 0
        local cargo = 0
        local cargo_cap = 0
        
        if type(ent.cargoLoad) == "table" then
            passengers = safeInt(ent.cargoLoad.PASSENGERS or ent.cargoLoad.passengers or 0)
            for k, v in pairs(ent.cargoLoad) do
                if k ~= "PASSENGERS" and k ~= "passengers" then cargo = cargo + safeInt(v) end
            end
        end
        
        if type(ent.capacities) == "table" then
            capacity = safeInt(ent.capacities.PASSENGERS or ent.capacities.passengers or 0)
            for k, v in pairs(ent.capacities) do
                if k ~= "PASSENGERS" and k ~= "passengers" then cargo_cap = cargo_cap + safeInt(v) end
            end
        end

        -- Zustand
        local state = safeStr(ent.state or "UNKNOWN")
        if state == "" then state = "UNKNOWN" end

        -- Fahrzeugtyp (RAIL, ROAD, WATER, AIR) aus 'carrier'
        local vType = safeStr(ent.carrier or "UNKNOWN")

        -- Halt-Index für spätere Anreicherung speichern
        local rawStopIndex = -1
        if ent.stopIndex ~= nil then
            rawStopIndex = safeInt(ent.stopIndex)
        end

        vehicles[#vehicles+1] = {
            id             = safeInt(vid),
            name           = vName,
            type           = vType,
            state          = state,
            line_id        = lineId,
            line_name      = "",  
            position       = pos,
            speed_ms       = speed_ms,
            speed_kmh      = speed_kmh,
            direction      = 1,
            passengers     = passengers,
            capacity       = capacity,
            cargo          = cargo,
            cargo_capacity = cargo_cap,
            last_stop_id   = 0,
            last_stop_name = "",
            next_stop_id   = 0,
            next_stop_name = "",
            raw_stop_index = rawStopIndex,
        }

        ::continue::
    end

    return vehicles
end

-- ─────────────────────────────────────────────────────────────────────────────
-- Signal-Daten
-- ─────────────────────────────────────────────────────────────────────────────

local function collectSignals()
    local signals = {}
    local ids = getAllSignalIds()

    for _, sid in ipairs(ids) do
        local ent = getEntity(sid)
        local pos = {x=0, y=0, z=0}
        if ent then
            if ent.position then
                pos = {
                    x = safeFloat(ent.position[1] or ent.position.x or 0),
                    y = safeFloat(ent.position[2] or ent.position.y or 0),
                    z = safeFloat(ent.position[3] or ent.position.z or 0),
                }
            elseif ent.transform then
                pos = extractPosition(ent.transform)
            end
        end

        local state = 0
        if api and api.engine and api.type and api.type.ComponentType and api.engine.getComponent then
            local comp = safeCall(api.engine.getComponent, sid, api.type.ComponentType.SIGNAL)
            if comp then
                state = safeInt(comp.state or comp.signalState or comp.mainState or comp.aspect or comp.value or 0)
            end
        end
        -- Normalisiere beliebige Signalzustände auf 0/1 (0=Rot/Halt, 1=Gruen/Fahrt)
        if state ~= 0 then state = state > 0 and 1 or 0 end

        signals[#signals+1] = {
            id    = safeInt(sid),
            pos   = pos,
            state = state,
        }
    end
    return signals
end

-- Liniendaten in Fahrzeuge eintragen (Name der Linie)
-- Liniendaten in Fahrzeuge eintragen (Name der Linie und Stationen)
local function enrichVehiclesWithLineNames(vehicles, lines)
    local lineMap = {}
    for _, line in ipairs(lines) do
        lineMap[line.id] = line
    end
    for _, v in ipairs(vehicles) do
        if v.line_id ~= 0 and lineMap[v.line_id] then
            local line = lineMap[v.line_id]
            v.line_name = line.name
            
            -- Nächster/Letzter Halt anhand des stopIndex aus der Linie berechnen
            if v.raw_stop_index and v.raw_stop_index >= 0 and line.stop_count > 0 then
                -- TPF2 stopIndex ist 0-basiert (Start bei 0), Lua Arrays starten bei 1
                local nextIdx = v.raw_stop_index + 1
                local lastIdx = nextIdx - 1
                -- Wenn wir am Anfang der Liste sind, war der letzte Halt am Ende der Liste
                if lastIdx < 1 then lastIdx = line.stop_count end
                
                if line.stops[nextIdx] then
                    local ns = line.stops[nextIdx]
                    local nId = ns.station_id ~= 0 and ns.station_id or ns.raw_stop_id
                    if nId and nId ~= 0 then v.next_stop_id = nId end
                    v.next_stop_name = ns.name
                end
                if line.stops[lastIdx] then
                    local ls = line.stops[lastIdx]
                    local lId = ls.station_id ~= 0 and ls.station_id or ls.raw_stop_id
                    if lId and lId ~= 0 then v.last_stop_id = lId end
                    v.last_stop_name = ls.name
                end
            end
        end
    end
end

-- ─────────────────────────────────────────────────────────────────────────────
-- Statistiken
-- ─────────────────────────────────────────────────────────────────────────────

local function buildStats(vehicles, lines, stations)
    local total_passengers = 0
    local total_vehicles   = #vehicles
    local by_type          = {}

    for _, v in ipairs(vehicles) do
        total_passengers = total_passengers + v.passengers
        by_type[v.type]  = (by_type[v.type] or 0) + 1
    end

    return {
        total_vehicles   = total_vehicles,
        total_passengers = total_passengers,
        total_lines      = #lines,
        total_stations   = #stations,
        vehicles_by_type = by_type,
    }
end

-- ─────────────────────────────────────────────────────────────────────────────
-- Atomares JSON-Schreiben (tmp + rename fuer konsistente Lesbarkeit)
-- ─────────────────────────────────────────────────────────────────────────────

local function writeJSON(data)
    local jsonStr = JSON.encode(data)
    if not jsonStr then
        print("[TPF2-Telemetry] JSON-Serialisierung fehlgeschlagen")
        return false
    end

    -- Direktes Schreiben (TPF2-Sandbox hat kein os.remove / os.rename)
    local f, err = io.open(_outputPath, "w")
    if not f then
        print("[TPF2-Telemetry] Kann Ausgabedatei nicht oeffnen: " .. tostring(err))
        return false
    end
    f:write(jsonStr)
    f:close()
    return true
end

-- ─────────────────────────────────────────────────────────────────────────────
-- Oeffentliche API des Moduls
-- ─────────────────────────────────────────────────────────────────────────────

--- Initialisiert den Collector mit dem Mod-Pfad.
-- @param modPath  Absoluter Pfad zum Mod-Verzeichnis (mit trailing slash)
-- @param interval Schreibintervall in Sekunden (optional, default 3)
function collector.setup(modPath, interval)
    _outputPath    = modPath .. "telemetry.json"
    _writeInterval = interval or 3
    _callCounter   = 0
    _lastWriteCall = 0
    _lastEventCall = 0
    print("[TPF2-Telemetry] Setup: " .. _outputPath .. " (Intervall: " .. _writeInterval .. "s)")
end

--- Fuehrt einen vollstaendigen Telemetrie-Snapshot durch und schreibt ihn.
function collector.write()
    if not _outputPath then
        print("[TPF2-Telemetry] WARNUNG: setup() wurde noch nicht aufgerufen!")
        return
    end

    -- Diagnose-Datei schreiben (beim allerersten write einmalig)
    local diagPath = _outputPath:gsub("telemetry%.json$", "")
    if not _diagWritten then
        writeDiag(diagPath)
        _diagWritten = true
    end

    -- Stationscache neu aufbauen
    local ok_stations, stations_data = pcall(buildStationCache)
    if not ok_stations then
        print("[TPF2-Telemetry] Fehler beim Aufbau des Stationscache: " .. tostring(stations_data))
        _stationCache = {}
    end

    -- Stationsliste fuer JSON
    local stations_list = {}
    for sid, sdata in pairs(_stationCache) do
        stations_list[#stations_list+1] = sdata
    end

    -- Linien sammeln
    local lines = {}
    local ok_lines, lines_or_err = pcall(collectLines)
    if ok_lines then
        lines = lines_or_err
    else
        print("[TPF2-Telemetry] Fehler beim Sammeln der Linien: " .. tostring(lines_or_err))
    end

    -- Fahrzeuge sammeln
    local vehicles = {}
    local ok_vehs, vehs_or_err = pcall(collectVehicles)
    if ok_vehs then
        vehicles = vehs_or_err
    else
        print("[TPF2-Telemetry] Fehler beim Sammeln der Fahrzeuge: " .. tostring(vehs_or_err))
    end

    -- Anreicherung
    enrichVehiclesWithLineNames(vehicles, lines)

    -- Pfade
    local paths = collectPaths(lines)

    -- Signale
    local signals = collectSignals()

    -- Spielzeit
    local gameTime = safeCall(getGameTime)

    -- Statistiken
    local stats = buildStats(vehicles, lines, stations_list)

    -- Payload
    local payload = {
        schema_version = 3,
        write_count    = _callCounter,   -- Zaehlerwert statt Echtzeit-Timestamp
        game_time      = gameTime,
        stats          = stats,
        vehicles       = vehicles,
        lines          = lines,
        stations       = stations_list,
        paths          = paths,
        signals        = signals,
    }

    local writeOk = writeJSON(payload)
    if writeOk then
        print("[TPF2-Telemetry] Snapshot: " .. #vehicles .. " Fahrzeuge, " .. #lines .. " Linien, " .. #stations_list .. " Stationen, " .. #paths .. " Pfade, " .. #signals .. " Signale")
    end
end

--- Wird aufgerufen, sobald game.interface verfuegbar ist (Runtime-Phase).
-- Schreibt eine Runtime-Diagnose und den ersten echten Snapshot.
function collector.onGameReady()
    if not _outputPath then
        print("[TPF2-Telemetry] onGameReady: setup() wurde noch nicht aufgerufen!")
        return
    end
    print("[TPF2-Telemetry] onGameReady: game.interface verfuegbar, Runtime-Diagnose wird geschrieben")
    local diagPath = _outputPath:gsub("telemetry%.json$", "")
    -- Runtime-Diagnose (ueberschreibt nicht die Startup-Diagnose)
    writeDiag(diagPath, "telemetry_diag_runtime.txt")
    -- Normalen Snapshot schreiben (jetzt mit echten Daten)
    _diagWritten = false  -- Haupt-Diag darf jetzt auch mit Runtime-Infos ueberschrieben werden
    collector.write()
end

--- Wird von mod.lua bei jedem Tick aufgerufen (falls setUpdateCallback verfuegbar).
-- dt ist Delta-Time in Sekunden. Wir summieren es als Zeitersatz.
function collector.onTick(dt)
    -- dt summieren; schreiben sobald genug Zeit vergangen ist
    _callCounter = _callCounter + (dt or 1)
    if (_callCounter - _lastWriteCall) >= _writeInterval then
        _lastWriteCall = _callCounter
        collector.write()
    end
end

--- Wird von CommonAPI2-Events aufgerufen.
function collector.onEvent(eventName, eventData)
    _callCounter = _callCounter + 1
    if (_callCounter - _lastEventCall) >= 1 then
        _lastEventCall = _callCounter
        collector.write()
    end
end

return collector
