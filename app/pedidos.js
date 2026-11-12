// Lógica de pedidos compartida por la compra B2B (orden de compra) y el pago B2C con Webpay
const BODEGA_DESPACHO = 1;   // Centro de frío Temuco
const IVA = 0.19;

const fail = (status, msg) => Object.assign(new Error(msg), { status });

// Crea la orden dentro de una transacción: valida stock, aplica la lista de precios del cliente, descuenta inventario
// y, si es B2B con una oportunidad abierta en el CRM, la marca como Ganada y la vincula al pedido.
async function crearPedido(cn, idCliente, body) {
  const items = (body.items || []).map((i) => ({ id: Number(i.id_producto), cant: Number(i.cantidad) })).filter((i) => i.id && i.cant > 0);
  if (!items.length) throw fail(400, "El carrito está vacío");

  const [[cli]] = await cn.query(`SELECT c.id_cliente, c.id_lista, c.id_tipo, c.id_vendedor, ec.nombre AS estado
    FROM cliente c JOIN estado_cliente ec ON ec.id_estado_cliente=c.id_estado_cliente WHERE c.id_cliente=?`, [idCliente]);
  if (cli.id_tipo === 1 && cli.estado !== "Activo") throw fail(403, "Tu cuenta B2B está pendiente de aprobación por tu ejecutivo comercial");
  const [[dir]] = await cn.query("SELECT id_direccion FROM direccion WHERE id_direccion=? AND id_cliente=?", [body.id_direccion, idCliente]);
  if (!dir) throw fail(400, "Selecciona una dirección de despacho válida");

  const lineas = [];
  for (const it of items) {
    const [[p]] = await cn.query(`SELECT p.nombre, pp.precio, i.stock_actual FROM producto p
      JOIN precio_producto pp ON pp.id_producto=p.id_producto AND pp.id_lista=?
      JOIN inventario i ON i.id_producto=p.id_producto AND i.id_bodega=? WHERE p.id_producto=? FOR UPDATE`, [cli.id_lista, BODEGA_DESPACHO, it.id]);
    if (!p) throw fail(400, `Producto ${it.id} no disponible`);
    if (p.stock_actual < it.cant) throw fail(409, `Stock insuficiente de ${p.nombre} (disponible: ${p.stock_actual})`);
    lineas.push({ ...it, precio: p.precio });
  }
  const obs = [body.orden_compra ? `OC ${body.orden_compra}` : null, body.observacion || null].filter(Boolean).join(" · ") || null;
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
  return { id_pedido: idPedido, tipo: cli.id_tipo === 1 ? "B2B" : "B2C", neto, iva: Math.round(neto * IVA), total: Math.round(neto * (1 + IVA)) };
}

// Cancela un pedido y devuelve su stock a la bodega (solo si no estaba cancelado)
async function cancelarPedido(cn, idPedido) {
  const [[p]] = await cn.query("SELECT id_estado_pedido FROM pedido WHERE id_pedido=? FOR UPDATE", [idPedido]);
  if (!p || p.id_estado_pedido === 6) return;
  await cn.query(`UPDATE inventario i JOIN detalle_pedido d ON d.id_producto=i.id_producto
    SET i.stock_actual=i.stock_actual+d.cantidad WHERE d.id_pedido=? AND i.id_bodega=?`, [idPedido, BODEGA_DESPACHO]);
  await cn.query("UPDATE pedido SET id_estado_pedido=6 WHERE id_pedido=?", [idPedido]);
}

module.exports = { crearPedido, cancelarPedido, fail, BODEGA_DESPACHO };
