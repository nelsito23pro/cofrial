"""Genera 02_seed.sql con datos de demostración (determinista).
Uso:  python3 gen_seed.py > 02_seed.sql
Las fechas se expresan relativas a NOW() para que el dashboard siempre muestre datos recientes."""
import random

random.seed(2026)
PWD_INTERNO = "$2b$10$SJCh.GsxsZ2jRJQ/XjOykepiuezg2Wz6CPtceIz5GETvotDpUVQD6"   # Cofrial2026!
PWD_CLIENTE = "$2b$10$2DSVilVVmGS9TjXXKc0tn./hTI.BaLMvtDkB706MoLxmYE7jnQLwC"   # Cliente2026!
out = []
w = out.append
q = lambda s: "NULL" if s is None else "'" + str(s).replace("'", "''") + "'"

w("SET NAMES utf8mb4;\nSET time_zone = '-03:00';  -- hora de Chile, igual que el backend\nUSE cofrial_db;\nSET FOREIGN_KEY_CHECKS = 0;")
for t in ["telemetria", "despacho_pedido", "despacho", "conductor", "camion", "requerimiento", "categoria_requerimiento",
          "interaccion", "tipo_interaccion", "oportunidad", "etapa_pipeline", "detalle_pedido", "pedido", "estado_pedido", "canal",
          "inventario", "bodega", "precio_producto", "producto", "categoria", "direccion", "cliente", "lista_precio",
          "estado_cliente", "tipo_cliente", "comuna", "region", "usuario", "rol"]:
    w(f"TRUNCATE TABLE {t};")
w("SET FOREIGN_KEY_CHECKS = 1;\n")

# ---------- catálogos ----------
w("INSERT INTO rol (id_rol, nombre) VALUES (1,'Administrador'),(2,'Vendedor'),(3,'Despachador'),(4,'Gerencia');")
w("INSERT INTO usuario (id_usuario,id_rol,nombre,email,password_hash) VALUES "
  f"(1,1,'Administrador Cofrial','admin@cofrial.cl','{PWD_INTERNO}'),"
  f"(2,2,'Javiera Muñoz','vendedor@cofrial.cl','{PWD_INTERNO}'),"
  f"(3,2,'Rodrigo Pérez','vendedor2@cofrial.cl','{PWD_INTERNO}'),"
  f"(4,3,'Equipo Despacho','despacho@cofrial.cl','{PWD_INTERNO}'),"
  f"(5,4,'Gerencia General','gerencia@cofrial.cl','{PWD_INTERNO}');")
w("INSERT INTO region (id_region,nombre) VALUES (1,'La Araucanía'),(2,'Los Ríos'),(3,'Biobío');")
comunas = [(1, 1, "Temuco"), (2, 1, "Padre Las Casas"), (3, 1, "Villarrica"), (4, 1, "Pucón"), (5, 1, "Angol"),
           (6, 1, "Lautaro"), (7, 2, "Valdivia"), (8, 3, "Los Ángeles")]
w("INSERT INTO comuna (id_comuna,id_region,nombre) VALUES " + ",".join(f"({a},{b},{q(c)})" for a, b, c in comunas) + ";")
w("INSERT INTO tipo_cliente (id_tipo,nombre) VALUES (1,'B2B'),(2,'B2C');")
w("INSERT INTO estado_cliente (id_estado_cliente,nombre) VALUES (1,'Prospecto'),(2,'Activo'),(3,'Inactivo');")
w("INSERT INTO lista_precio (id_lista,nombre) VALUES (1,'General B2C'),(2,'Institucional Salud'),(3,'Supermercados'),(4,'Ferias');")
w("INSERT INTO canal (id_canal,nombre) VALUES (1,'Web'),(2,'Vendedor CRM'),(3,'Teléfono');")
w("INSERT INTO estado_pedido (id_estado_pedido,nombre,orden) VALUES (1,'Pendiente',1),(2,'Confirmado',2),(3,'En preparación',3),(4,'En ruta',4),(5,'Entregado',5),(6,'Cancelado',6);")
w("INSERT INTO etapa_pipeline (id_etapa,nombre,orden,probabilidad_pct) VALUES (1,'Prospecto',1,10),(2,'Contactado',2,25),(3,'Cotización enviada',3,50),(4,'Negociación',4,75),(5,'Ganada',5,100),(6,'Perdida',6,0);")
w("INSERT INTO tipo_interaccion (id_tipo_interaccion,nombre) VALUES (1,'Llamada'),(2,'Correo'),(3,'Reunión'),(4,'Chat IA');")
w("INSERT INTO categoria_requerimiento (id_categoria_req,nombre) VALUES (1,'Pedido'),(2,'Reclamo'),(3,'Consulta'),(4,'Urgencia cadena de frío');")

