// API pública del E-commerce B2B/B2C (Front-Office)
const express = require("express");
const bcrypt = require("bcryptjs");
const { query, transaction } = require("../db");
const { clasificar } = require("../ai");
const router = express.Router();

const BODEGA_DESPACHO = 1;   // Centro de frío Temuco
const LISTA_GENERAL = 1;     // General B2C
const IVA = 0.19;

const soloCliente = (req, res, next) => (req.session.cliente ? next() : res.status(401).json({ error: "Debes iniciar sesión" }));
const ok = (fn) => (req, res) => fn(req, res).catch((e) => { console.error(e); res.status(500).json({ error: e.message }); });

// ---------- sesión ----------
router.get("/me", ok(async (req, res) => {
  if (!req.session.cliente) return res.json({ cliente: null });
  const [c] = await query(
    `SELECT c.id_cliente, c.nombre, c.email, tc.nombre AS tipo, ec.nombre AS estado, lp.nombre AS lista
     FROM cliente c JOIN tipo_cliente tc ON tc.id_tipo=c.id_tipo JOIN estado_cliente ec ON ec.id_estado_cliente=c.id_estado_cliente
     JOIN lista_precio lp ON lp.id_lista=c.id_lista WHERE c.id_cliente=?`, [req.session.cliente.id_cliente]);
  res.json({ cliente: c || null });
}));

router.post("/auth/login", ok(async (req, res) => {
  const { email, password } = req.body;
  const [c] = await query("SELECT id_cliente, password_hash FROM cliente WHERE email=?", [String(email || "").trim().toLowerCase()]);
  if (!c || !c.password_hash || !(await bcrypt.compare(password || "", c.password_hash)))
    return res.status(401).json({ error: "Credenciales inválidas" });
  req.session.cliente = { id_cliente: c.id_cliente };
  res.json({ ok: true });
}));

router.post("/auth/logout", (req, res) => { req.session.cliente = null; res.json({ ok: true }); });

// Registro B2C (activo de inmediato) o B2B (queda como Prospecto hasta que un vendedor lo apruebe en el CRM)
router.post("/auth/register", ok(async (req, res) => {
  const b = req.body;
  const tipo = b.tipo === "B2B" ? 1 : 2;
  const email = String(b.email || "").trim().toLowerCase();
  if (!b.nombre || !email || !b.password || b.password.length < 8 || !b.id_comuna || !b.calle)
    return res.status(400).json({ error: "Completa nombre, email, contraseña (mín. 8 caracteres), comuna y dirección" });
  if (tipo === 1 && !b.rut) return res.status(400).json({ error: "El RUT de la empresa es obligatorio para clientes B2B" });
  const [existe] = await query("SELECT 1 FROM cliente WHERE email=? OR (rut IS NOT NULL AND rut=?)", [email, b.rut || null]);
  if (existe) return res.status(409).json({ error: "Ya existe un cliente con ese email o RUT" });

  const hash = await bcrypt.hash(b.password, 10);
  const id = await transaction(async (cn) => {
    let vendedor = null;
    if (tipo === 1) { // asigna el vendedor con menos clientes (reparto equitativo de cartera)
      const [[v]] = await cn.query(`SELECT u.id_usuario FROM usuario u JOIN rol r ON r.id_rol=u.id_rol
        LEFT JOIN cliente c ON c.id_vendedor=u.id_usuario WHERE r.nombre='Vendedor' AND u.activo
        GROUP BY u.id_usuario ORDER BY COUNT(c.id_cliente), u.id_usuario LIMIT 1`);
      vendedor = v ? v.id_usuario : null;
    }
    const [r] = await cn.query(`INSERT INTO cliente (id_tipo,id_estado_cliente,id_lista,id_vendedor,rut,nombre,email,telefono,password_hash)
      VALUES (?,?,?,?,?,?,?,?,?)`, [tipo, tipo === 1 ? 1 : 2, LISTA_GENERAL, vendedor, b.rut || null, b.nombre, email, b.telefono || null, hash]);
    await cn.query("INSERT INTO direccion (id_cliente,id_comuna,calle,numero,referencia) VALUES (?,?,?,?,?)",
      [r.insertId, b.id_comuna, b.calle, b.numero || null, b.referencia || null]);
    if (tipo === 1 && vendedor) // el registro B2B entra al pipeline del CRM como Prospecto
      await cn.query("INSERT INTO oportunidad (id_cliente,id_usuario,id_etapa,titulo) VALUES (?,?,1,?)",
        [r.insertId, vendedor, `Registro web B2B: ${b.nombre}`]);
    return r.insertId;
  });
  req.session.cliente = { id_cliente: id };
  res.json({ ok: true, pendiente: tipo === 1 });
}));

