// API del CRM operativo y del Back-Office (flota IoT + BI)
const express = require("express");
const bcrypt = require("bcryptjs");
const { query, transaction } = require("../db");
const router = express.Router();

const ok = (fn) => (req, res) => fn(req, res).catch((e) => { console.error(e); res.status(e.status || 500).json({ error: e.message }); });
const auth = (req, res, next) => (req.session.usuario ? next() : res.status(401).json({ error: "Sesión de CRM requerida" }));
const fail = (status, msg) => Object.assign(new Error(msg), { status });

// ---------- sesión interna ----------
router.post("/login", ok(async (req, res) => {
  const [u] = await query(`SELECT u.id_usuario, u.nombre, u.password_hash, r.nombre AS rol FROM usuario u JOIN rol r ON r.id_rol=u.id_rol
    WHERE u.email=? AND u.activo`, [String(req.body.email || "").trim().toLowerCase()]);
  if (!u || !(await bcrypt.compare(req.body.password || "", u.password_hash))) return res.status(401).json({ error: "Credenciales inválidas" });
  req.session.usuario = { id_usuario: u.id_usuario, nombre: u.nombre, rol: u.rol };
  res.json(req.session.usuario);
}));
router.post("/logout", (req, res) => { req.session.usuario = null; res.json({ ok: true }); });
router.get("/me", (req, res) => res.json(req.session.usuario || null));

router.use(auth); // todo lo siguiente exige sesión de CRM

router.get("/catalogos", ok(async (req, res) => {
  const [listas, etapas, estados, camiones, conductores, tipos, vendedores, comunas] = await Promise.all([
    query("SELECT id_lista AS id, nombre FROM lista_precio"), query("SELECT id_etapa AS id, nombre, probabilidad_pct FROM etapa_pipeline ORDER BY orden"),
    query("SELECT id_estado_pedido AS id, nombre FROM estado_pedido ORDER BY orden"), query("SELECT camion_id AS id, patente, temp_min, temp_max FROM camion WHERE activo"),
    query("SELECT id_conductor AS id, nombre FROM conductor"), query("SELECT id_tipo_interaccion AS id, nombre FROM tipo_interaccion"),
    query("SELECT u.id_usuario AS id, u.nombre FROM usuario u JOIN rol r ON r.id_rol=u.id_rol WHERE r.nombre='Vendedor'"),
    query("SELECT id_comuna AS id, nombre FROM comuna ORDER BY nombre"),
  ]);
  res.json({ listas, etapas, estados, camiones, conductores, tipos, vendedores, comunas });
}));

// ---------- clientes y prospectos ----------
router.get("/clientes", ok(async (req, res) => {
  const where = ["1=1"], p = [];
  if (req.query.tipo) { where.push("tc.nombre=?"); p.push(req.query.tipo); }
  if (req.query.estado) { where.push("ec.nombre=?"); p.push(req.query.estado); }
  if (req.query.q) { where.push("(c.nombre LIKE ? OR c.email LIKE ? OR c.rut LIKE ?)"); p.push(...Array(3).fill(`%${req.query.q}%`)); }
  res.json(await query(`SELECT c.id_cliente, c.nombre, c.rut, c.email, c.telefono, tc.nombre AS tipo, ec.nombre AS estado, lp.nombre AS lista,
      u.nombre AS vendedor, c.fecha_registro,
      (SELECT COUNT(*) FROM pedido pe WHERE pe.id_cliente=c.id_cliente) AS pedidos,
      (SELECT COALESCE(SUM(total_neto),0) FROM v_pedido_total v WHERE v.id_cliente=c.id_cliente AND v.estado<>'Cancelado') AS compras_netas
    FROM cliente c JOIN tipo_cliente tc ON tc.id_tipo=c.id_tipo JOIN estado_cliente ec ON ec.id_estado_cliente=c.id_estado_cliente
    JOIN lista_precio lp ON lp.id_lista=c.id_lista LEFT JOIN usuario u ON u.id_usuario=c.id_vendedor
    WHERE ${where.join(" AND ")} ORDER BY (ec.nombre='Prospecto') DESC, c.nombre`, p));
}));

