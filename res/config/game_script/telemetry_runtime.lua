--- TPF2-Telemetrie Script
-- Liegt im auto-load Ordner game_script, nutzt aber guiUpdate fuer volle UI-Rechte

local function getModPath()
    local src = debug.getinfo(1, "S").source
    if src:sub(1, 1) == "@" then
        src = src:sub(2)
    end
    src = src:gsub("\\", "/")
    
    -- Pfad-Erkennung zielt wieder auf game_script ab
    local path = src:match("(.*)/res/config/game_script/")
    if path then return path .. "/" else return "" end
end

local MOD_PATH = getModPath()
local collector = nil
local interval = 2

local function ensureCollector()
    if collector then return true end

    local scriptsDir = MOD_PATH .. "res/scripts/?.lua"
    if not package.path:find(scriptsDir, 1, true) then
        package.path = scriptsDir .. ";" .. package.path
    end

    -- Clear cached module to always load latest version from disk
    package.loaded["telemetry/collector"] = nil
    package.loaded["telemetry.collector"] = nil

    local ok, coll = pcall(require, "telemetry/collector")
    if ok and coll then
        collector = coll
        collector.setup(MOD_PATH, interval)
        pcall(collector.onGameReady)
        print("[TPF2-Telemetry] Collector erfolgreich im UI-Thread geladen!")
        return true
    end

    print("[TPF2-Telemetry] FEHLER: Collector konnte nicht geladen werden: " .. tostring(coll))
    return false
end

function data()
    return {
        -- update() laeuft im blockierten Engine-Thread, daher lassen wir es leer
        update = function()
        end,

        -- guiInit und guiUpdate laufen im UI-Thread mit VOLLEN Rechten!
        guiInit = function()
            ensureCollector()
        end,

        guiUpdate = function()
            if ensureCollector() and collector and collector.onTick then
                -- Zeit-Delta von ca. 1/60 Sekunde übergeben
                pcall(collector.onTick, 0.016)
            end
        end,
    }
end