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
        fr = {
            tpf2_telemetry_name         = "Télémétrie en temps réel",
            tpf2_telemetry_desc         = "Écrit les données des véhicules (position, vitesse, passagers, ligne) toutes les quelques secondes dans un fichier telemetry.json. Utilisé par le serveur web de télémétrie.",
            tpf2_telemetry_interval     = "Intervalle d'écriture (secondes)",
            tpf2_telemetry_interval_desc= "Fréquence de mise à jour des données de télémétrie (en secondes). Valeurs plus basses = charge accrue.",
            tpf2_telemetry_cargo        = "Inclure les véhicules de fret",
            tpf2_telemetry_cargo_desc   = "Inclure également les véhicules de fret dans les données de télémétrie.",
            tpf2_telemetry_buses        = "Inclure bus/tramways",
            tpf2_telemetry_buses_desc   = "Capturer également les lignes de bus et de tramway.",
        },
        es = {
            tpf2_telemetry_name         = "Telemetría en tiempo real",
            tpf2_telemetry_desc         = "Escribe datos de vehículos (posición, velocidad, pasajeros, línea) cada pocos segundos en un archivo telemetry.json. Usado por el servidor web de telemetría.",
            tpf2_telemetry_interval     = "Intervalo de escritura (segundos)",
            tpf2_telemetry_interval_desc= "Con qué frecuencia se actualizan los datos de telemetría (en segundos). Valores más bajos = mayor carga de rendimiento.",
            tpf2_telemetry_cargo        = "Incluir vehículos de carga",
            tpf2_telemetry_cargo_desc   = "Incluir también los vehículos de carga en los datos de telemetría.",
            tpf2_telemetry_buses        = "Incluir autobuses/tranvías",
            tpf2_telemetry_buses_desc   = "Capturar también las líneas de autobús y tranvía.",
        },
    }
end