router.get("/clientes/:id", ok(async (req, res) => {
  const id = req.params.id;
  const [cliente] = await query(`SELECT c.*, tc.nombre AS tipo, ec.nombre AS estado, lp.nombre AS lista, u.nombre AS vendedor
    FROM cliente c JOIN tipo_cliente tc ON tc.id_tipo=c.id_tipo JOIN estado_cliente ec ON ec.id_estado_cliente=c.id_estado_cliente
    JOIN lista_precio lp ON lp.id_lista=c.id_lista LEFT JOIN usuario u ON u.id_usuario=c.id_vendedor WHERE c.id_cliente=?`, [id]);
  if (!cliente) return res.status(404).json({ error: "Cliente no encontrado" });
  delete cliente.password_hash;
  const [direcciones, pedidos, interacciones, oportunidades, requerimientos] = await Promise.all([
    query("SELECT d.*, co.nombre AS comuna FROM direccion d JOIN comuna co ON co.id_comuna=d.id_comuna WHERE d.id_cliente=?", [id]),
    query("SELECT id_pedido, fecha_pedido, estado, canal, total_neto FROM v_pedido_total WHERE id_cliente=? ORDER BY fecha_pedido DESC", [id]),
    query(`SELECT i.fecha, t.nombre AS tipo, i.detalle, u.nombre AS usuario FROM interaccion i JOIN tipo_interaccion t ON t.id_tipo_interaccion=i.id_tipo_interaccion
      LEFT JOIN usuario u ON u.id_usuario=i.id_usuario WHERE i.id_cliente=? ORDER BY i.fecha DESC`, [id]),
    query(`SELECT o.id_oportunidad, o.titulo, o.monto_estimado, e.nombre AS etapa FROM oportunidad o JOIN etapa_pipeline e ON e.id_etapa=o.id_etapa
      WHERE o.id_cliente=? ORDER BY o.fecha_apertura DESC`, [id]),
    query(`SELECT r.fecha, cr.nombre AS categoria, r.mensaje, r.prioridad, r.resuelto FROM requerimiento r
      LEFT JOIN categoria_requerimiento cr ON cr.id_categoria_req=r.id_categoria_req WHERE r.id_cliente=? ORDER BY r.fecha DESC`, [id]),
  ]);
  res.json({ cliente, direcciones, pedidos, interacciones, oportunidades, requerimientos });
}));

// Alta manual de un prospecto (por ejemplo, contacto en una feria) + oportunidad inicial
router.post("/clientes", ok(async (req, res) => {
  const b = req.body;
  if (!b.nombre || !b.email) throw fail(400, "Nombre y email son obligatorios");
  const id = await transaction(async (cn) => {
    const [r] = await cn.query(`INSERT INTO cliente (id_tipo,id_estado_cliente,id_lista,id_vendedor,rut,nombre,email,telefono)
      VALUES (?,1,1,?,?,?,?,?)`, [b.tipo === "B2C" ? 2 : 1, req.session.usuario.id_usuario, b.rut || null, b.nombre, b.email.trim().toLowerCase(), b.telefono || null]);
    if (b.id_comuna && b.calle) await cn.query("INSERT INTO direccion (id_cliente,id_comuna,calle,numero) VALUES (?,?,?,?)", [r.insertId, b.id_comuna, b.calle, b.numero || null]);
    await cn.query("INSERT INTO oportunidad (id_cliente,id_usuario,id_etapa,titulo,monto_estimado) VALUES (?,?,1,?,?)",
      [r.insertId, req.session.usuario.id_usuario, b.titulo || `Oportunidad ${b.nombre}`, b.monto_estimado || null]);
    return r.insertId;
  });
  res.json({ id_cliente: id });
}));

