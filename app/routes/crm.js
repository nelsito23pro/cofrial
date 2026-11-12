// API del CRM operativo y del Back-Office (flota IoT + BI)
const express = require("express");
const bcrypt = require("bcryptjs");
const { query, transaction } = require("../db");
const { webpay } = require("./pagos");
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
  const [listas, etapas, estados, camiones, conductores, tipos, vendedores, comunas, categoriasReq, soluciones] = await Promise.all([
    query("SELECT id_lista AS id, nombre FROM lista_precio"), query("SELECT id_etapa AS id, nombre, probabilidad_pct FROM etapa_pipeline ORDER BY orden"),
    query("SELECT id_estado_pedido AS id, nombre FROM estado_pedido ORDER BY orden"), query("SELECT camion_id AS id, patente, temp_min, temp_max FROM camion WHERE activo"),
    query("SELECT id_conductor AS id, nombre FROM conductor"), query("SELECT id_tipo_interaccion AS id, nombre FROM tipo_interaccion"),
    query("SELECT u.id_usuario AS id, u.nombre FROM usuario u JOIN rol r ON r.id_rol=u.id_rol WHERE r.nombre='Vendedor'"),
    query("SELECT id_comuna AS id, nombre FROM comuna ORDER BY nombre"),
    query("SELECT id_categoria_req AS id, nombre FROM categoria_requerimiento ORDER BY id_categoria_req"),
    query("SELECT id_solucion AS id, nombre FROM tipo_solucion ORDER BY id_solucion"),
  ]);
  res.json({ listas, etapas, estados, camiones, conductores, tipos, vendedores, comunas, categoriasReq, soluciones });
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
    query(`SELECT r.id_requerimiento, r.fecha, cr.nombre AS categoria, r.mensaje, r.prioridad, r.estado FROM requerimiento r
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
      (SELECT d.camion_id FROM despacho_pedido dp JOIN despacho d ON d.id_despacho=dp.id_despacho WHERE dp.id_pedido=v.id_pedido ORDER BY d.id_despacho DESC LIMIT 1) AS camion_id,
      pg.estado AS pago_estado, pg.tarjeta_ultimos4 AS pago_tarjeta, pg.codigo_autorizacion AS pago_autorizacion
    FROM v_pedido_total v JOIN pedido p ON p.id_pedido=v.id_pedido JOIN direccion di ON di.id_direccion=p.id_direccion
    JOIN comuna co ON co.id_comuna=di.id_comuna
    LEFT JOIN pago pg ON pg.id_pago=(SELECT MAX(id_pago) FROM pago WHERE id_pedido=v.id_pedido) ${where} ORDER BY v.fecha_pedido DESC LIMIT 200`, req.query.estado ? [req.query.estado] : []);
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

// ---------- casos de atención (requerimientos clasificados por IA) ----------
// Plazo según prioridad (v_caso): Alta 2 h · Media 24 h · Baja 72 h
router.get("/requerimientos", ok(async (req, res) => {
  const filtro = { abiertos: "WHERE v.estado<>'Resuelto'", resueltos: "WHERE v.estado='Resuelto'" }[req.query.estado] || "";
  res.json(await query(`SELECT v.id_requerimiento, v.fecha, v.mensaje, v.respuesta_ia, v.prioridad, v.estado, v.id_pedido, v.categoria,
      v.id_cliente, v.cliente, v.tipo_cliente, v.fecha_limite, v.en_plazo, v.horas_resolucion, v.calificacion,
      TIMESTAMPDIFF(MINUTE, NOW(), v.fecha_limite) AS minutos_restantes,
      COALESCE(g.nombre, ven.nombre) AS ejecutivo, ts.nombre AS solucion
    FROM v_caso v LEFT JOIN usuario g ON g.id_usuario=v.id_usuario LEFT JOIN usuario ven ON ven.id_usuario=v.id_vendedor
    LEFT JOIN tipo_solucion ts ON ts.id_solucion=v.id_solucion ${filtro}
    ORDER BY v.estado='Resuelto', v.prioridad, v.fecha_limite, v.fecha DESC LIMIT 200`));
}));

