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
        load = function()
            ensureCollector()
        end,

        -- update() läuft im eingeschränkten Simulations-Thread. 
        -- Hier lesen wir keine Daten mehr aus, um die API-Blockade zu umgehen.
        update = function()
            ensureCollector()
        end,

        -- guiUpdate() läuft im GUI-Thread. Hier ist api.engine vollständig verfügbar!
        guiUpdate = function()
            if ensureCollector() and collector and collector.onTick then
                -- guiUpdate feuert jeden Frame (z.B. 60x pro Sekunde). 
                -- Wir übergeben ca. 1/60 als Zeit-Delta (0.016 Sekunden).
                pcall(collector.onTick, 0.016)
            end
        end,

        guiInit = function()
            ensureCollector()
        end,
    }
end