// Aprobación de cuenta B2B: pasa a Activo y se le asigna su lista de precios institucional
router.post("/clientes/:id/aprobar", ok(async (req, res) => {
  await query("UPDATE cliente SET id_estado_cliente=2, id_lista=?, id_vendedor=COALESCE(id_vendedor, ?) WHERE id_cliente=?",
    [req.body.id_lista || 1, req.session.usuario.id_usuario, req.params.id]);
  await query("INSERT INTO interaccion (id_cliente,id_usuario,id_tipo_interaccion,detalle) VALUES (?,?,2,?)",
    [req.params.id, req.session.usuario.id_usuario, "Cuenta B2B aprobada y lista de precios asignada."]);
  res.json({ ok: true });
}));

router.post("/clientes/:id/interacciones", ok(async (req, res) => {
  if (!req.body.detalle) throw fail(400, "Describe la interacción");
  await query("INSERT INTO interaccion (id_cliente,id_usuario,id_tipo_interaccion,detalle) VALUES (?,?,?,?)",
    [req.params.id, req.session.usuario.id_usuario, req.body.id_tipo_interaccion || 1, req.body.detalle]);
  res.json({ ok: true });
}));

// ---------- pipeline ----------
router.get("/pipeline", ok(async (req, res) => res.json(await query(`SELECT o.id_oportunidad, o.titulo, o.monto_estimado, o.id_etapa, o.id_pedido,
    o.fecha_apertura, o.fecha_cierre, c.id_cliente, c.nombre AS cliente, u.nombre AS vendedor, e.probabilidad_pct
  FROM oportunidad o JOIN cliente c ON c.id_cliente=o.id_cliente JOIN usuario u ON u.id_usuario=o.id_usuario
  JOIN etapa_pipeline e ON e.id_etapa=o.id_etapa ORDER BY o.fecha_apertura DESC`))));

router.post("/oportunidades", ok(async (req, res) => {
  const b = req.body;
  if (!b.id_cliente || !b.titulo) throw fail(400, "Cliente y título son obligatorios");
  const [r] = await require("../db").pool.query("INSERT INTO oportunidad (id_cliente,id_usuario,id_etapa,titulo,monto_estimado) VALUES (?,?,?,?,?)",
    [b.id_cliente, req.session.usuario.id_usuario, b.id_etapa || 1, b.titulo, b.monto_estimado || null]);
  res.json({ id_oportunidad: r.insertId });
}));

router.patch("/oportunidades/:id", ok(async (req, res) => {
  const etapa = Number(req.body.id_etapa);
  await query("UPDATE oportunidad SET id_etapa=?, fecha_cierre=IF(? IN (5,6), COALESCE(fecha_cierre, NOW()), NULL) WHERE id_oportunidad=?",
    [etapa, etapa, req.params.id]);
  if (etapa === 5) await query(`UPDATE cliente c JOIN oportunidad o ON o.id_cliente=c.id_cliente SET c.id_estado_cliente=2
    WHERE o.id_oportunidad=? AND c.id_estado_cliente=1 AND c.id_tipo=2`, [req.params.id]);
  res.json({ ok: true });
}));

// ---------- pedidos (web y CRM) ----------
router.get("/pedidos", ok(async (req, res) => {
  const where = req.query.estado ? "WHERE v.estado=?" : "";
  const pedidos = await query(`SELECT v.*, p.observacion, co.nombre AS comuna,
      (SELECT d.camion_id FROM despacho_pedido dp JOIN despacho d ON d.id_despacho=dp.id_despacho WHERE dp.id_pedido=v.id_pedido ORDER BY d.id_despacho DESC LIMIT 1) AS camion_id
    FROM v_pedido_total v JOIN pedido p ON p.id_pedido=v.id_pedido JOIN direccion di ON di.id_direccion=p.id_direccion
    JOIN comuna co ON co.id_comuna=di.id_comuna ${where} ORDER BY v.fecha_pedido DESC LIMIT 200`, req.query.estado ? [req.query.estado] : []);
  res.json(pedidos);
}));