// Detalle del caso: pedido, pago, despacho y evidencia IoT del camión durante el despacho
router.get("/requerimientos/:id", ok(async (req, res) => {
  const [caso] = await query(`SELECT v.*, TIMESTAMPDIFF(MINUTE, NOW(), v.fecha_limite) AS minutos_restantes, ts.nombre AS solucion,
      g.nombre AS gestor, ven.nombre AS vendedor
    FROM v_caso v LEFT JOIN tipo_solucion ts ON ts.id_solucion=v.id_solucion LEFT JOIN usuario g ON g.id_usuario=v.id_usuario
    LEFT JOIN usuario ven ON ven.id_usuario=v.id_vendedor WHERE v.id_requerimiento=?`, [req.params.id]);
  if (!caso) throw fail(404, "Caso no encontrado");
  const pedidosCliente = await query("SELECT id_pedido, fecha_pedido, estado, total_con_iva FROM v_pedido_total WHERE id_cliente=? ORDER BY fecha_pedido DESC LIMIT 15", [caso.id_cliente]);
  let pedido = null, items = [], pago = null, despacho = null, evidencia = null;
  if (caso.id_pedido) {
    [pedido] = await query("SELECT id_pedido, fecha_pedido, estado, canal, total_neto, total_con_iva FROM v_pedido_total WHERE id_pedido=?", [caso.id_pedido]);
    items = await query(`SELECT d.id_producto, pr.nombre, pr.unidad, d.cantidad, d.precio_unitario FROM detalle_pedido d
      JOIN producto pr ON pr.id_producto=d.id_producto WHERE d.id_pedido=?`, [caso.id_pedido]);
    [pago] = await query(`SELECT estado, monto, tarjeta_ultimos4, codigo_autorizacion, token IS NOT NULL AS reembolsable,
        monto - COALESCE((SELECT SUM(r.monto_compensacion) FROM requerimiento r WHERE r.id_pedido=pago.id_pedido AND r.id_solucion=2), 0) AS saldo_reembolsable
      FROM pago WHERE id_pedido=? ORDER BY id_pago DESC LIMIT 1`, [caso.id_pedido]);
    [despacho] = await query(`SELECT d.camion_id, ca.patente, ca.temp_min, ca.temp_max, co.nombre AS conductor, d.fecha_salida,
        COALESCE(dp.fecha_entrega, d.fecha_llegada) AS fecha_entrega
      FROM despacho_pedido dp JOIN despacho d ON d.id_despacho=dp.id_despacho JOIN camion ca ON ca.camion_id=d.camion_id
      JOIN conductor co ON co.id_conductor=d.id_conductor WHERE dp.id_pedido=? ORDER BY d.id_despacho DESC LIMIT 1`, [caso.id_pedido]);
    if (despacho) {   // telemetría del camión entre la salida y la entrega (o hasta ahora, si sigue en ruta)
      const desde = despacho.fecha_salida, hasta = despacho.fecha_entrega || null;
      const rango = "camion_id=? AND fecha_hora >= ? AND fecha_hora <= COALESCE(?, NOW())", p = [despacho.camion_id, desde, hasta];
      const [[resumen], serie, listaAlertas] = await Promise.all([
        query(`SELECT COUNT(*) AS lecturas, COALESCE(SUM(alerta_ruptura_frio),0) AS alertas, MIN(temp_camara) AS temp_min_obs,
            MAX(temp_camara) AS temp_max_obs, ROUND(AVG(temp_camara),2) AS temp_prom FROM telemetria WHERE ${rango}`, p),
        query(`SELECT MIN(fecha_hora) AS t, ROUND(AVG(temp_camara),2) AS temp, MAX(alerta_ruptura_frio) AS alerta FROM telemetria WHERE ${rango}
            GROUP BY FLOOR(UNIX_TIMESTAMP(fecha_hora) / GREATEST(60, CEIL(TIMESTAMPDIFF(SECOND, ?, COALESCE(?, NOW())) / 120))) ORDER BY t`, [...p, desde, hasta]),
        query(`SELECT fecha_hora, temp_camara FROM telemetria WHERE ${rango} AND alerta_ruptura_frio ORDER BY fecha_hora LIMIT 10`, p),
      ]);
      evidencia = { ...resumen, serie, lista_alertas: listaAlertas };
    }
  }
  res.json({ caso, pedido, items, pago, despacho, evidencia, pedidosCliente });
}));

