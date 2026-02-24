--- TPF2-Telemetrie GUI Script
-- Wird als gui_script geladen und triggert den Collector regelmaessig mit vollen API-Rechten.

local function getModPath()
    local src = debug.getinfo(1, "S").source
    if src:sub(1, 1) == "@" then
        src = src:sub(2)
    end
    src = src:gsub("\\", "/")
    
    -- WICHTIG: Pfad-Erkennung wurde auf gui_script angepasst!
    local path = src:match("(.*)/res/config/gui_script/")
    if path then return path .. "/" else return "" end
end

local MOD_PATH = getModPath()
local collector = nil
local interval = 2

-- Verhindert doppeltes Laden
if rawget(_G, "TPF2_TELEMETRY_GUI_LOADED") then
    print("[TPF2-Telemetry] GUI-Script bereits geladen, ueberspringe Zweitinitialisierung")
end
_G.TPF2_TELEMETRY_GUI_LOADED = true

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
        print("[TPF2-Telemetry] GUI-Script aktiv - Voller API Zugriff gewaehrt!")
        return true
    end

    print("[TPF2-Telemetry] FEHLER: Collector konnte nicht geladen werden")
    return false
end

function data()
    return {
        -- init() wird beim Starten der Benutzeroberfläche aufgerufen
        init = function()
            ensureCollector()
        end,

        -- update() im gui_script läuft in JEDEM Grafik-Frame mit vollem Engine-Zugang
        update = function()
            if ensureCollector() and collector and collector.onTick then
                -- Zeit-Delta von ca. 1/60 Sekunde übergeben
                pcall(collector.onTick, 0.016)
            end
        end,
    }
end