// ---------- catálogo ----------
router.get("/comunas", ok(async (req, res) => res.json(await query(
  "SELECT c.id_comuna, c.nombre, r.nombre AS region FROM comuna c JOIN region r ON r.id_region=c.id_region ORDER BY r.id_region, c.nombre"))));

router.get("/categorias", ok(async (req, res) => res.json(await query("SELECT id_categoria, nombre FROM categoria ORDER BY id_categoria"))));

async function listaDe(req) {
  if (!req.session.cliente) return LISTA_GENERAL;
  const [c] = await query("SELECT id_lista FROM cliente WHERE id_cliente=?", [req.session.cliente.id_cliente]);
  return c ? c.id_lista : LISTA_GENERAL;
}

router.get("/productos", ok(async (req, res) => {
  const lista = await listaDe(req);
  const where = ["p.activo"], params = [lista, BODEGA_DESPACHO];
  if (req.query.categoria) { where.push("p.id_categoria=?"); params.push(req.query.categoria); }
  if (req.query.q) { where.push("(p.nombre LIKE ? OR p.sku LIKE ?)"); params.push(`%${req.query.q}%`, `%${req.query.q}%`); }
  if (req.query.temp === "congelado") where.push("p.temp_max < 0");
  if (req.query.temp === "refrigerado") where.push("p.temp_min >= 0");
  res.json(await query(`SELECT p.id_producto, p.sku, p.nombre, p.descripcion, p.unidad, p.temp_min, p.temp_max, cat.nombre AS categoria,
      pp.precio, COALESCE(i.stock_actual,0) AS stock
    FROM producto p JOIN categoria cat ON cat.id_categoria=p.id_categoria
    JOIN precio_producto pp ON pp.id_producto=p.id_producto AND pp.id_lista=?
    LEFT JOIN inventario i ON i.id_producto=p.id_producto AND i.id_bodega=?
    WHERE ${where.join(" AND ")} ORDER BY cat.id_categoria, p.nombre`, params));
}));

// ---------- pedidos ----------
router.get("/mis-direcciones", soloCliente, ok(async (req, res) => res.json(await query(
  `SELECT d.id_direccion, d.calle, d.numero, d.referencia, co.nombre AS comuna FROM direccion d JOIN comuna co ON co.id_comuna=d.id_comuna
   WHERE d.id_cliente=? ORDER BY d.id_direccion`, [req.session.cliente.id_cliente]))));

router.post("/mis-direcciones", soloCliente, ok(async (req, res) => {
  const { id_comuna, calle, numero, referencia } = req.body;
  if (!id_comuna || !calle) return res.status(400).json({ error: "Comuna y calle son obligatorias" });
  const [r] = await require("../db").pool.query("INSERT INTO direccion (id_cliente,id_comuna,calle,numero,referencia) VALUES (?,?,?,?,?)",
    [req.session.cliente.id_cliente, id_comuna, calle, numero || null, referencia || null]);
  res.json({ id_direccion: r.insertId });
}));