// Acciones rápidas: tomar el caso, reclasificar lo que propuso la IA o vincular un pedido
router.patch("/requerimientos/:id", ok(async (req, res) => {
  const id = req.params.id, b = req.body, yo = req.session.usuario;
  const [caso] = await query("SELECT id_cliente, estado FROM requerimiento WHERE id_requerimiento=?", [id]);
  if (!caso) throw fail(404, "Caso no encontrado");
  if (caso.estado === "Resuelto") throw fail(409, "El caso ya está resuelto");
  if (b.accion === "tomar") {
    await query("UPDATE requerimiento SET estado='En gestión', id_usuario=? WHERE id_requerimiento=?", [yo.id_usuario, id]);
  } else if (b.accion === "reclasificar") {
    if (![1, 2, 3].includes(Number(b.prioridad))) throw fail(400, "Prioridad inválida");
    await query("UPDATE requerimiento SET prioridad=?, id_categoria_req=? WHERE id_requerimiento=?", [b.prioridad, b.id_categoria_req, id]);
  } else if (b.accion === "vincular") {
    const [p] = await query("SELECT id_pedido FROM pedido WHERE id_pedido=? AND id_cliente=?", [b.id_pedido, caso.id_cliente]);
    if (!p) throw fail(400, "El pedido no pertenece a este cliente");
    await query("UPDATE requerimiento SET id_pedido=? WHERE id_requerimiento=?", [p.id_pedido, id]);
  } else throw fail(400, "Acción desconocida");
  res.json({ ok: true });
}));