# ---------- productos ----------
cats = ["Vacuno", "Aves", "Cerdo", "Pescados y mariscos", "Lácteos", "Congelados preparados", "Insumos hospitalarios"]
w("INSERT INTO categoria (id_categoria,nombre) VALUES " + ",".join(f"({i+1},{q(c)})" for i, c in enumerate(cats)) + ";")
CONG, REF = (-25, -18), (0, 4)
prods = [  # cat, sku, nombre, unidad, rango, precio neto B2C
    (1, "VAC-001", "Lomo vetado congelado", "kg", CONG, 12990), (1, "VAC-002", "Posta negra congelada", "kg", CONG, 9490),
    (1, "VAC-003", "Carne molida 4% grasa", "kg", REF, 7990), (2, "AVE-001", "Pechuga de pollo IQF", "kg", CONG, 5490),
    (2, "AVE-002", "Trutro entero de pollo", "kg", REF, 3290), (3, "CER-001", "Chuleta centro de cerdo", "kg", REF, 6490),
    (3, "CER-002", "Pulpa de cerdo congelada", "kg", CONG, 5990), (4, "PES-001", "Merluza austral filete", "kg", CONG, 7990),
    (4, "PES-002", "Salmón porción congelada", "kg", CONG, 13990), (5, "LAC-001", "Leche UHT caja 12 x 1 L", "caja", REF, 13900),
    (5, "LAC-002", "Queso gauda laminado", "kg", REF, 8990), (5, "LAC-003", "Yogur natural 1 kg", "unidad", REF, 2490),
    (6, "PRE-001", "Hamburguesa de vacuno caja 4 kg", "caja", CONG, 18900), (6, "PRE-002", "Papas prefritas 2,5 kg", "unidad", CONG, 4990),
    (7, "HOS-001", "Nutrición enteral refrigerada 1 L", "unidad", REF, 6990), (7, "HOS-002", "Gel refrigerante clínico", "caja", REF, 15900),
]
w("INSERT INTO producto (id_producto,id_categoria,sku,nombre,descripcion,unidad,temp_min,temp_max) VALUES " + ",".join(
    f"({i+1},{c},{q(s)},{q(n)},{q('Producto de cadena de frío. Conservar entre ' + str(r[0]) + ' y ' + str(r[1]) + ' °C.')},{q(u)},{r[0]},{r[1]})"
    for i, (c, s, n, u, r, p) in enumerate(prods)) + ";")
factor = {1: 1.0, 2: 0.85, 3: 0.88, 4: 0.92}
w("INSERT INTO precio_producto (id_lista,id_producto,precio) VALUES " + ",".join(
    f"({l},{i+1},{round(p * f / 10) * 10})" for l, f in factor.items() for i, (*_, p) in enumerate(prods)) + ";")
w("INSERT INTO bodega (id_bodega,id_comuna,nombre) VALUES (1,1,'Centro de frío Temuco'),(2,3,'Bodega Villarrica');")
w("INSERT INTO inventario (id_bodega,id_producto,stock_actual,stock_minimo) VALUES " + ",".join(
    f"({b},{i+1},{random.choice([350, 500, 800, 1200]) if b == 1 else 120},{80 if b == 1 else 30})" for b in (1, 2) for i in range(len(prods))) + ";")