// Crea la orden: valida stock, aplica la lista de precios del cliente, descuenta inventario
// y, si es B2B con una oportunidad abierta en el CRM, la marca como Ganada y la vincula al pedido.
router.post("/pedidos", soloCliente, ok(async (req, res) => {
  const idCliente = req.session.cliente.id_cliente;
  const items = (req.body.items || []).map((i) => ({ id: Number(i.id_producto), cant: Number(i.cantidad) })).filter((i) => i.id && i.cant > 0);
  if (!items.length) return res.status(400).json({ error: "El carrito está vacío" });

  const resultado = await transaction(async (cn) => {
    const [[cli]] = await cn.query(`SELECT c.id_cliente, c.id_lista, c.id_tipo, c.id_vendedor, ec.nombre AS estado
      FROM cliente c JOIN estado_cliente ec ON ec.id_estado_cliente=c.id_estado_cliente WHERE c.id_cliente=?`, [idCliente]);
    if (cli.id_tipo === 1 && cli.estado !== "Activo")
      throw Object.assign(new Error("Tu cuenta B2B está pendiente de aprobación por tu ejecutivo comercial"), { status: 403 });
    const [[dir]] = await cn.query("SELECT id_direccion FROM direccion WHERE id_direccion=? AND id_cliente=?", [req.body.id_direccion, idCliente]);
    if (!dir) throw Object.assign(new Error("Selecciona una dirección de despacho válida"), { status: 400 });

    const lineas = [];
    for (const it of items) {
      const [[p]] = await cn.query(`SELECT p.nombre, pp.precio, i.stock_actual FROM producto p
        JOIN precio_producto pp ON pp.id_producto=p.id_producto AND pp.id_lista=?
        JOIN inventario i ON i.id_producto=p.id_producto AND i.id_bodega=? WHERE p.id_producto=? FOR UPDATE`, [cli.id_lista, BODEGA_DESPACHO, it.id]);
      if (!p) throw Object.assign(new Error(`Producto ${it.id} no disponible`), { status: 400 });
      if (p.stock_actual < it.cant) throw Object.assign(new Error(`Stock insuficiente de ${p.nombre} (disponible: ${p.stock_actual})`), { status: 409 });
      lineas.push({ ...it, precio: p.precio });
    }
    const obs = [req.body.orden_compra ? `OC ${req.body.orden_compra}` : null, req.body.observacion || null].filter(Boolean).join(" · ") || null;
    const [r] = await cn.query("INSERT INTO pedido (id_cliente,id_direccion,id_canal,id_estado_pedido,observacion) VALUES (?,?,1,1,?)",
      [idCliente, dir.id_direccion, obs]);
    const idPedido = r.insertId;
    for (const l of lineas) {
      await cn.query("INSERT INTO detalle_pedido (id_pedido,id_producto,cantidad,precio_unitario) VALUES (?,?,?,?)", [idPedido, l.id, l.cant, l.precio]);
      await cn.query("UPDATE inventario SET stock_actual=stock_actual-? WHERE id_bodega=? AND id_producto=?", [l.cant, BODEGA_DESPACHO, l.id]);
    }
    await cn.query(`UPDATE oportunidad SET id_etapa=5, id_pedido=?, fecha_cierre=NOW()
      WHERE id_cliente=? AND id_etapa NOT IN (5,6) AND id_pedido IS NULL ORDER BY fecha_apertura LIMIT 1`, [idPedido, idCliente]);
    const neto = lineas.reduce((s, l) => s + l.cant * l.precio, 0);
    return { id_pedido: idPedido, neto, iva: Math.round(neto * IVA), total: Math.round(neto * (1 + IVA)) };
  }).catch((e) => { if (e.status) { res.status(e.status).json({ error: e.message }); return null; } throw e; });
  if (resultado) res.json(resultado);
}));

router.get("/mis-pedidos", soloCliente, ok(async (req, res) => {
  const pedidos = await query(`SELECT v.id_pedido, v.fecha_pedido, v.estado, v.canal, v.total_neto, v.total_con_iva, p.observacion,
      (SELECT d.camion_id FROM despacho_pedido dp JOIN despacho d ON d.id_despacho=dp.id_despacho WHERE dp.id_pedido=v.id_pedido ORDER BY d.id_despacho DESC LIMIT 1) AS camion_id
    FROM v_pedido_total v JOIN pedido p ON p.id_pedido=v.id_pedido WHERE v.id_cliente=? ORDER BY v.fecha_pedido DESC`, [req.session.cliente.id_cliente]);
  const detalle = pedidos.length ? await query(`SELECT d.id_pedido, pr.nombre, d.cantidad, pr.unidad, d.precio_unitario FROM detalle_pedido d
    JOIN producto pr ON pr.id_producto=d.id_producto WHERE d.id_pedido IN (?)`, [pedidos.map((p) => p.id_pedido)]) : [];
  pedidos.forEach((p) => (p.items = detalle.filter((d) => d.id_pedido === p.id_pedido)));
  res.json(pedidos);
}));

// ---------- asistente IA ----------
router.post("/chat", ok(async (req, res) => {
  const mensaje = String(req.body.mensaje || "").trim().slice(0, 1000);
  if (!mensaje) return res.status(400).json({ error: "Escribe un mensaje" });
  const ia = await clasificar(mensaje);
  let registrado = false;
  if (req.session.cliente) { // con sesión, el requerimiento queda en el CRM (adiós WhatsApp)
    const id = req.session.cliente.id_cliente;
    const [[cat]] = await require("../db").pool.query("SELECT id_categoria_req FROM categoria_requerimiento WHERE nombre=?", [ia.categoria]);
    await query("INSERT INTO requerimiento (id_cliente,id_pedido,id_categoria_req,mensaje,respuesta_ia,prioridad) VALUES (?,?,?,?,?,?)",
      [id, req.body.id_pedido || null, cat ? cat.id_categoria_req : null, mensaje, ia.respuesta, ia.prioridad]);
    await query("INSERT INTO interaccion (id_cliente,id_usuario,id_tipo_interaccion,detalle) VALUES (?,NULL,4,?)",
      [id, `Chat IA [${ia.categoria}]: ${mensaje.slice(0, 200)}`]);
    registrado = true;
  }
  res.json({ ...ia, registrado });
}));

module.exports = router;
