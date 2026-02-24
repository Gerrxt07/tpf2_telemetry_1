--- TPF2 Telemetrie-Collector
-- Sammelt Echtzeitdaten aller Fahrzeuge, Gleise und Signale und schreibt
-- sie in eine JSON-Datei.
-- @module telemetry.collector

local collector = {}

-- ─────────────────────────────────────────────────────────────────────────────
-- Konfiguration
-- ─────────────────────────────────────────────────────────────────────────────
local _outputPath     = nil
local _writeInterval  = 2
local _callCounter    = 0
local _lastWriteCall  = 0
local _lastEventCall  = 0

-- Cached data that changes infrequently
local _trackCache     = nil
local _trackCacheAge  = 0
local _signalCache    = nil
local _signalCacheAge = 0
local _TRACK_CACHE_INTERVAL  = 30
local _SIGNAL_CACHE_INTERVAL = 10

-- ─────────────────────────────────────────────────────────────────────────────
-- Hilfsfunktionen
-- ─────────────────────────────────────────────────────────────────────────────

local function safeCall(fn, ...)
    local ok, result = pcall(fn, ...)
    if ok then return result end
    return nil
end

local function safeInt(v)
    if type(v) == "number" then return math.floor(v) end
    return 0
end

local function toEntityId(v)
    if type(v) == "number" then return safeInt(v) end
    if type(v) == "table" then
        return safeInt(
            v.entity or v.id or v.entityId or v.entity_id or
            v.edge or v.edgeId or v.edge_id or
            v.node or v.nodeId or v.node_id or
            v.signal or v.signalId or v.signal_id or
            v.station or v.stationId or v.station_id or
            v.terminal or v.terminalId or v.terminal_id or 0
        )
    end
    return 0
end

local function safeStr(v)
    if type(v) == "string" then return v end
    return ""
end

local function trimStr(s)
    s = safeStr(s)
    return (s:gsub("^%s+", ""):gsub("%s+$", ""))
end

local function isPlaceholderName(name)
    local n = trimStr(name)
    if n == "" then return true end
    local low = n:lower()
    if low:match("^stop%s*#%d+$") then return true end
    if low:match("^station%s*#%d+$") then return true end
    return false
end

local function deepFindName(val, depth, visited)
    depth = depth or 0
    visited = visited or {}
    if depth > 4 then return "" end

    local t = type(val)
    if t == "string" then
        return isPlaceholderName(val) and "" or trimStr(val)
    end
    if t ~= "table" then return "" end
    if visited[val] then return "" end
    visited[val] = true

    for _, k in ipairs({"name", "displayName", "label", "stationName", "terminalName", "stopName", "title"}) do
        local s = trimStr(val[k])
        if s ~= "" and not isPlaceholderName(s) then return s end
    end

    for _, v in pairs(val) do
        local n = deepFindName(v, depth + 1, visited)
        if n ~= "" then return n end
    end
    return ""
end

local function safeFloat(v, digits)
    digits = digits or 2
    if type(v) == "number" then
        if v ~= v then return 0.0 end
        if v == math.huge or v == -math.huge then return 0.0 end
        local factor = 10 ^ digits
        return math.floor(v * factor + 0.5) / factor
    end
    return 0.0
end