# ---------- clientes ----------
clientes = [  # tipo, estado, lista, vendedor, rut, nombre, email, tel, pwd, comuna, calle
    (1, 2, 2, 2, "61.607.100-7", "Hospital Regional Araucanía (demo)", "compras@hospitalaraucania.cl", "+56452550000", PWD_CLIENTE, 1, "Av. Alemania"),
    (1, 2, 2, 2, "76.120.330-1", "Clínica Andes Sur (demo)", "abastecimiento@clinicaandessur.cl", "+56452990011", PWD_CLIENTE, 1, "Av. Pablo Neruda"),
    (1, 2, 3, 3, "77.450.210-5", "Supermercados del Sur Ltda. (demo)", "compras@supersur.cl", "+56452330044", PWD_CLIENTE, 3, "Camino Villarrica-Pucón"),
    (1, 2, 4, 3, "76.888.020-9", "Feria Libre Pinto (demo)", "feriapinto@correo.cl", "+56987654321", PWD_CLIENTE, 1, "Av. Barros Arana"),
    (1, 1, 1, 2, "77.123.456-0", "Casino Minero Lautaro (demo)", "contacto@casinominero.cl", "+56451112233", None, 6, "Calle Bilbao"),
    (1, 1, 1, 3, "76.555.444-3", "Colegio San José Pucón (demo)", "administracion@sanjosepucon.cl", "+56452445566", None, 4, "Calle Fresia"),
    (2, 2, 1, None, None, "Camila Rojas", "camila.rojas@mail.cl", "+56911112222", PWD_CLIENTE, 1, "Pasaje Los Aromos"),
    (2, 2, 1, None, None, "Diego Soto", "diego.soto@mail.cl", "+56933334444", PWD_CLIENTE, 3, "Calle Valdivia"),
    (2, 2, 1, None, None, "Fernanda Lagos", "fernanda.lagos@mail.cl", "+56955556666", PWD_CLIENTE, 2, "Av. Maquehue"),
]
w("INSERT INTO cliente (id_cliente,id_tipo,id_estado_cliente,id_lista,id_vendedor,rut,nombre,email,telefono,password_hash,fecha_registro) VALUES " + ",".join(
    f"({i+1},{t},{e},{l},{q(v) if v else 'NULL'},{q(r)},{q(n)},{q(m)},{q(tel)},{q(p)},DATE_SUB(NOW(), INTERVAL {60 - i*5} DAY))"
    for i, (t, e, l, v, r, n, m, tel, p, c, ca) in enumerate(clientes)) + ";")
w("INSERT INTO direccion (id_direccion,id_cliente,id_comuna,calle,numero,referencia) VALUES " + ",".join(
    f"({i+1},{i+1},{c[9]},{q(c[10])},{random.randint(100, 2900)},{q('Andén de recepción' if c[0] == 1 else None)})" for i, c in enumerate(clientes)) + ";")

# ---------- pedidos históricos (últimos 14 días) ----------
activos = [i + 1 for i, c in enumerate(clientes) if c[1] == 2]
lista_de = {i + 1: c[2] for i, c in enumerate(clientes)}
peds, dets = [], []
for pid in range(1, 41):
    cli = random.choice(activos)
    horas = random.randint(2, 14 * 24)
    canal = 1 if clientes[cli - 1][0] == 2 else random.choice([1, 1, 2, 3])
    estado = 5 if horas > 48 else random.choice([1, 2, 3, 4])
    if random.random() < 0.05: estado = 6
    peds.append(f"({pid},{cli},{cli},{canal},{estado},DATE_SUB(NOW(), INTERVAL {horas} HOUR),NULL)")
    for prod in random.sample(range(1, len(prods) + 1), random.randint(1, 4)):
        cant = random.randint(1, 4) if clientes[cli - 1][0] == 2 else random.randint(10, 60)
        precio = round(prods[prod - 1][5] * factor[lista_de[cli]] / 10) * 10
        dets.append(f"({pid},{prod},{cant},{precio})")
w("INSERT INTO pedido (id_pedido,id_cliente,id_direccion,id_canal,id_estado_pedido,fecha_pedido,observacion) VALUES " + ",".join(peds) + ";")
w("INSERT INTO detalle_pedido (id_pedido,id_producto,cantidad,precio_unitario) VALUES " + ",".join(dets) + ";")

# ---------- CRM ----------
w("INSERT INTO oportunidad (id_cliente,id_usuario,id_etapa,id_pedido,titulo,monto_estimado,fecha_apertura,fecha_cierre) VALUES "
  "(1,2,5,1,'Contrato anual proteínas congeladas',4800000,DATE_SUB(NOW(), INTERVAL 50 DAY),DATE_SUB(NOW(), INTERVAL 40 DAY)),"
  "(2,2,4,NULL,'Abastecimiento lácteos clínica',3200000,DATE_SUB(NOW(), INTERVAL 20 DAY),NULL),"
  "(3,3,3,NULL,'Ampliación surtido congelados',5600000,DATE_SUB(NOW(), INTERVAL 12 DAY),NULL),"
  "(5,2,2,NULL,'Casino: menú semanal',1900000,DATE_SUB(NOW(), INTERVAL 8 DAY),NULL),"
  "(6,3,1,NULL,'Alimentación escolar',900000,DATE_SUB(NOW(), INTERVAL 3 DAY),NULL),"
  "(4,3,6,NULL,'Feria: cerdo temporada',600000,DATE_SUB(NOW(), INTERVAL 30 DAY),DATE_SUB(NOW(), INTERVAL 25 DAY));")
