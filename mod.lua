--- TPF2 Echtzeit-Telemetrie Mod
-- Schreibt alle paar Sekunden Fahrzeugdaten in telemetry.json
-- @author tpf2_telemetry
-- @version 1.0.0

function data()
    return {
        info = {
            minorVersion = 0,
            severityAdd    = "NONE",
            severityRemove = "NONE",
            name        = _("tpf2_telemetry_name"),
            description = _("tpf2_telemetry_desc"),
            authors = {
                { name = "tpf2_telemetry", role = "CREATOR", text = "" }
            },
            tags     = { "Script Mod" },
            modid    = "tpf2_telemetry_1",
            dependencies = {},
            params = {
                write_interval = {
                    key         = "write_interval",
                    name        = _("tpf2_telemetry_interval"),
                    description = _("tpf2_telemetry_interval_desc"),
                    values      = { "1", "2", "3", "5", "10", "15", "30" },
                    uiType      = "COMBOBOX",
                    defaultIndex= 1,
                },
                include_cargo = {
                    key         = "include_cargo",
                    name        = _("tpf2_telemetry_cargo"),
                    description = _("tpf2_telemetry_cargo_desc"),
                    values      = { "0", "1" },
                    uiType      = "CHECKBOX",
                    defaultIndex= 1,
                },
                include_buses = {
                    key         = "include_buses",
                    name        = _("tpf2_telemetry_buses"),
                    description = _("tpf2_telemetry_buses_desc"),
                    values      = { "0", "1" },
                    uiType      = "CHECKBOX",
                    defaultIndex= 0,
                },
            },
        },

        runFn = function(settings)
            -- Nur Hinweis: in runFn sind addGameScript/addGuiScript oft noch nicht verfuegbar.
            print("[TPF2-Telemetry] runFn aufgerufen")
        end,
    }
end