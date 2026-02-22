--- TPF2-Telemetrie Runtime Script
-- Wird als game_script geladen und triggert den Collector regelmaessig.

local function getModPath()
    local src = debug.getinfo(1, "S").source
    
    -- Nur das '@' entfernen, falls es wirklich am Anfang steht:
    if src:sub(1, 1) == "@" then
        src = src:sub(2)
    end
    
    src = src:gsub("\\", "/")
    
    -- Hier der aktualisierte Ordnerpfad aus unserem letzten Schritt:
    local path = src:match("(.*)/res/config/game_script/")
    if path then return path .. "/" else return "" end
end

local MOD_PATH = getModPath()
local collector = nil
local interval = 2

-- Singleton-Schutz, falls derselbe Collector mehrfach geladen wird
if rawget(_G, "TPF2_TELEMETRY_RUNTIME_LOADED") then
    print("[TPF2-Telemetry] Runtime-Script bereits geladen, ueberspringe Zweitinitialisierung")
end
_G.TPF2_TELEMETRY_RUNTIME_LOADED = true

local function ensureCollector()
    if collector then return true end

    local scriptsDir = MOD_PATH .. "res/scripts/?.lua"
    if not package.path:find(scriptsDir, 1, true) then
        package.path = scriptsDir .. ";" .. package.path
    end

    local ok, coll = pcall(require, "telemetry/collector")
    if ok and coll then
        collector = coll
        collector.setup(MOD_PATH, interval)
        pcall(collector.onGameReady)
        print("[TPF2-Telemetry] Runtime-Script aktiv")
        return true
    end

    print("[TPF2-Telemetry] FEHLER: Collector konnte nicht geladen werden")
    return false
end

function data()
    return {
        -- Sicherstellen, dass der Collector beim Laden initialisiert wird
        load = function()
            ensureCollector()
        end,

        -- Regelmaessiger Tick im Engine-State
        update = function()
            if ensureCollector() and collector and collector.onTick then
                pcall(collector.onTick, 0.25)
            end
        end,

        -- Regelmaessiger Tick im GUI-State
        guiUpdate = function()
            if ensureCollector() and collector and collector.onTick then
                pcall(collector.onTick, 0.25)
            end
        end,

        guiInit = function()
            ensureCollector()
        end,
    }
end
