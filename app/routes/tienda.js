// API pública del E-commerce B2B/B2C (Front-Office)
const express = require("express");
const bcrypt = require("bcryptjs");
const { query, transaction } = require("../db");
const { clasificar } = require("../ai");
const { crearPedido, fail, BODEGA_DESPACHO } = require("../pedidos");
const router = express.Router();

const LISTA_GENERAL = 1;     // General B2C

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

// Compra B2B con orden de compra y crédito a 30 días. Los clientes B2C pagan con Webpay (routes/pagos.js).
router.post("/pedidos", soloCliente, ok(async (req, res) => {
  const resultado = await transaction(async (cn) => {
    const [[cli]] = await cn.query("SELECT id_tipo FROM cliente WHERE id_cliente=?", [req.session.cliente.id_cliente]);
    if (cli.id_tipo !== 1) throw fail(400, "Los clientes B2C pagan su pedido con Webpay");
    return crearPedido(cn, req.session.cliente.id_cliente, req.body);
  }).catch((e) => { if (e.status) { res.status(e.status).json({ error: e.message }); return null; } throw e; });
  if (resultado) res.json(resultado);
}));

router.get("/mis-pedidos", soloCliente, ok(async (req, res) => {
  const pedidos = await query(`SELECT v.id_pedido, v.fecha_pedido, v.estado, v.canal, v.total_neto, v.total_con_iva, p.observacion,
      (SELECT d.camion_id FROM despacho_pedido dp JOIN despacho d ON d.id_despacho=dp.id_despacho WHERE dp.id_pedido=v.id_pedido ORDER BY d.id_despacho DESC LIMIT 1) AS camion_id,
      (SELECT pg.estado FROM pago pg WHERE pg.id_pedido=v.id_pedido ORDER BY pg.id_pago DESC LIMIT 1) AS pago_estado,
      (SELECT pg.tarjeta_ultimos4 FROM pago pg WHERE pg.id_pedido=v.id_pedido ORDER BY pg.id_pago DESC LIMIT 1) AS pago_tarjeta
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