// Cambio de estado. "En ruta" crea el despacho (camión + conductor) y "Entregado" registra la entrega.
router.patch("/pedidos/:id/estado", ok(async (req, res) => {
  const id = Number(req.params.id), estado = Number(req.body.id_estado_pedido);
  await transaction(async (cn) => {
    if (estado === 4) {
      if (!req.body.camion_id || !req.body.id_conductor) throw fail(400, "Para pasar a 'En ruta' asigna camión y conductor");
      let [[d]] = await cn.query("SELECT id_despacho FROM despacho WHERE camion_id=? AND fecha_llegada IS NULL ORDER BY id_despacho DESC LIMIT 1", [req.body.camion_id]);
      let idDesp = d && d.id_despacho;
      if (!idDesp) {
        const [r] = await cn.query("INSERT INTO despacho (camion_id,id_conductor) VALUES (?,?)", [req.body.camion_id, req.body.id_conductor]);
        idDesp = r.insertId;
      }
      const [[n]] = await cn.query("SELECT COUNT(*) AS n FROM despacho_pedido WHERE id_despacho=?", [idDesp]);
      await cn.query("INSERT IGNORE INTO despacho_pedido (id_despacho,id_pedido,orden_entrega) VALUES (?,?,?)", [idDesp, id, n.n + 1]);
    }
    if (estado === 5) await cn.query("UPDATE despacho_pedido SET fecha_entrega=NOW() WHERE id_pedido=? AND fecha_entrega IS NULL", [id]);
    if (estado === 6) { // cancelación: devuelve stock a la bodega
      const [[p]] = await cn.query("SELECT id_estado_pedido FROM pedido WHERE id_pedido=?", [id]);
      if (p && p.id_estado_pedido !== 6) await cn.query(`UPDATE inventario i JOIN detalle_pedido d ON d.id_producto=i.id_producto
        SET i.stock_actual=i.stock_actual+d.cantidad WHERE d.id_pedido=? AND i.id_bodega=1`, [id]);
    }
    await cn.query("UPDATE pedido SET id_estado_pedido=? WHERE id_pedido=?", [estado, id]);
  });
  res.json({ ok: true });
}));

// ---------- requerimientos clasificados por IA ----------
router.get("/requerimientos", ok(async (req, res) => res.json(await query(`SELECT r.id_requerimiento, r.fecha, r.mensaje, r.respuesta_ia, r.prioridad, r.resuelto,
    r.id_pedido, cr.nombre AS categoria, c.id_cliente, c.nombre AS cliente, u.nombre AS vendedor
  FROM requerimiento r JOIN cliente c ON c.id_cliente=r.id_cliente LEFT JOIN categoria_requerimiento cr ON cr.id_categoria_req=r.id_categoria_req
  LEFT JOIN usuario u ON u.id_usuario=c.id_vendedor ORDER BY r.resuelto, r.prioridad, r.fecha DESC LIMIT 200`))));

router.patch("/requerimientos/:id", ok(async (req, res) => {
  await query("UPDATE requerimiento SET resuelto=? WHERE id_requerimiento=?", [req.body.resuelto ? 1 : 0, req.params.id]);
  res.json({ ok: true });
}));

// ---------- flota IoT ----------
router.get("/flota", ok(async (req, res) => {
  const [camiones, alertas] = await Promise.all([
    query(`SELECT v.*, TIMESTAMPDIFF(SECOND, v.fecha_hora, NOW()) AS segundos,
        (SELECT COUNT(*) FROM telemetria t WHERE t.camion_id=v.camion_id AND t.alerta_ruptura_frio AND t.fecha_hora >= NOW() - INTERVAL 1 HOUR) AS alertas_1h
      FROM v_ultima_lectura v ORDER BY v.camion_id`),
    query(`SELECT t.id_lectura, t.camion_id, t.fecha_hora, t.temp_camara, t.lat, t.lon, c.temp_min, c.temp_max
      FROM telemetria t JOIN camion c ON c.camion_id=t.camion_id WHERE t.alerta_ruptura_frio ORDER BY t.id_lectura DESC LIMIT 30`),
  ]);
  res.json({ camiones, alertas });
}));