-- ─────────────────────────────────────────────────────────────────────────────
-- JSON-Serialisierung
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
    if level > 20 then return "null" end  -- prevent infinite recursion

    local t = type(val)

    if val == nil     then return "null"
    elseif t == "boolean" then return tostring(val)
    elseif t == "number"  then
        if val ~= val then return "null" end
        if val == math.huge or val == -math.huge then return "null" end
        return tostring(val)
    elseif t == "string" then
        return '"' .. jsonEscape(val) .. '"'
    elseif t == "table" then
        -- Safe pairs iteration: catch errors from metatabled tables
        local ok_keys, all_keys = pcall(function()
            local ks = {}
            for k in pairs(val) do ks[#ks+1] = k end
            return ks
        end)
        if not ok_keys or not all_keys then return "null" end

        -- Check if it's a pure array
        local isArray = true
        local maxN = 0
        for _, k in ipairs(all_keys) do
            if type(k) ~= "number" or k ~= math.floor(k) or k < 1 then
                isArray = false; break
            end
            if k > maxN then maxN = k end
        end

        if isArray and maxN == #val and maxN > 0 then
            local parts = {}
            for i = 1, #val do
                parts[i] = JSON.encode(val[i], indent, level + 1)
            end
            return "[" .. table.concat(parts, ",") .. "]"
        elseif #all_keys == 0 then
            return "[]"
        else
            local parts = {}
            -- Safe sort: convert all keys to strings first
            local strKeys = {}
            for _, k in ipairs(all_keys) do
                strKeys[#strKeys+1] = {key = k, str = tostring(k)}
            end
            table.sort(strKeys, function(a, b) return a.str < b.str end)
            for _, entry in ipairs(strKeys) do
                local k = entry.key
                local keyStr = '"' .. jsonEscape(entry.str) .. '"'
                -- Safe value access
                local ok_v, v = pcall(function() return val[k] end)
                if ok_v then
                    parts[#parts+1] = keyStr .. ":" .. JSON.encode(v, indent, level + 1)
                else
                    parts[#parts+1] = keyStr .. ":null"
                end
            end
            return "{" .. table.concat(parts, ",") .. "}"
        end
    elseif t == "userdata" or t == "cdata" or t == "function" or t == "thread" then
        -- Non-serializable types → null
        return "null"
    end
    return "null"
end

-- ─────────────────────────────────────────────────────────────────────────────
-- TPF2 API Helpers
-- ─────────────────────────────────────────────────────────────────────────────

local _diagWritten = false

local function gi()
    return game and game.interface
end

local function getEntity(id)
    if gi() and gi().getEntity then
        return safeCall(gi().getEntity, id)
    end
    return nil
end

local function getEntities(filter, opts)
    if gi() and gi().getEntities then
        return safeCall(gi().getEntities, filter, opts)
    end
    return nil
end

-- Resolve a ComponentType by trying all known access patterns
local function resolveComponentType(name)
    if not (api and api.type) then return nil end

    -- Pattern 1: api.type.ComponentType.NAME
    if api.type.ComponentType then
        local ct = api.type.ComponentType
        if ct[name] ~= nil then return ct[name] end
        -- Try metatable (TPF2 often uses metatables for enums)
        local mt = getmetatable(ct)
        if mt and mt.__index then
            local idx = mt.__index
            if type(idx) == "table" and idx[name] ~= nil then return idx[name] end
            if type(idx) == "function" then
                local v = safeCall(idx, ct, name)
                if v ~= nil then return v end
            end
        end
    end

    -- Pattern 2: api.type.NAME (some TPF2 versions put types directly here)
    if api.type[name] ~= nil then
        local v = api.type[name]
        -- Only use it if it looks like a component type (number or userdata)
        if type(v) == "number" or type(v) == "userdata" then return v end
    end

    return nil
end

local function getComponent(entityId, componentType)
    if not (api and api.engine and api.engine.getComponent and componentType) then return nil end
    local gc = api.engine.getComponent
    -- api.engine.getComponent may be a table with __call metamethod
    local ok, result
    if type(gc) == "function" then
        ok, result = pcall(gc, entityId, componentType)
    elseif type(gc) == "table" then
        -- Try __call metamethod
        ok, result = pcall(function() return gc(entityId, componentType) end)
    else
        return nil
    end
    if ok then return result end
    return nil
end

-- ─────────────────────────────────────────────────────────────────────────────
-- Diagnostics
-- ─────────────────────────────────────────────────────────────────────────────

local function writeDiag(path, filename)
    filename = filename or "telemetry_diag.txt"
    local f = io.open(path .. filename, "w")
    if not f then return end
    f:write("=== TPF2 Telemetrie Diagnose [" .. filename .. "] ===\n")
    f:write("game available: " .. tostring(game ~= nil) .. "\n")
    f:write("game.interface available: " .. tostring(gi() ~= nil) .. "\n")

    if gi() then
        for _, fn in ipairs({
            "getEntity", "getEntities", "getEntityList",
            "getVehicle", "getVehicles",
            "getLine", "getLines",
            "getStation", "getStations",
            "getSimulationTime", "getGameTime",
            "getDepots", "getTowns", "getName",
        }) do
            f:write("gi." .. fn .. ": " .. tostring(type(gi()[fn])) .. "\n")
        end
    end

    f:write("api available: " .. tostring(api ~= nil) .. "\n")
    if api then
        f:write("api.engine: " .. tostring(type(api.engine)) .. "\n")
        if api.engine then
            for _, fn in ipairs({
                "getEntityList", "getComponent", "entityExists",
                "forEachEntityWithComponent", "getRevision",
            }) do
                f:write("api.engine." .. fn .. ": " .. tostring(type(api.engine[fn])) .. "\n")
            end
            f:write("api.engine.system: " .. tostring(type(api.engine.system)) .. "\n")
            if type(api.engine.system) == "table" then
                local sysKeys = {}
                for k in pairs(api.engine.system) do sysKeys[#sysKeys+1] = tostring(k) end
                table.sort(sysKeys)
                f:write("system keys: " .. table.concat(sysKeys, ", ") .. "\n")
            end
        end

        f:write("api.type: " .. tostring(type(api.type)) .. "\n")
        if api.type then
            f:write("api.type.ComponentType: " .. tostring(type(api.type.ComponentType)) .. "\n")
            if type(api.type.ComponentType) == "table" then
                local ct = api.type.ComponentType
                -- Direct keys
                local ctKeys = {}
                for k in pairs(ct) do ctKeys[#ctKeys+1] = tostring(k) end
                -- Metatable keys
                local mt = getmetatable(ct)
                if mt and mt.__index and type(mt.__index) == "table" then
                    for k in pairs(mt.__index) do ctKeys[#ctKeys+1] = tostring(k) end
                    f:write("CT has metatable __index (table)\n")
                elseif mt and mt.__index then
                    f:write("CT has metatable __index (" .. type(mt.__index) .. ")\n")
                end
                table.sort(ctKeys)
                f:write("CT keys (" .. #ctKeys .. "): " .. table.concat(ctKeys, ", ") .. "\n")

                -- Test specific CTs
                for _, name in ipairs({
                    "BASE_EDGE", "BASE_EDGE_TRACK", "BASE_EDGE_STREET",
                    "BASE_NODE", "TRANSPORT_NETWORK", "SIGNAL_LIST", "SIGNAL",
                    "LINE", "STATION", "STATION_GROUP", "NAME",
                }) do
                    f:write("  resolve(" .. name .. ") = " .. tostring(resolveComponentType(name)) .. "\n")
                end
            end

            -- api.type direct keys
            local typeKeys = {}
            for k in pairs(api.type) do typeKeys[#typeKeys+1] = tostring(k) end
            table.sort(typeKeys)
            f:write("api.type keys: " .. table.concat(typeKeys, ", ") .. "\n")
        end
    end

    -- Test getEntities
    f:write("\n--- getEntities Tests ---\n")
    if gi() and gi().getEntities then
        for _, etype in ipairs({"BASE_EDGE", "CONSTRUCTION", "STATION"}) do
            local ok2, r = pcall(gi().getEntities, {pos = {0, 0}, radius = 999999}, {type = etype})
            if ok2 and r then
                local count = 0
                local firstId = nil
                if type(r) == "table" then
                    for k, v in pairs(r) do
                        count = count + 1
                        if not firstId then
                            if type(k) == "number" and k > 100 then firstId = k
                            elseif type(v) == "number" then firstId = v
                            end
                        end
                    end
                end
                f:write("getEntities(" .. etype .. "): count=" .. count .. "\n")
                if firstId then
                    f:write("  first id: " .. tostring(firstId) .. "\n")
                    local ent = getEntity(firstId)
                    if ent then
                        for ek, ev in pairs(ent) do
                            local vs = tostring(ev)
                            if #vs > 100 then vs = vs:sub(1, 100) .. "..." end
                            f:write("    ." .. tostring(ek) .. " = " .. vs .. " (" .. type(ev) .. ")\n")
                        end
                    end
                end
            else
                f:write("getEntities(" .. etype .. "): FAILED - " .. tostring(r) .. "\n")
            end
        end
    else
        f:write("game.interface.getEntities not available\n")
    end

    -- Test getComponent
    f:write("\n--- getComponent Tests ---\n")
    if api and api.engine and api.engine.getComponent then
        f:write("api.engine.getComponent: AVAILABLE\n")
        -- Try to get component on a known station
        local stationIds = {}
        if gi() and gi().getStations then
            local r = safeCall(gi().getStations)
            if r and type(r) == "table" then
                for _, v in ipairs(r) do
                    stationIds[#stationIds+1] = toEntityId(v)
                    if #stationIds >= 1 then break end
                end
            end
        end
        if #stationIds > 0 then
            local sid = stationIds[1]
            for _, ctName in ipairs({"NAME", "STATION", "STATION_GROUP", "CONSTRUCTION"}) do
                local ct = resolveComponentType(ctName)
                if ct then
                    local comp = safeCall(api.engine.getComponent, sid, ct)
                    f:write("  getComponent(" .. sid .. ", " .. ctName .. "=" .. tostring(ct) .. "): " .. tostring(comp ~= nil) .. "\n")
                    if comp then
                        pcall(function()
                            for ck, cv in pairs(comp) do
                                local vs = tostring(cv)
                                if #vs > 80 then vs = vs:sub(1, 80) .. "..." end
                                f:write("      ." .. tostring(ck) .. " = " .. vs .. "\n")
                            end
                        end)
                    end
                end
            end
        end
    else
        f:write("api.engine.getComponent: NOT available\n")
    end

    -- Test line entity structure
    f:write("\n--- Line Entity Tests ---\n")
    if gi() and gi().getLines then
        local ok2, lines = pcall(gi().getLines)
        if ok2 and lines and #lines > 0 then
            local lid = toEntityId(lines[1])
            local ent = getEntity(lid)
            if ent then
                f:write("  Line #" .. lid .. " entity:\n")
                for ek, ev in pairs(ent) do
                    local vs = tostring(ev)
                    if type(ev) == "table" then
                        local inner = {}
                        local cnt = 0
                        for ik, iv in pairs(ev) do
                            cnt = cnt + 1
                            if cnt <= 4 then inner[#inner+1] = tostring(ik) .. "=" .. tostring(iv) end
                        end
                        if cnt > 4 then inner[#inner+1] = "...(" .. cnt .. " items)" end
                        vs = "{" .. table.concat(inner, ", ") .. "}"
                    end
                    if #vs > 120 then vs = vs:sub(1, 120) .. "..." end
                    f:write("    ." .. tostring(ek) .. " = " .. vs .. "\n")
                end
                -- Check stops detail
                if ent.stops and type(ent.stops) == "table" and #ent.stops > 0 then
                    local stopId = safeInt(ent.stops[1])
                    f:write("  First stop id=" .. stopId .. "\n")
                    local stopEnt = getEntity(stopId)
                    if stopEnt then
                        f:write("  Stop entity:\n")
                        for ek, ev in pairs(stopEnt) do
                            local vs = tostring(ev)
                            if #vs > 80 then vs = vs:sub(1, 80) .. "..." end
                            f:write("      ." .. tostring(ek) .. " = " .. vs .. " (" .. type(ev) .. ")\n")
                        end
                    end
                end
            end
        end
    end

    f:close()
end

-- ─────────────────────────────────────────────────────────────────────────────
-- Entity enumeration
-- ─────────────────────────────────────────────────────────────────────────────

local function getAllVehicleIds()
    if gi() and gi().getVehicles then
        local r = safeCall(gi().getVehicles)
        if r and type(r) == "table" and #r > 0 then
            local ids = {}
            for _, v in ipairs(r) do
                local id = toEntityId(v)
                if id ~= 0 then ids[#ids+1] = id end
            end
            if #ids > 0 then return ids end
        end
    end
    return {}
end

local function getAllLineIds()
    if gi() and gi().getLines then
        local r = safeCall(gi().getLines)
        if r and type(r) == "table" and #r > 0 then
            local ids = {}
            for _, v in ipairs(r) do
                local id = toEntityId(v)
                if id ~= 0 then ids[#ids+1] = id end
            end
            if #ids > 0 then return ids end
        end
    end
    return {}
end

local function getAllStationIds()
    if gi() and gi().getStations then
        local r = safeCall(gi().getStations)
        if r and type(r) == "table" and #r > 0 then
            local ids = {}
            for _, v in ipairs(r) do
                local id = toEntityId(v)
                if id ~= 0 then ids[#ids+1] = id end
            end
            if #ids > 0 then return ids end
        end
    end
    return {}
end

-- Get all BASE_EDGE entity IDs
local function getAllEdgeIds()
    -- game.interface.getEntities returns a map: { [entityId] = true, ... }
    local result = getEntities({pos = {0, 0}, radius = 999999}, {type = "BASE_EDGE"})
    if result and type(result) == "table" then
        local ids = {}
        for k, v in pairs(result) do
            if type(k) == "number" and k > 0 then
                ids[#ids+1] = k
            elseif type(v) == "number" and v > 0 then
                ids[#ids+1] = v
            end
        end
        if #ids > 0 then return ids end
    end
    return {}
end

-- ─────────────────────────────────────────────────────────────────────────────
-- Position helpers
-- ─────────────────────────────────────────────────────────────────────────────

local function extractPosition(ent)
    if not ent then return nil end
    if ent.position then
        local p = ent.position
        if type(p) == "table" then
            return {
                x = safeFloat(p.x or p[1] or 0),
                y = safeFloat(p.y or p[2] or 0),
                z = safeFloat(p.z or p[3] or 0),
            }
        end
    end
    if ent.transform then
        local xf = ent.transform
        return {
            x = safeFloat(xf[13] or xf[4] or 0),
            y = safeFloat(xf[14] or xf[8] or 0),
            z = safeFloat(xf[15] or xf[12] or 0),
        }
    end
    return nil
end

-- ─────────────────────────────────────────────────────────────────────────────
-- Station cache (with stationGroup support)
-- ─────────────────────────────────────────────────────────────────────────────

local _stationCache      = {}
local _stationGroupMap   = {}  -- groupId -> stationId
local _terminalToStation = {}

local function resolveEntityDisplayName(entityId, ent)
    local id = safeInt(entityId)
    local e = ent or getEntity(id)
    if not e then return "" end

    local direct = trimStr(e.name or e.displayName or e.label or e.stationName or e.terminalName or "")
    if direct ~= "" and not isPlaceholderName(direct) then return direct end

    local deep = deepFindName(e, 0, {})
    if deep ~= "" then return deep end

    for _, k in ipairs({"station", "stationGroup", "stationEntity", "group", "parent"}) do
        local ref = e[k]
        local sid = safeInt(ref)
        if sid ~= 0 and sid ~= id then
            local se = getEntity(sid)
            if se then
                local sn = trimStr(se.name or "")
                if sn ~= "" and not isPlaceholderName(sn) then return sn end
            end
        end
    end

    return ""
end

local function buildStationCache()
    _stationCache = {}
    _stationGroupMap = {}
    _terminalToStation = {}
    local ids = getAllStationIds()

    -- Phase 1: load all station entities
    for _, sid in ipairs(ids) do
        local sidInt = safeInt(sid)
        local ent = getEntity(sid)
        if not ent then goto continue_station end

        local name = resolveEntityDisplayName(sidInt, ent)
        local pos = extractPosition(ent) or {x = 0, y = 0, z = 0}

        _stationCache[sidInt] = {
            id   = sidInt,
            name = name ~= "" and name or ("Station #" .. sidInt),
            pos  = pos,
        }

        -- Build stationGroup -> station mapping
        local sgId = safeInt(ent.stationGroup or ent.station_group or 0)
        if sgId ~= 0 then
            _stationGroupMap[sgId] = sidInt
        end

        -- Map sub-entities
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

        ::continue_station::
    end

    -- Phase 2: load stationGroup entities (line stops reference these)
    for _, sid in ipairs(ids) do
        local ent = getEntity(safeInt(sid))
        if ent and ent.stationGroup then
            local sgId = safeInt(ent.stationGroup)
            if sgId ~= 0 and not _stationCache[sgId] then
                local sgEnt = getEntity(sgId)
                if sgEnt then
                    local sgName = trimStr(sgEnt.name or "")
                    local sgPos = extractPosition(sgEnt)
                    if sgName == "" and _stationCache[safeInt(sid)] then
                        sgName = _stationCache[safeInt(sid)].name
                    end
                    if not sgPos and _stationCache[safeInt(sid)] then
                        sgPos = _stationCache[safeInt(sid)].pos
                    end
                    _stationCache[sgId] = {
                        id      = sgId,
                        name    = sgName ~= "" and sgName or ("Station #" .. sgId),
                        pos     = sgPos or {x = 0, y = 0, z = 0},
                        isGroup = true,
                    }
                end
            end
        end
    end

    -- Phase 3: pre-load any stop IDs from lines that we haven't seen yet
    local lineIds = getAllLineIds()
    for _, lid in ipairs(lineIds) do
        local ent = getEntity(lid)
        if ent and type(ent.stops) == "table" then
            for _, stopRef in ipairs(ent.stops) do
                local stopId = safeInt(stopRef)
                if stopId ~= 0 and not _stationCache[stopId] then
                    local stopEnt = getEntity(stopId)
                    if stopEnt then
                        local sName = resolveEntityDisplayName(stopId, stopEnt)
                        local sPos = extractPosition(stopEnt) or {x = 0, y = 0, z = 0}

                        -- Check if this is a station group
                        if stopEnt.stations and type(stopEnt.stations) == "table" then
                            for _, subSid in ipairs(stopEnt.stations) do
                                local subSidInt = safeInt(subSid)
                                if subSidInt ~= 0 then
                                    _stationGroupMap[stopId] = subSidInt
                                    if _stationCache[subSidInt] then
                                        if sName == "" then sName = _stationCache[subSidInt].name end
                                        if sPos.x == 0 and sPos.y == 0 then sPos = _stationCache[subSidInt].pos end
                                    end
                                end
                            end
                        end

                        _stationCache[stopId] = {
                            id   = stopId,
                            name = sName ~= "" and sName or ("Station #" .. stopId),
                            pos  = sPos,
                            isGroup = (stopEnt.type == "STATION_GROUP") or (stopEnt.stations ~= nil),
                        }
                    end
                end
            end
        end
    end

    return _stationCache
end

-- ─────────────────────────────────────────────────────────────────────────────
-- Track/Edge collection - REAL rail routing geometry
-- ─────────────────────────────────────────────────────────────────────────────

-- Hermite spline interpolation for smooth curves
local function sampleHermite(p0, p1, t0, t1, numSamples)
    local points = {}
    numSamples = numSamples or 8
    for i = 0, numSamples do
        local t = i / numSamples
        local t2 = t * t
        local t3 = t2 * t
        local h00 = 2*t3 - 3*t2 + 1
        local h10 = t3 - 2*t2 + t
        local h01 = -2*t3 + 3*t2
        local h11 = t3 - t2
        points[#points+1] = {
            x = safeFloat(h00 * p0.x + h10 * t0.x + h01 * p1.x + h11 * t1.x),
            y = safeFloat(h00 * p0.y + h10 * t0.y + h01 * p1.y + h11 * t1.y),
        }
    end
    return points
end

local function sampleArc(center, radius, startAngle, totalAngle, numSamples)
    local points = {}
    numSamples = numSamples or 10
    for i = 0, numSamples do
        local t = i / numSamples
        local angle = startAngle + totalAngle * t
        points[#points+1] = {
            x = safeFloat(center.x + radius * math.cos(angle)),
            y = safeFloat(center.y + radius * math.sin(angle)),
        }
    end
    return points
end

-- Extract geometry points from a TransportNetwork edge geometry
local function tnEdgeToPoints(geom)
    if not geom then return nil end
    local params = geom.params
    if not params then return nil end

    -- Straight line: params.pos = {Vec2f, Vec2f}
    if params.pos and not params.tangent and not params.angle then
        local p = params.pos
        if type(p) == "table" and #p >= 2 then
            local p0 = p[1]
            local p1 = p[2]
            if p0 and p1 then
                return {
                    {x = safeFloat(p0.x or p0[1] or 0), y = safeFloat(p0.y or p0[2] or 0)},
                    {x = safeFloat(p1.x or p1[1] or 0), y = safeFloat(p1.y or p1[2] or 0)},
                }
            end
        end
    end

    -- Arc
    if params.angle and params.center and params.radius then
        return sampleArc(
            {x = safeFloat(params.center.x or params.center[1] or 0),
             y = safeFloat(params.center.y or params.center[2] or 0)},
            safeFloat(params.radius),
            safeFloat(params.startAngle or 0),
            safeFloat(params.angle),
            10
        )
    end

    -- Cubic spline: params.pos + params.tangent
    if params.pos and params.tangent then
        local p  = params.pos
        local tg = params.tangent
        if type(p) == "table" and #p >= 2 and type(tg) == "table" and #tg >= 2 then
            return sampleHermite(
                {x = safeFloat(p[1].x or p[1][1] or 0),  y = safeFloat(p[1].y or p[1][2] or 0)},
                {x = safeFloat(p[2].x or p[2][1] or 0),  y = safeFloat(p[2].y or p[2][2] or 0)},
                {x = safeFloat(tg[1].x or tg[1][1] or 0), y = safeFloat(tg[1].y or tg[1][2] or 0)},
                {x = safeFloat(tg[2].x or tg[2][1] or 0), y = safeFloat(tg[2].y or tg[2][2] or 0)},
                10
            )
        end
    end

    return nil
end

local function collectTracks()
    local tracks = {}

    local edgeIds = getAllEdgeIds()
    if #edgeIds == 0 then return tracks end

    -- Use entity data directly (proven to work from diagnostics).
    -- Each edge entity has: .node0, .node1, .node0pos, .node1pos,
    --   .node0tangent, .node1tangent, .track (bool), .hasTram (bool), .hasBus (bool)
    for _, edgeId in ipairs(edgeIds) do
        local ok2, edge = pcall(getEntity, edgeId)
        if not ok2 or not edge then goto continue_edge end

        -- Determine type from entity fields
        local isTrack = edge.track == true
        local isTram  = edge.hasTram == true

        -- Skip non-rail/non-tram edges (roads, waterways, etc.)
        if not isTrack and not isTram then goto continue_edge end

        local edgeType = isTrack and "RAIL" or "TRAM"

        -- Extract node positions from entity (these are tables with x,y,z)
        local n0p = edge.node0pos
        local n1p = edge.node1pos
        if not n0p or not n1p then goto continue_edge end

        local p0 = {x = safeFloat(n0p.x or n0p[1] or 0), y = safeFloat(n0p.y or n0p[2] or 0)}
        local p1 = {x = safeFloat(n1p.x or n1p[1] or 0), y = safeFloat(n1p.y or n1p[2] or 0)}

        local edgePoints = nil

        -- Use tangent data for smooth curves if available
        local t0 = edge.node0tangent
        local t1 = edge.node1tangent
        if t0 and t1 then
            local tg0 = {x = safeFloat(t0.x or t0[1] or 0), y = safeFloat(t0.y or t0[2] or 0)}
            local tg1 = {x = safeFloat(t1.x or t1[1] or 0), y = safeFloat(t1.y or t1[2] or 0)}
            -- Only use Hermite if tangents are non-zero (otherwise straight line)
            local tLen0 = tg0.x * tg0.x + tg0.y * tg0.y
            local tLen1 = tg1.x * tg1.x + tg1.y * tg1.y
            if tLen0 > 0.01 or tLen1 > 0.01 then
                edgePoints = sampleHermite(p0, p1, tg0, tg1, 8)
            end
        end

        -- Fallback: straight line
        if not edgePoints then
            edgePoints = {p0, p1}
        end

        if #edgePoints >= 2 then
            tracks[#tracks+1] = {
                points = edgePoints,
                type   = edgeType,
            }
        end

        ::continue_edge::
    end

    return tracks
end

-- ─────────────────────────────────────────────────────────────────────────────
-- Signal collection
-- ─────────────────────────────────────────────────────────────────────────────

local function collectSignals()
    local signals = {}
    local seen = {}

    local CT_SIGNAL_LIST = resolveComponentType("SIGNAL_LIST")
    local edgeIds = getAllEdgeIds()

    -- Method 1: scan edges for SIGNAL_LIST component
    -- Use entity data for edge positions (proven to work)
    if CT_SIGNAL_LIST and #edgeIds > 0 then
        for _, edgeId in ipairs(edgeIds) do
            local sigList = getComponent(edgeId, CT_SIGNAL_LIST)
            if not sigList then goto continue_sig_edge end

            -- Get signal array from the component
            local sigArray = nil
            if type(sigList) == "table" then
                sigArray = sigList.signals or sigList
                if type(sigArray) ~= "table" then goto continue_sig_edge end
            else
                goto continue_sig_edge
            end

            -- Get edge node positions directly from entity
            local edgeEnt = getEntity(edgeId)
            local node0Pos, node1Pos
            if edgeEnt then
                local n0p = edgeEnt.node0pos
                local n1p = edgeEnt.node1pos
                if n0p then
                    node0Pos = {
                        x = safeFloat(n0p.x or n0p[1] or 0),
                        y = safeFloat(n0p.y or n0p[2] or 0),
                        z = safeFloat(n0p.z or n0p[3] or 0),
                    }
                end
                if n1p then
                    node1Pos = {
                        x = safeFloat(n1p.x or n1p[1] or 0),
                        y = safeFloat(n1p.y or n1p[2] or 0),
                        z = safeFloat(n1p.z or n1p[3] or 0),
                    }
                end
            end

            -- Process each signal in the list
            local idx = 0
            for sigKey, sig in pairs(sigArray) do
                idx = idx + 1
                if type(sig) ~= "table" then goto continue_sig end

                local param = safeFloat(sig.param or sig.position or 0.5, 4)
                local pos = {x = 0, y = 0, z = 0}
                if node0Pos and node1Pos then
                    pos = {
                        x = safeFloat(node0Pos.x + (node1Pos.x - node0Pos.x) * param),
                        y = safeFloat(node0Pos.y + (node1Pos.y - node0Pos.y) * param),
                        z = safeFloat((node0Pos.z or 0) + ((node1Pos.z or 0) - (node0Pos.z or 0)) * param),
                    }
                elseif node0Pos then
                    pos = {x = node0Pos.x, y = node0Pos.y, z = node0Pos.z or 0}
                end

                local state = safeInt(sig.state or sig.signalState or sig.mainState or sig.aspect or 0)
                local sigUid = edgeId * 1000 + idx
                if not seen[sigUid] then
                    seen[sigUid] = true
                    signals[#signals+1] = {
                        id    = sigUid,
                        pos   = pos,
                        state = state > 0 and 1 or 0,
                    }
                end
                ::continue_sig::
            end

            ::continue_sig_edge::
        end
    end

    -- Method 2: signal system subsystem
    if #signals == 0 and api and api.engine and api.engine.system then
        local sigSys = api.engine.system.signalSystem
        if sigSys then
            -- Try getSignal on each edge (both directions)
            local getSignalFn = sigSys.getSignal
            if getSignalFn and #edgeIds > 0 then
                for _, edgeId in ipairs(edgeIds) do
                    for _, reversed in ipairs({false, true}) do
                        local ok2, sigId = pcall(function() return getSignalFn(edgeId, reversed) end)
                        if ok2 and sigId then
                            local sid = toEntityId(sigId)
                            if sid ~= 0 and not seen[sid] then
                                seen[sid] = true
                                -- Get position from edge entity
                                local edgeEnt = getEntity(edgeId)
                                local sigPos = {x = 0, y = 0, z = 0}
                                if edgeEnt and edgeEnt.node0pos then
                                    local n0p = edgeEnt.node0pos
                                    local n1p = edgeEnt.node1pos or n0p
                                    sigPos = {
                                        x = safeFloat((n0p.x or 0) * 0.5 + (n1p.x or 0) * 0.5),
                                        y = safeFloat((n0p.y or 0) * 0.5 + (n1p.y or 0) * 0.5),
                                        z = safeFloat((n0p.z or 0) * 0.5 + (n1p.z or 0) * 0.5),
                                    }
                                end
                                signals[#signals+1] = {
                                    id    = sid,
                                    pos   = sigPos,
                                    state = 0,
                                }
                            end
                        end
                    end
                end
            end
        end
    end

    return signals
end

-- ─────────────────────────────────────────────────────────────────────────────
-- Line collection
-- ─────────────────────────────────────────────────────────────────────────────

local function resolveToStationId(id)
    id = safeInt(id)
    if id == 0 then return 0 end
    if _stationCache[id] then return id end
    if _stationGroupMap[id] then return _stationGroupMap[id] end
    if _terminalToStation[id] then return _terminalToStation[id] end

    local tEnt = getEntity(id)
    if tEnt then
        if tEnt.stations and type(tEnt.stations) == "table" then
            for _, subSid in ipairs(tEnt.stations) do
                local subId = safeInt(subSid)
                if subId ~= 0 and _stationCache[subId] then
                    _stationGroupMap[id] = subId
                    return subId
                end
            end
        end
        for _, field in ipairs({"station", "stationGroup", "stationEntity", "owner", "parent", "group"}) do
            local sId = safeInt(tEnt[field] or 0)
            if sId ~= 0 and _stationCache[sId] then
                _terminalToStation[id] = sId
                return sId
            end
        end
    end
    return id
end

local function collectLines()
    local lines = {}
    local ids = getAllLineIds()

    for _, lid in ipairs(ids) do
        local ent = getEntity(lid)
        local name = ""
        local stops = {}
        local vehicleType = "UNKNOWN"

        if ent then
            name = safeStr(ent.name or "")
            local rawStops = ent.stops or ent.waypoints or {}
            for i, stop in ipairs(rawStops) do
                local stopId = safeInt(stop)
                local resolvedId = resolveToStationId(stopId)

                local displayName = ""
                if _stationCache[resolvedId] then
                    displayName = _stationCache[resolvedId].name
                end
                if displayName == "" and _stationCache[stopId] then
                    displayName = _stationCache[stopId].name
                end
                if displayName == "" then
                    displayName = resolveEntityDisplayName(stopId)
                end

                stops[#stops+1] = {
                    index       = i,
                    station_id  = resolvedId,
                    raw_stop_id = stopId,
                    name        = displayName ~= "" and displayName or ("Stop #" .. stopId),
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
-- Line paths (station-to-station connections for line visualization)
-- ─────────────────────────────────────────────────────────────────────────────

local function collectLinePath(lineStops)
    local points = {}
    if type(lineStops) ~= "table" then return points end

    for _, s in ipairs(lineStops) do
        local pos = nil
        for _, cid in ipairs({s.station_id, s.raw_stop_id}) do
            if cid and cid ~= 0 and _stationCache[cid] then
                pos = _stationCache[cid].pos
                break
            end
        end

        if not pos then
            local checkId = s.raw_stop_id or s.station_id or 0
            if checkId ~= 0 then
                local ent = getEntity(checkId)
                if ent then
                    local ePos = extractPosition(ent)
                    if ePos then pos = {x = safeFloat(ePos.x), y = safeFloat(ePos.y)} end
                end
            end
        end

        if pos then
            points[#points+1] = {x = safeFloat(pos.x), y = safeFloat(pos.y)}
        end
    end
    return points
end

local function collectPaths(lines)
    local paths = {}
    for _, line in ipairs(lines) do
        local pts = collectLinePath(line.stops)
        if #pts > 0 then
            paths[#paths+1] = {line_id = line.id, points = pts}
        end
    end
    return paths
end

-- ─────────────────────────────────────────────────────────────────────────────
-- Vehicle collection
-- ─────────────────────────────────────────────────────────────────────────────

local function msToKmh(ms)
    if type(ms) == "number" then return safeFloat(ms * 3.6, 1) end
    return 0.0
end

local function collectVehicles()
    local vehicles = {}
    local ids = getAllVehicleIds()

    for _, vid in ipairs(ids) do
        local ent = getEntity(vid)
        if not ent then goto continue end

        local vName = safeStr(ent.name or "")
        if vName == "" then vName = "Vehicle #" .. safeInt(vid) end

        local pos = extractPosition(ent) or {x = 0, y = 0, z = 0}
        local speed_ms  = safeFloat(ent.speed or ent.velocity or 0, 3)
        local speed_kmh = msToKmh(speed_ms)

        local lineId = safeInt(
            ent.line or ent.lineIdx or ent.lineId or
            ent.lineEntity or ent.lineEntityId or 0
        )

        local passengers, capacity, cargo, cargo_cap = 0, 0, 0, 0
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

        local state = safeStr(ent.state or "UNKNOWN")
        if state == "" then state = "UNKNOWN" end
        local vType = safeStr(ent.carrier or "UNKNOWN")
        local rawStopIndex = ent.stopIndex ~= nil and safeInt(ent.stopIndex) or -1

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

local function enrichVehiclesWithLineNames(vehicles, lines)
    local lineMap = {}
    for _, line in ipairs(lines) do lineMap[line.id] = line end
    for _, v in ipairs(vehicles) do
        if v.line_id ~= 0 and lineMap[v.line_id] then
            local line = lineMap[v.line_id]
            v.line_name = line.name

            if v.raw_stop_index and v.raw_stop_index >= 0 and line.stop_count > 0 then
                local nextIdx = v.raw_stop_index + 1
                local lastIdx = nextIdx - 1
                if lastIdx < 1 then lastIdx = line.stop_count end

                if line.stops[nextIdx] then
                    local ns = line.stops[nextIdx]
                    v.next_stop_id = ns.station_id ~= 0 and ns.station_id or ns.raw_stop_id
                    v.next_stop_name = ns.name
                end
                if line.stops[lastIdx] then
                    local ls = line.stops[lastIdx]
                    v.last_stop_id = ls.station_id ~= 0 and ls.station_id or ls.raw_stop_id
                    v.last_stop_name = ls.name
                end
            end
        end
    end
end

-- ─────────────────────────────────────────────────────────────────────────────
-- Game time
-- ─────────────────────────────────────────────────────────────────────────────

local function getGameTime()
    if gi() and gi().getGameTime then return safeCall(gi().getGameTime) end
    return nil
end

-- ─────────────────────────────────────────────────────────────────────────────
-- Statistics
-- ─────────────────────────────────────────────────────────────────────────────

local function buildStats(vehicles, lines, stations)
    local total_passengers = 0
    local by_type = {}
    for _, v in ipairs(vehicles) do
        total_passengers = total_passengers + v.passengers
        by_type[v.type] = (by_type[v.type] or 0) + 1
    end
    return {
        total_vehicles   = #vehicles,
        total_passengers = total_passengers,
        total_lines      = #lines,
        total_stations   = #stations,
        vehicles_by_type = by_type,
    }
end

-- ─────────────────────────────────────────────────────────────────────────────
-- JSON writing
-- ─────────────────────────────────────────────────────────────────────────────

local function writeJSON(data)
    local ok_enc, jsonStr = pcall(JSON.encode, data)
    if not ok_enc or not jsonStr then
        print("[TPF2-Telemetry] JSON encode error: " .. tostring(jsonStr))
        return false, "JSON encode: " .. tostring(jsonStr)
    end
    local f, err = io.open(_outputPath, "w")
    if not f then
        print("[TPF2-Telemetry] Datei-Fehler: " .. tostring(err))
        return false, "io.open: " .. tostring(err)
    end
    local ok_w, w_err = pcall(f.write, f, jsonStr)
    f:close()
    if not ok_w then
        print("[TPF2-Telemetry] Write error: " .. tostring(w_err))
        return false, "write: " .. tostring(w_err)
    end
    return true
end

-- ─────────────────────────────────────────────────────────────────────────────
-- Public API
-- ─────────────────────────────────────────────────────────────────────────────

function collector.setup(modPath, interval)
    _outputPath    = modPath .. "telemetry.json"
    _writeInterval = interval or 3
    _callCounter   = 0
    _lastWriteCall = 0
    _lastEventCall = 0
    print("[TPF2-Telemetry] Setup: " .. _outputPath .. " (Intervall: " .. _writeInterval .. "s)")
end

function collector.write()
    if not _outputPath then
        print("[TPF2-Telemetry] WARNUNG: setup() fehlt!")
        return
    end

    local diagPath = _outputPath:gsub("telemetry%.json$", "")

    -- Master error handler: logs crash details to file
    local function writeCrashLog(stage, err)
        local ok_log = pcall(function()
            local f = io.open(diagPath .. "telemetry_crash.txt", "w")
            if f then
                f:write("=== TPF2 Telemetry Crash Log ===\n")
                f:write("Stage: " .. tostring(stage) .. "\n")
                f:write("Error: " .. tostring(err) .. "\n")
                f:write("Time: write_count=" .. tostring(_callCounter) .. "\n")
                f:close()
            end
        end)
        print("[TPF2-Telemetry] CRASH at " .. tostring(stage) .. ": " .. tostring(err))
    end

    -- Wrap entire write body
    local ok_master, master_err = pcall(function()

        if not _diagWritten then
            writeDiag(diagPath)
            _diagWritten = true
        end

        -- Station cache
        local ok_st, st_err = pcall(buildStationCache)
        if not ok_st then
            writeCrashLog("buildStationCache", st_err)
            _stationCache = {}
        end

        local stations_list = {}
        for _, sdata in pairs(_stationCache) do
            stations_list[#stations_list+1] = sdata
        end

        -- Lines
        local lines = {}
        local ok_l, l_result = pcall(collectLines)
        if ok_l and type(l_result) == "table" then
            lines = l_result
        else
            writeCrashLog("collectLines", l_result)
        end

        -- Vehicles
        local vehicles = {}
        local ok_v, v_result = pcall(collectVehicles)
        if ok_v and type(v_result) == "table" then
            vehicles = v_result
        else
            writeCrashLog("collectVehicles", v_result)
        end

        -- Enrich vehicles (was NOT pcall-wrapped before!)
        local ok_ev, ev_err = pcall(enrichVehiclesWithLineNames, vehicles, lines)
        if not ok_ev then
            writeCrashLog("enrichVehiclesWithLineNames", ev_err)
        end

        -- Line paths
        local paths = {}
        local ok_p, p_result = pcall(collectPaths, lines)
        if ok_p and type(p_result) == "table" then
            paths = p_result
        else
            writeCrashLog("collectPaths", p_result)
        end

        -- Track edges (cached)
        _trackCacheAge = _trackCacheAge + 1
        if not _trackCache or _trackCacheAge >= _TRACK_CACHE_INTERVAL then
            local ok_t, t_result = pcall(collectTracks)
            if ok_t and type(t_result) == "table" then
                _trackCache = t_result
                _trackCacheAge = 0
                print("[TPF2-Telemetry] Tracks: " .. #_trackCache .. " edges")
            else
                writeCrashLog("collectTracks", t_result)
                if not _trackCache then _trackCache = {} end
            end
        end

        -- Signals (cached)
        _signalCacheAge = _signalCacheAge + 1
        if not _signalCache or _signalCacheAge >= _SIGNAL_CACHE_INTERVAL then
            local ok_s, s_result = pcall(collectSignals)
            if ok_s and type(s_result) == "table" then
                _signalCache = s_result
                _signalCacheAge = 0
                print("[TPF2-Telemetry] Signals: " .. #_signalCache)
            else
                writeCrashLog("collectSignals", s_result)
                if not _signalCache then _signalCache = {} end
            end
        end

        local gameTime = safeCall(getGameTime)

        -- Build stats (was NOT pcall-wrapped before!)
        local stats = {total_vehicles = 0, total_passengers = 0, total_lines = 0, total_stations = 0, vehicles_by_type = {}}
        local ok_bs, bs_result = pcall(buildStats, vehicles, lines, stations_list)
        if ok_bs and type(bs_result) == "table" then
            stats = bs_result
        else
            writeCrashLog("buildStats", bs_result)
        end

        local payload = {
            schema_version = 4,
            write_count    = _callCounter,
            game_time      = gameTime,
            stats          = stats,
            vehicles       = vehicles,
            lines          = lines,
            stations       = stations_list,
            paths          = paths,
            tracks         = _trackCache or {},
            signals        = _signalCache or {},
        }

        local writeOk, writeErr = writeJSON(payload)
        if writeOk then
            print("[TPF2-Telemetry] OK: " .. #vehicles .. "V " .. #lines .. "L "
                .. #stations_list .. "S " .. #(_trackCache or {}) .. "T "
                .. #(_signalCache or {}) .. "Sig")
        else
            writeCrashLog("writeJSON", writeErr)
        end

    end) -- end pcall

    if not ok_master then
        writeCrashLog("MASTER", master_err)
        -- Last resort: try to write a minimal telemetry.json so the server stays alive
        pcall(function()
            local f = io.open(_outputPath, "w")
            if f then
                f:write('{"schema_version":4,"write_count":' .. tostring(_callCounter)
                    .. ',"vehicles":[],"lines":[],"stations":[],"paths":[],"tracks":[],"signals":[]'
                    .. ',"stats":{"total_vehicles":0,"total_passengers":0,"total_lines":0,"total_stations":0,"vehicles_by_type":{}},"game_time":null}')
                f:close()
            end
        end)
    end
end

function collector.onGameReady()
    if not _outputPath then return end
    print("[TPF2-Telemetry] onGameReady")
    local diagPath = _outputPath:gsub("telemetry%.json$", "")
    writeDiag(diagPath, "telemetry_diag_runtime.txt")
    _diagWritten = false
    _trackCache = nil
    _signalCache = nil
    _trackCacheAge = 999
    _signalCacheAge = 999
    collector.write()
end

function collector.onTick(dt)
    _callCounter = _callCounter + (dt or 1)
    if (_callCounter - _lastWriteCall) >= _writeInterval then
        _lastWriteCall = _callCounter
        collector.write()
    end
end

function collector.onEvent(eventName, eventData)
    _callCounter = _callCounter + 1
    if (_callCounter - _lastEventCall) >= 1 then
        _lastEventCall = _callCounter
        collector.write()
    end
end

return collector