w("INSERT INTO interaccion (id_cliente,id_usuario,id_tipo_interaccion,fecha,detalle) VALUES "
  "(2,2,1,DATE_SUB(NOW(), INTERVAL 18 DAY),'Llamada inicial, interesados en lácteos UHT.'),"
  "(2,2,3,DATE_SUB(NOW(), INTERVAL 10 DAY),'Reunión de negociación de volumen mensual.'),"
  "(3,3,2,DATE_SUB(NOW(), INTERVAL 11 DAY),'Envío de cotización congelados.'),"
  "(5,2,1,DATE_SUB(NOW(), INTERVAL 7 DAY),'Primer contacto con administrador del casino.');")
w("INSERT INTO requerimiento (id_cliente,id_pedido,id_categoria_req,mensaje,respuesta_ia,prioridad,resuelto,fecha) VALUES "
  "(1,NULL,4,'El último despacho de pollo llegó blando, necesitamos revisión urgente.','Clasificado como urgencia de cadena de frío. Un ejecutivo lo contactará de inmediato.',1,TRUE,DATE_SUB(NOW(), INTERVAL 6 DAY)),"
  "(7,NULL,3,'¿Hacen despacho a Villarrica los fines de semana?','Sí, despachamos a Villarrica de lunes a sábado.',3,TRUE,DATE_SUB(NOW(), INTERVAL 3 DAY));")

# ---------- logística ----------
camiones = []
for i in range(1, 11):
    cong = i % 2 == 1
    L = "BCDFGHJKLPRSTVWXYZ"
    patente = "".join(random.choice(L) for _ in range(4)) + str(random.randint(10, 99))
    camiones.append(f"('CAM-{i:02d}','{patente}',{random.choice([8000, 10000, 12000])},{-25 if cong else 0},{-18 if cong else 5},TRUE)")
w("INSERT INTO camion (camion_id,patente,capacidad_kg,temp_min,temp_max,activo) VALUES " + ",".join(camiones) + ";")
w("INSERT INTO conductor (id_conductor,rut,nombre,telefono) VALUES (1,'15.234.567-8','Luis Carrasco','+56961110001'),(2,'16.345.678-9','Marcela Fuentes','+56961110002'),(3,'14.456.789-0','Pedro Huenchullán','+56961110003'),(4,'17.567.890-1','Andrea Painemal','+56961110004'),(5,'13.678.901-2','Jorge Saavedra','+56961110005');")
w("-- Los despachos reales se generan desde el CRM al pasar un pedido a 'En ruta'.")

# ---------- telemetría histórica (1 lectura por camión por hora, 14 días) ----------
CENTROS = [(-38.7359, -72.5904), (-39.2833, -72.2275), (-38.2389, -72.3311), (-39.8142, -73.2459), (-37.4697, -72.3537)]
rows = []
for c in range(1, 11):
    cong = c % 2 == 1
    tmin, tmax = (-25, -18) if cong else (0, 5)
    lat0, lon0 = CENTROS[c % len(CENTROS)]
    fuel = 100
    for h in range(14 * 24, 0, -1):
        t = random.uniform(tmin + 1, tmax - 1)
        if random.random() < 0.03: t = tmax + random.uniform(1.5, 6)
        fuel = 100 if fuel < 10 else fuel - random.choice([0, 1, 1, 2])
        rows.append(f"('CAM-{c:02d}',DATE_SUB(NOW(), INTERVAL {h} HOUR),{t:.2f},{lat0 + random.uniform(-0.15, 0.15):.6f},{lon0 + random.uniform(-0.15, 0.15):.6f},{fuel},{1 if not (tmin <= t <= tmax) else 0})")
for k in range(0, len(rows), 500):
    w("INSERT INTO telemetria (camion_id,fecha_hora,temp_camara,lat,lon,combustible_pct,alerta_ruptura_frio) VALUES " + ",".join(rows[k:k + 500]) + ";")

print("\n".join(out))
