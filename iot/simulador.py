"""Simulador de telemetría IoT de un camión frigorífico de Cofrial SpA.

Cada contenedor Docker representa UN camión (variable CAMION_ID) y envía cada INTERVALO segundos
una lectura estructurada a la tabla `telemetria` de Amazon RDS:
    camion_id (str) · temp_camara (float) · lat / lon (float) · combustible_pct (int) · alerta_ruptura_frio (bool)

- El rango de temperatura permitido se lee desde la tabla `camion` (temp_min / temp_max).
- El camión recorre una ruta real de La Araucanía entre ciudades (interpolación de coordenadas).
- Con probabilidad FALLA_PROB se simula una falla del equipo de frío o una puerta abierta:
  la temperatura sube durante varios ciclos, se genera la alerta y luego se recupera.
"""
import os
import random
import signal
import sys
import time
from datetime import datetime

import pymysql

CAMION = os.environ.get("CAMION_ID", "CAM-01")
INTERVALO = float(os.environ.get("INTERVALO", "5"))
FALLA_PROB = float(os.environ.get("FALLA_PROB", "0.02"))
DB = dict(host=os.environ.get("DB_HOST", "localhost"), port=int(os.environ.get("DB_PORT", "3306")),
          user=os.environ.get("DB_USER", "admin"), password=os.environ.get("DB_PASS", ""),
          database=os.environ.get("DB_NAME", "cofrial_db"), autocommit=True, connect_timeout=10)

CIUDADES = {
    "Temuco": (-38.7359, -72.5904), "Villarrica": (-39.2833, -72.2275), "Pucón": (-39.2722, -71.9778),
    "Lautaro": (-38.5297, -72.4344), "Angol": (-37.7958, -72.7164), "Valdivia": (-39.8142, -73.2459),
    "Padre Las Casas": (-38.7667, -72.6000), "Los Ángeles": (-37.4697, -72.3537),
}
RUTAS = [
    ["Temuco", "Padre Las Casas", "Villarrica", "Pucón"],
    ["Temuco", "Lautaro", "Angol", "Los Ángeles"],
    ["Temuco", "Villarrica", "Valdivia"],
    ["Temuco", "Lautaro"],
    ["Temuco", "Padre Las Casas", "Villarrica"],
]

detener = False
def _salir(*_):
    global detener
    detener = True
signal.signal(signal.SIGTERM, _salir)
signal.signal(signal.SIGINT, _salir)


def log(msg):
    print(f"[{datetime.now():%H:%M:%S}] {CAMION} | {msg}", flush=True)


def conectar():
    while not detener:
        try:
            conn = pymysql.connect(**DB)
            with conn.cursor() as c:  # misma zona horaria que el backend (hora de Chile)
                c.execute("SET time_zone = %s", (os.environ.get("DB_TIMEZONE", "-03:00"),))
            log(f"Conectado a {DB['host']}/{DB['database']}")
            return conn
        except pymysql.MySQLError as e:
            log(f"No se pudo conectar ({e}); reintento en 5 s")
            time.sleep(5)
    sys.exit(0)


def main():
    conn = conectar()
    with conn.cursor() as c:
        c.execute("SELECT temp_min, temp_max FROM camion WHERE camion_id=%s", (CAMION,))
        fila = c.fetchone()
    if not fila:
        log("El camión no existe en la tabla `camion`. Agrégalo o revisa CAMION_ID.")
        sys.exit(1)
    tmin, tmax = float(fila[0]), float(fila[1])
    centro = (tmin + tmax) / 2

    num = int("".join(ch for ch in CAMION if ch.isdigit()) or 1)
    ruta = RUTAS[(num - 1) % len(RUTAS)]
    ruta = ruta + ruta[-2:0:-1]                      # ida y vuelta
    tramo, avance = 0, random.random()
    paso = random.uniform(0.04, 0.08)               # fracción de tramo recorrida por ciclo
    temp, combustible, falla = centro, random.randint(60, 100), 0
    log(f"Ruta {' → '.join(ruta)} · rango permitido {tmin} a {tmax} °C · cada {INTERVALO} s")

    while not detener:
        # --- posición GPS (interpolación entre ciudades + ruido) ---
        a, b = CIUDADES[ruta[tramo]], CIUDADES[ruta[(tramo + 1) % len(ruta)]]
        lat = a[0] + (b[0] - a[0]) * avance + random.uniform(-0.002, 0.002)
        lon = a[1] + (b[1] - a[1]) * avance + random.uniform(-0.002, 0.002)
        avance += paso
        if avance >= 1:
            avance, tramo = 0, (tramo + 1) % len(ruta)

        # --- temperatura de la cámara ---
        if falla == 0 and random.random() < FALLA_PROB:
            falla = random.randint(4, 10)           # duración de la falla en ciclos
            log("⚠ Simulando falla de equipo de frío / puerta abierta")
        if falla > 0:
            temp += random.uniform(0.8, 1.8)
            falla -= 1
        else:
            temp += (centro - temp) * 0.25 + random.uniform(-0.4, 0.4)

        # --- combustible ---
        combustible -= random.choice([0, 0, 0, 1])
        if combustible <= 5:
            combustible = 100
            log("Carga de combustible")

        alerta = not (tmin <= temp <= tmax)
        try:
            conn.ping(reconnect=True)
            with conn.cursor() as c:
                c.execute(
                    "INSERT INTO telemetria (camion_id, fecha_hora, temp_camara, lat, lon, combustible_pct, alerta_ruptura_frio) "
                    "VALUES (%s, NOW(), %s, %s, %s, %s, %s)",
                    (CAMION, round(temp, 2), round(lat, 6), round(lon, 6), int(combustible), alerta))
            log(f"temp={temp:6.2f} °C lat={lat:.4f} lon={lon:.4f} comb={combustible:3d}% alerta={'SÍ' if alerta else 'no'}")
        except pymysql.MySQLError as e:
            log(f"Error al insertar ({e}); se reintenta la conexión")
            conn = conectar()
        time.sleep(INTERVALO)
    log("Simulador detenido")


if __name__ == "__main__":
    main()
