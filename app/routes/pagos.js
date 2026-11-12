// Pasarela de pago Webpay Plus (Transbank) para clientes B2C.
// Por defecto usa el ambiente de integración: credenciales públicas de prueba y tarjetas de prueba, sin dinero real.
// Flujo: iniciar (crea pedido + pago Pendiente) -> formulario de Webpay -> retorno (confirma con Transbank) -> /pago?pedido=N
const express = require("express");
const { WebpayPlus, Options, IntegrationApiKeys, IntegrationCommerceCodes, Environment } = require("transbank-sdk");
const { query, transaction } = require("../db");
const { crearPedido, cancelarPedido, fail } = require("../pedidos");
const router = express.Router();

const PRODUCCION = process.env.WEBPAY_ENV === "produccion";
const webpay = new WebpayPlus.Transaction(PRODUCCION
  ? new Options(process.env.WEBPAY_COMMERCE_CODE, process.env.WEBPAY_API_KEY, Environment.Production)
  : new Options(IntegrationCommerceCodes.WEBPAY_PLUS, IntegrationApiKeys.WEBPAY, Environment.Integration));
const EXPIRA_MIN = 15;   // un pago sin respuesta de Webpay después de este tiempo se anula y el stock vuelve a la bodega

const soloCliente = (req, res, next) => (req.session.cliente ? next() : res.status(401).json({ error: "Debes iniciar sesión" }));
const ok = (fn) => (req, res) => fn(req, res).catch((e) => { console.error(e); res.status(e.status || 500).json({ error: e.message }); });

// 1) Crea el pedido y el pago, y pide a Transbank un token para el formulario de Webpay
router.post("/webpay/iniciar", soloCliente, ok(async (req, res) => {
  const idCliente = req.session.cliente.id_cliente;
  const base = process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`;
  const r = await transaction(async (cn) => {
    const [[cli]] = await cn.query("SELECT id_tipo FROM cliente WHERE id_cliente=?", [idCliente]);
    if (cli.id_tipo !== 2) throw fail(400, "Los clientes B2B compran con orden de compra");
    const pedido = await crearPedido(cn, idCliente, req.body);
    const orden = `P${pedido.id_pedido}-${Date.now().toString(36)}`;   // máx. 26 caracteres
    const [pg] = await cn.query("INSERT INTO pago (id_pedido,monto,orden_compra) VALUES (?,?,?)", [pedido.id_pedido, pedido.total, orden]);
    let tx;
    try {
      tx = await webpay.create(orden, `C${idCliente}`, pedido.total, `${base}/api/pagos/webpay/retorno`);
    } catch (e) {
      console.error("Webpay create:", e.message);
      throw fail(502, "No se pudo conectar con Webpay. Intenta nuevamente en unos minutos.");
    }
    await cn.query("UPDATE pago SET token=? WHERE id_pago=?", [tx.token, pg.insertId]);
    return { id_pedido: pedido.id_pedido, url: tx.url, token: tx.token };
  });
  res.json(r);
}));

// 2) Webpay devuelve al cliente aquí (GET o POST según la versión del API). Casos posibles:
//    token_ws               -> el cliente completó el formulario: se confirma (commit) con Transbank
//    TBK_TOKEN              -> el cliente anuló el pago en el formulario
//    solo TBK_ORDEN_COMPRA  -> se agotó el tiempo del formulario
// No depende de la sesión: la cookie no viaja en el POST que llega desde Transbank.
router.all("/webpay/retorno", express.urlencoded({ extended: false }), async (req, res) => {
  const p = { ...req.query, ...req.body };
  let idPedido = null;
  try {
    if (p.token_ws && !p.TBK_TOKEN) idPedido = await confirmar(p.token_ws);
    else if (p.TBK_TOKEN || p.TBK_ORDEN_COMPRA) idPedido = await anular(p.TBK_TOKEN ? "token" : "orden_compra", p.TBK_TOKEN || p.TBK_ORDEN_COMPRA);
  } catch (e) {
    console.error("Webpay retorno:", e);
  }
  res.redirect(idPedido ? `/pago?pedido=${idPedido}` : "/pago");
});

async function confirmar(token) {
  return transaction(async (cn) => {
    const [[pg]] = await cn.query("SELECT id_pago, id_pedido, estado FROM pago WHERE token=? FOR UPDATE", [token]);
    if (!pg) return null;
    if (pg.estado !== "Pendiente") return pg.id_pedido;   // recarga de página: ya se procesó
    let r;
    try {
      r = await webpay.commit(token);
    } catch (e) {   // si el commit falla (red, token ya usado), se consulta el estado real en Transbank
      console.error("Webpay commit:", e.message);
      r = await webpay.status(token).catch(() => null);
    }
    const aprobado = r && r.status === "AUTHORIZED" && r.response_code === 0;
    await cn.query(`UPDATE pago SET estado=?, codigo_autorizacion=?, tipo_pago=?, cuotas=?, tarjeta_ultimos4=?, fecha_respuesta=NOW()
      WHERE id_pago=?`, [aprobado ? "Aprobado" : "Rechazado", r?.authorization_code || null, r?.payment_type_code || null,
      r?.installments_number ?? null, r?.card_detail?.card_number || null, pg.id_pago]);
    if (aprobado) await cn.query("UPDATE pedido SET id_estado_pedido=2 WHERE id_pedido=? AND id_estado_pedido=1", [pg.id_pedido]);
    else await cancelarPedido(cn, pg.id_pedido);
    return pg.id_pedido;
  });
}

async function anular(campo, valor) {
  return transaction(async (cn) => {
    const [[pg]] = await cn.query(`SELECT id_pago, id_pedido, estado FROM pago WHERE ${campo}=? FOR UPDATE`, [valor]);
    if (!pg) return null;
    if (pg.estado === "Pendiente") {
      await cn.query("UPDATE pago SET estado='Anulado', fecha_respuesta=NOW() WHERE id_pago=?", [pg.id_pago]);
      await cancelarPedido(cn, pg.id_pedido);
    }
    return pg.id_pedido;
  });
}

// 3) Resultado del pago para la página /pago (solo el dueño del pedido)
router.get("/pedido/:id", soloCliente, ok(async (req, res) => {
  const [p] = await query(`SELECT v.id_pedido, v.fecha_pedido, v.estado, v.total_con_iva, pg.estado AS pago_estado, pg.monto,
      pg.codigo_autorizacion, pg.tipo_pago, pg.cuotas, pg.tarjeta_ultimos4, pg.orden_compra, pg.fecha_respuesta
    FROM v_pedido_total v LEFT JOIN pago pg ON pg.id_pago=(SELECT MAX(id_pago) FROM pago WHERE id_pedido=v.id_pedido)
    WHERE v.id_pedido=? AND v.id_cliente=?`, [req.params.id, req.session.cliente.id_cliente]);
  if (!p) return res.status(404).json({ error: "Pedido no encontrado" });
  res.json(p);
}));

// Anula los pagos abandonados (el cliente cerró la pestaña de Webpay) para liberar el stock reservado
async function anularVencidos() {
  try {
    const vencidos = await query("SELECT token FROM pago WHERE estado='Pendiente' AND token IS NOT NULL AND fecha_creacion < NOW() - INTERVAL ? MINUTE", [EXPIRA_MIN]);
    for (const v of vencidos) await anular("token", v.token);
  } catch (e) {
    console.error("Anular pagos vencidos:", e.message);
  }
}
setInterval(anularVencidos, 5 * 60 * 1000).unref();

module.exports = Object.assign(router, { webpay });   // el CRM usa webpay.refund() para los reembolsos