// Resolución con una solución concreta + mensaje al cliente (lo ve en "Mis casos" y puede calificar la atención)
//   1 Reposición: pedido sin costo con los productos afectados (descuenta stock)
//   2 Reembolso Webpay: devolución total o parcial con Transbank (solo pedidos pagados con Webpay)
//   3 Nota de crédito: monto a favor del cliente   ·   4 Solo respuesta
router.post("/requerimientos/:id/resolver", ok(async (req, res) => {
  const id = Number(req.params.id), b = req.body, yo = req.session.usuario;
  const solucion = Number(b.id_solucion), mensaje = String(b.mensaje || "").trim();
  if (![1, 2, 3, 4].includes(solucion)) throw fail(400, "Elige una solución");
  if (mensaje.length < 10) throw fail(400, "Escribe un mensaje para el cliente (mínimo 10 caracteres)");
  const detalle = await transaction(async (cn) => {
    const [[caso]] = await cn.query("SELECT * FROM requerimiento WHERE id_requerimiento=? FOR UPDATE", [id]);
    if (!caso) throw fail(404, "Caso no encontrado");
    if (caso.estado === "Resuelto") throw fail(409, "El caso ya está resuelto");
    let monto = null, reposicion = null, texto;
    if ((solucion === 1 || solucion === 2) && !caso.id_pedido) throw fail(400, "Vincula primero el pedido afectado");

    if (solucion === 1) {
      const [orig] = await cn.query("SELECT id_producto, cantidad FROM detalle_pedido WHERE id_pedido=?", [caso.id_pedido]);
      const items = (b.items || []).map((i) => ({ id: Number(i.id_producto), cant: Number(i.cantidad) })).filter((i) => i.cant > 0);
      if (!items.length) throw fail(400, "Indica qué productos se reponen");
      for (const it of items) {
        const o = orig.find((x) => x.id_producto === it.id);
        if (!o || it.cant > Number(o.cantidad)) throw fail(400, "Solo se puede reponer hasta la cantidad del pedido original");
        const [[inv]] = await cn.query("SELECT stock_actual FROM inventario WHERE id_bodega=1 AND id_producto=? FOR UPDATE", [it.id]);
        if (!inv || inv.stock_actual < it.cant) throw fail(409, `Stock insuficiente para reponer el producto ${it.id}`);
      }
      const [[op]] = await cn.query("SELECT id_direccion FROM pedido WHERE id_pedido=?", [caso.id_pedido]);
      const [r] = await cn.query("INSERT INTO pedido (id_cliente,id_direccion,id_canal,id_estado_pedido,observacion) VALUES (?,?,2,2,?)",
        [caso.id_cliente, op.id_direccion, `Reposición sin costo · caso N° ${id} (pedido N° ${caso.id_pedido})`]);
      reposicion = r.insertId;
      for (const it of items) {
        await cn.query("INSERT INTO detalle_pedido (id_pedido,id_producto,cantidad,precio_unitario) VALUES (?,?,?,0)", [reposicion, it.id, it.cant]);
        await cn.query("UPDATE inventario SET stock_actual=stock_actual-? WHERE id_bodega=1 AND id_producto=?", [it.cant, it.id]);
      }
      texto = `reposición sin costo (pedido N° ${reposicion})`;
    } else if (solucion === 2) {
      const [[pg]] = await cn.query(`SELECT id_pago, token, monto,
          monto - COALESCE((SELECT SUM(monto_compensacion) FROM requerimiento WHERE id_pedido=? AND id_solucion=2), 0) AS saldo
        FROM pago WHERE id_pedido=? AND estado='Aprobado' AND token IS NOT NULL ORDER BY id_pago DESC LIMIT 1 FOR UPDATE`, [caso.id_pedido, caso.id_pedido]);
      if (!pg) throw fail(400, "El pedido no tiene un pago Webpay aprobado que se pueda reembolsar");
      monto = Math.round(Number(b.monto));
      if (!(monto > 0) || monto > pg.saldo) throw fail(400, `El reembolso debe estar entre $1 y ${pg.saldo}`);
      let r;
      try { r = await webpay.refund(pg.token, monto); }
      catch (e) { console.error("Webpay refund:", e.message); throw fail(502, "Transbank rechazó el reembolso: " + e.message); }
      if (monto === Number(pg.saldo)) await cn.query("UPDATE pago SET estado='Reembolsado' WHERE id_pago=?", [pg.id_pago]);
      texto = `reembolso Webpay de $${monto.toLocaleString("es-CL")} (${r.type === "REVERSED" ? "reversa" : "anulación"}${r.authorization_code ? ", autorización " + r.authorization_code : ""})`;
    } else if (solucion === 3) {
      monto = Math.round(Number(b.monto));
      if (!(monto > 0)) throw fail(400, "Indica el monto de la nota de crédito");
      texto = `nota de crédito por $${monto.toLocaleString("es-CL")}`;
    } else texto = "respuesta al cliente";

    await cn.query(`UPDATE requerimiento SET estado='Resuelto', id_usuario=?, id_solucion=?, respuesta_ejecutivo=?, monto_compensacion=?,
      id_pedido_reposicion=?, fecha_resolucion=NOW() WHERE id_requerimiento=?`, [yo.id_usuario, solucion, mensaje, monto, reposicion, id]);
    await cn.query("INSERT INTO interaccion (id_cliente,id_usuario,id_tipo_interaccion,detalle) VALUES (?,?,5,?)",
      [caso.id_cliente, yo.id_usuario, `Caso N° ${id} resuelto con ${texto}.`]);
    return texto;
  });
  res.json({ ok: true, detalle });
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
  const [kpi, cruce, canal, tipo, top, pipeline, alertasCamion, casos, casosCategoria] = await Promise.all([
    query(`SELECT
      (SELECT COALESCE(SUM(total_neto),0) FROM v_pedido_total WHERE estado<>'Cancelado' AND fecha_pedido >= CURDATE() - INTERVAL 13 DAY) AS ventas_14d,
      (SELECT COUNT(*) FROM pedido WHERE fecha_pedido >= CURDATE()) AS pedidos_hoy,
      (SELECT COUNT(*) FROM pedido WHERE id_estado_pedido IN (1,2,3)) AS pedidos_pendientes,
      (SELECT COUNT(*) FROM telemetria WHERE alerta_ruptura_frio AND fecha_hora >= NOW() - INTERVAL 1 HOUR) AS alertas_1h,
      (SELECT COUNT(*) FROM telemetria WHERE fecha_hora >= NOW() - INTERVAL 5 MINUTE) AS lecturas_5min,
      (SELECT COUNT(*) FROM requerimiento WHERE estado<>'Resuelto') AS requerimientos_abiertos,
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
    // Atención al cliente: casos abiertos y vencidos ahora; tiempos, cumplimiento de plazo y satisfacción de los últimos 30 días
    query(`SELECT SUM(estado<>'Resuelto') AS abiertos, SUM(estado<>'Resuelto' AND NOT en_plazo) AS vencidos,
        ROUND(AVG(CASE WHEN estado='Resuelto' THEN horas_resolucion END), 1) AS horas_promedio,
        ROUND(100 * AVG(CASE WHEN estado='Resuelto' THEN en_plazo END)) AS pct_en_plazo,
        ROUND(AVG(calificacion), 1) AS satisfaccion, COUNT(calificacion) AS encuestas
      FROM v_caso WHERE estado<>'Resuelto' OR fecha >= NOW() - INTERVAL 30 DAY`),
    query(`SELECT COALESCE(categoria,'Sin categoría') AS categoria, SUM(estado<>'Resuelto') AS abiertos, SUM(estado='Resuelto') AS resueltos
      FROM v_caso WHERE estado<>'Resuelto' OR fecha >= NOW() - INTERVAL 30 DAY GROUP BY categoria ORDER BY categoria`),
  ]);
  res.json({ kpi: kpi[0], cruce, canal, tipo, top, pipeline, alertasCamion, casos: casos[0], casosCategoria });
}));

module.exports = router;