router.get("/flota/:camion/historial", ok(async (req, res) => res.json(await query(
  `SELECT fecha_hora, temp_camara, alerta_ruptura_frio, combustible_pct FROM telemetria WHERE camion_id=? AND fecha_hora >= NOW() - INTERVAL 30 MINUTE ORDER BY id_lectura`,
  [req.params.camion]))));

// ---------- Business Intelligence (cruce comercial + cadena de frío) ----------
router.get("/bi", ok(async (req, res) => {
  const [kpi, cruce, canal, tipo, top, pipeline, alertasCamion] = await Promise.all([
    query(`SELECT
      (SELECT COALESCE(SUM(total_neto),0) FROM v_pedido_total WHERE estado<>'Cancelado' AND fecha_pedido >= CURDATE() - INTERVAL 13 DAY) AS ventas_14d,
      (SELECT COUNT(*) FROM pedido WHERE fecha_pedido >= CURDATE()) AS pedidos_hoy,
      (SELECT COUNT(*) FROM pedido WHERE id_estado_pedido IN (1,2,3)) AS pedidos_pendientes,
      (SELECT COUNT(*) FROM telemetria WHERE alerta_ruptura_frio AND fecha_hora >= NOW() - INTERVAL 1 HOUR) AS alertas_1h,
      (SELECT COUNT(*) FROM telemetria WHERE fecha_hora >= NOW() - INTERVAL 5 MINUTE) AS lecturas_5min,
      (SELECT COUNT(*) FROM requerimiento WHERE NOT resuelto) AS requerimientos_abiertos,
      (SELECT ROUND(100*SUM(id_canal=1)/COUNT(*)) FROM pedido WHERE fecha_pedido >= CURDATE() - INTERVAL 13 DAY) AS pct_web`),
    query("SELECT dia, pedidos, ventas_netas, alertas_frio FROM v_ventas_vs_alertas WHERE dia >= CURDATE() - INTERVAL 13 DAY ORDER BY dia"),
    query("SELECT canal, COUNT(*) AS pedidos, SUM(total_neto) AS ventas FROM v_pedido_total WHERE estado<>'Cancelado' GROUP BY canal ORDER BY ventas DESC"),
    query("SELECT tipo_cliente, COUNT(*) AS pedidos, SUM(total_neto) AS ventas FROM v_pedido_total WHERE estado<>'Cancelado' GROUP BY tipo_cliente"),
    query(`SELECT pr.nombre, SUM(d.cantidad*d.precio_unitario) AS ventas FROM detalle_pedido d JOIN producto pr ON pr.id_producto=d.id_producto
      JOIN pedido p ON p.id_pedido=d.id_pedido WHERE p.id_estado_pedido<>6 GROUP BY pr.nombre ORDER BY ventas DESC LIMIT 6`),
    query(`SELECT e.nombre AS etapa, COUNT(o.id_oportunidad) AS oportunidades, COALESCE(SUM(o.monto_estimado),0) AS monto,
      COALESCE(SUM(o.monto_estimado*e.probabilidad_pct/100),0) AS ponderado
      FROM etapa_pipeline e LEFT JOIN oportunidad o ON o.id_etapa=e.id_etapa GROUP BY e.id_etapa, e.nombre ORDER BY e.orden`),
    query(`SELECT camion_id, SUM(alerta_ruptura_frio) AS alertas FROM telemetria WHERE fecha_hora >= NOW() - INTERVAL 24 HOUR GROUP BY camion_id ORDER BY camion_id`),
  ]);
  res.json({ kpi: kpi[0], cruce, canal, tipo, top, pipeline, alertasCamion });
}));

module.exports = router;
