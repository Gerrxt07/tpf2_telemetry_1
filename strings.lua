--- Lokalisierungsdatei fuer das TPF2-Telemetrie-Mod
function data()
    return {
        de = {
            tpf2_telemetry_name         = "Echtzeit-Telemetrie",
            tpf2_telemetry_desc         = "Schreibt alle paar Sekunden Fahrzeugdaten (Position, Geschwindigkeit, Passagiere, Linie) in eine telemetry.json-Datei im Mod-Ordner. Wird vom Telemetrie-Webserver gelesen.",
            tpf2_telemetry_interval     = "Schreibintervall (Sekunden)",
            tpf2_telemetry_interval_desc= "Wie oft die Telemetriedaten aktualisiert werden (in Sekunden). Kleinere Werte = mehr Performance-Last.",
            tpf2_telemetry_cargo        = "Frachtfahrzeuge einbeziehen",
            tpf2_telemetry_cargo_desc   = "Frachtfahrzeuge ebenfalls in die Telemetrie-Daten aufnehmen.",
            tpf2_telemetry_buses        = "Busse/Strassenbahnen einbeziehen",
            tpf2_telemetry_buses_desc   = "Bus- und Strassenbahnlinien ebenfalls erfassen.",
        },
        en = {
            tpf2_telemetry_name         = "Real-Time Telemetry",
            tpf2_telemetry_desc         = "Writes vehicle data (position, speed, passengers, line) every few seconds to a telemetry.json file in the mod folder. Used by the telemetry web server.",
            tpf2_telemetry_interval     = "Write interval (seconds)",
            tpf2_telemetry_interval_desc= "How often telemetry data is updated (in seconds). Lower values = more performance load.",
            tpf2_telemetry_cargo        = "Include cargo vehicles",
            tpf2_telemetry_cargo_desc   = "Include freight vehicles in telemetry data.",
            tpf2_telemetry_buses        = "Include buses/trams",
            tpf2_telemetry_buses_desc   = "Also capture bus and tram lines.",
        },
    }
end
