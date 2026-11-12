// CRM operativo de Cofrial: BI, clientes, pipeline, pedidos, requerimientos IA y flota IoT
const $ = (id) => document.getElementById(id);
const COLOR_ESTADO = { "Pendiente": "secondary", "Confirmado": "info", "En preparación": "warning", "En ruta": "primary", "Entregado": "success", "Cancelado": "danger" };
let CAT = null, VISTA = "panel", TIMER = null, CHARTS = {}, MAPA = null, MARCAS = {};

// ---------- sesión ----------
async function iniciar() {
  const u = await api("/api/crm/me");
  if (!u) { $("v-login").style.display = "block"; $("v-app").style.display = "none"; return; }
  $("v-login").style.display = "none"; $("v-app").style.display = "block";
  $("usuario").textContent = `${u.nombre} · ${u.rol}`;
  CAT = await api("/api/crm/catalogos");
  CAT.estados.forEach((e) => $("p-estado-f").insertAdjacentHTML("beforeend", `<option>${esc(e.nombre)}</option>`));
  $("ruta-camion").innerHTML = CAT.camiones.map((c) => `<option value="${c.id}">${c.id} · ${esc(c.patente)} (${c.temp_min} a ${c.temp_max} °C)</option>`).join("");
  $("ruta-conductor").innerHTML = CAT.conductores.map((c) => `<option value="${c.id}">${esc(c.nombre)}</option>`).join("");
  $("sel-camion").innerHTML = CAT.camiones.map((c) => `<option>${c.id}</option>`).join("");
  mostrar(location.hash.slice(1) || "panel");
}
$("f-login").onsubmit = async (e) => {
  e.preventDefault();
  try { await api("/api/crm/login", { method: "POST", body: Object.fromEntries(new FormData(e.target)) }); iniciar(); }
  catch (err) { $("login-error").textContent = err.message; }
};
$("salir").onclick = async (e) => { e.preventDefault(); await api("/api/crm/logout", { method: "POST" }); location.reload(); };

// ---------- navegación ----------
document.querySelectorAll("#menu .nav-link").forEach((a) => (a.onclick = () => mostrar(a.dataset.v)));
function mostrar(v) {
  VISTA = v; location.hash = v;
  document.querySelectorAll("#menu .nav-link").forEach((a) => a.classList.toggle("active", a.dataset.v === v));
  document.querySelectorAll("main > section").forEach((s) => (s.style.display = s.id === "s-" + v ? "block" : "none"));
  clearInterval(TIMER);
  const acciones = { panel: [cargarPanel, 10000], clientes: [cargarClientes], pipeline: [cargarPipeline], pedidos: [cargarPedidos, 15000], requerimientos: [cargarReq, 15000], flota: [cargarFlota, 5000] };
  const [fn, ms] = acciones[v] || acciones.panel;
  fn();
  if (ms) TIMER = setInterval(fn, ms);
}

function grafico(id, config) {
  if (CHARTS[id]) { CHARTS[id].data = config.data; CHARTS[id].update("none"); return; }
  CHARTS[id] = new Chart($(id), config);
}

// ---------- Panel BI ----------
async function cargarPanel() {
  const d = await api("/api/crm/bi"), k = d.kpi;
  const kpis = [["Ventas netas 14 días", CLP(k.ventas_14d)], ["Pedidos hoy", k.pedidos_hoy], ["Pedidos por despachar", k.pedidos_pendientes],
    ["% pedidos por web (14 d)", (k.pct_web ?? 0) + "%"], ["Alertas de frío (1 h)", k.alertas_1h, k.alertas_1h > 0], ["Lecturas IoT (5 min)", k.lecturas_5min]];
  const tile = ([t, v, alerta]) => `<div class="col-6 col-md-4 col-xl"><div class="card kpi ${alerta ? "alerta" : ""}"><div class="card-body py-2">
    <div class="small text-muted">${t}</div><div class="v">${v}</div></div></div></div>`;
  $("kpis").innerHTML = kpis.map(tile).join("");
  const cs = d.casos;
  $("kpis-casos").innerHTML = [["Casos abiertos", cs.abiertos ?? 0, cs.abiertos > 0], ["Casos vencidos", cs.vencidos ?? 0, cs.vencidos > 0],
    ["Tiempo prom. de resolución", cs.horas_promedio != null ? cs.horas_promedio + " h" : "—"], ["% resueltos en plazo", cs.pct_en_plazo != null ? cs.pct_en_plazo + "%" : "—"],
    ["Satisfacción", cs.satisfaccion != null ? `${cs.satisfaccion} ⭐ <span class="small text-muted">(${cs.encuestas})</span>` : "—"]].map(tile).join("");
  grafico("c-casos", { type: "bar", data: { labels: d.casosCategoria.map((r) => r.categoria), datasets: [
      { label: "Abiertos", data: d.casosCategoria.map((r) => r.abiertos), backgroundColor: "#c62828" },
      { label: "Resueltos", data: d.casosCategoria.map((r) => r.resueltos), backgroundColor: "#4caf50" }] },
    options: { indexAxis: "y", scales: { x: { stacked: true, ticks: { precision: 0 } }, y: { stacked: true } } } });
  grafico("c-cruce", { type: "bar", data: { labels: d.cruce.map((r) => r.dia.slice(5)), datasets: [
      { type: "bar", label: "Ventas netas ($)", data: d.cruce.map((r) => r.ventas_netas), backgroundColor: "#1f8ac0", yAxisID: "y" },
      { type: "line", label: "Alertas de frío", data: d.cruce.map((r) => r.alertas_frio), borderColor: "#c62828", backgroundColor: "#c62828", yAxisID: "y1", tension: .3 }] },
    options: { scales: { y: { position: "left", ticks: { callback: (v) => CLP(v) } }, y1: { position: "right", grid: { drawOnChartArea: false }, beginAtZero: true } } } });
  grafico("c-canal", { type: "doughnut", data: { labels: d.canal.map((r) => r.canal), datasets: [{ data: d.canal.map((r) => r.ventas), backgroundColor: ["#1f8ac0", "#12355b", "#90a4ae"] }] } });
  grafico("c-tipo", { type: "bar", data: { labels: d.tipo.map((r) => r.tipo_cliente), datasets: [{ label: "Ventas netas", data: d.tipo.map((r) => r.ventas), backgroundColor: ["#12355b", "#4caf50"] }] },
    options: { plugins: { legend: { display: false } }, scales: { y: { ticks: { callback: (v) => CLP(v) } } } } });
  grafico("c-pipe", { type: "bar", data: { labels: d.pipeline.map((r) => r.etapa), datasets: [{ label: "Monto", data: d.pipeline.map((r) => r.monto), backgroundColor: "#ad1457" }] },
    options: { indexAxis: "y", plugins: { legend: { display: false } }, scales: { x: { ticks: { callback: (v) => CLP(v) } } } } });
  grafico("c-alertas", { type: "bar", data: { labels: d.alertasCamion.map((r) => r.camion_id), datasets: [{ label: "Alertas", data: d.alertasCamion.map((r) => r.alertas), backgroundColor: "#c62828" }] },
    options: { plugins: { legend: { display: false } } } });
  $("bi-hora").textContent = new Date().toLocaleTimeString("es-CL");
}

// ---------- Clientes ----------
async function cargarClientes() {
  const p = new URLSearchParams({ q: $("c-q").value, tipo: $("c-tipo-f").value, estado: $("c-estado-f").value });
  const rows = await api("/api/crm/clientes?" + p);
  $("t-clientes").innerHTML = rows.map((c) => `<tr>
    <td><b>${esc(c.nombre)}</b><div class="small text-muted">${esc(c.email)} ${c.rut ? "· " + esc(c.rut) : ""}</div></td>
    <td>${c.tipo}</td><td><span class="badge bg-${c.estado === "Activo" ? "success" : c.estado === "Prospecto" ? "warning text-dark" : "secondary"}">${c.estado}</span></td>
    <td class="small">${esc(c.lista)}</td><td class="small">${esc(c.vendedor || "—")}</td><td class="text-end">${c.pedidos}</td><td class="text-end">${CLP(c.compras_netas)}</td>
    <td class="text-end"><button class="btn btn-sm btn-outline-primary" onclick="ficha(${c.id_cliente})">Ficha</button></td></tr>`).join("");
}
["c-tipo-f", "c-estado-f"].forEach((id) => ($(id).onchange = cargarClientes));
$("c-q").oninput = () => { clearTimeout(window._q); window._q = setTimeout(cargarClientes, 300); };

async function ficha(id) {
  const f = await api("/api/crm/clientes/" + id), c = f.cliente;
  $("ficha-titulo").textContent = `${c.nombre} · ${c.tipo} · ${c.estado}`;
  const aprobar = c.tipo === "B2B" && c.estado === "Prospecto"
    ? `<div class="alert alert-warning d-flex gap-2 align-items-center flex-wrap">Cuenta B2B pendiente. Asignar lista:
        <select id="ap-lista" class="form-select form-select-sm w-auto">${CAT.listas.map((l) => `<option value="${l.id}">${esc(l.nombre)}</option>`).join("")}</select>
        <button class="btn btn-sm btn-success" onclick="aprobar(${c.id_cliente})">Aprobar cuenta</button></div>` : "";
  $("ficha-cuerpo").innerHTML = `${aprobar}
    <div class="row g-3">
      <div class="col-md-4"><h6 class="fw-bold">Datos</h6><div class="small">RUT: ${esc(c.rut || "—")}<br>Email: ${esc(c.email)}<br>Teléfono: ${esc(c.telefono || "—")}<br>
        Lista: ${esc(c.lista)}<br>Vendedor: ${esc(c.vendedor || "—")}<br>Alta: ${esc(c.fecha_registro)}</div>
        <h6 class="fw-bold mt-3">Direcciones</h6><ul class="small">${f.direcciones.map((d) => `<li>${esc(d.calle)} ${esc(d.numero || "")}, ${esc(d.comuna)}</li>`).join("") || "<li>—</li>"}</ul>
        <h6 class="fw-bold mt-3">Oportunidades</h6><ul class="small">${f.oportunidades.map((o) => `<li>${esc(o.titulo)} · <b>${esc(o.etapa)}</b> ${o.monto_estimado ? "· " + CLP(o.monto_estimado) : ""}</li>`).join("") || "<li>—</li>"}</ul></div>
      <div class="col-md-4"><h6 class="fw-bold">Pedidos</h6><ul class="small">${f.pedidos.map((p) => `<li>N° ${p.id_pedido} · ${esc(p.fecha_pedido.slice(0, 10))} · ${esc(p.estado)} · ${CLP(p.total_neto)}</li>`).join("") || "<li>Sin pedidos</li>"}</ul>
        <h6 class="fw-bold mt-3">Casos de atención</h6><ul class="small">${f.requerimientos.map((r) => `<li><a href="#" onclick="bootstrap.Modal.getInstance($('m-ficha')).hide();gestionar(${r.id_requerimiento});return false">N° ${r.id_requerimiento}</a>
          [${esc(r.categoria || "—")}] ${esc(r.mensaje)} <span class="badge bg-${COLOR_CASO[r.estado]}">${esc(r.estado)}</span></li>`).join("") || "<li>—</li>"}</ul></div>
      <div class="col-md-4"><h6 class="fw-bold">Interacciones</h6>
        <form class="mb-2" onsubmit="interaccion(event, ${c.id_cliente})"><div class="input-group input-group-sm">
          <select name="id_tipo_interaccion" class="form-select" style="max-width:110px">${CAT.tipos.map((t) => `<option value="${t.id}">${esc(t.nombre)}</option>`).join("")}</select>
          <input name="detalle" class="form-control" placeholder="Registrar contacto" required><button class="btn btn-primary">+</button></div></form>
        <ul class="small">${f.interacciones.map((i) => `<li><b>${esc(i.tipo)}</b> ${esc(i.fecha.slice(0, 16))} · ${esc(i.detalle || "")} <span class="text-muted">${esc(i.usuario || "")}</span></li>`).join("") || "<li>—</li>"}</ul></div>
    </div>`;
  bootstrap.Modal.getOrCreateInstance($("m-ficha")).show();
}
async function aprobar(id) { await api(`/api/crm/clientes/${id}/aprobar`, { method: "POST", body: { id_lista: $("ap-lista").value } }); ficha(id); cargarClientes(); }
async function interaccion(e, id) { e.preventDefault(); await api(`/api/crm/clientes/${id}/interacciones`, { method: "POST", body: Object.fromEntries(new FormData(e.target)) }); ficha(id); }
$("btn-nuevo").onclick = () => bootstrap.Modal.getOrCreateInstance($("m-nuevo")).show();
$("f-nuevo").onsubmit = async (e) => {
  e.preventDefault();
  try { await api("/api/crm/clientes", { method: "POST", body: Object.fromEntries(new FormData(e.target)) });
    bootstrap.Modal.getInstance($("m-nuevo")).hide(); e.target.reset(); aviso("Prospecto creado y agregado al pipeline."); cargarClientes(); }
  catch (err) { alert(err.message); }
};

// ---------- Pipeline (Kanban con arrastrar y soltar) ----------
async function cargarPipeline() {
  const ops = await api("/api/crm/pipeline");
  let pond = 0;
  $("kanban").innerHTML = CAT.etapas.map((e) => {
    const items = ops.filter((o) => o.id_etapa === e.id);
    items.forEach((o) => (pond += (o.monto_estimado || 0) * e.probabilidad_pct / 100));
    return `<div class="col"><div class="kanban-col" data-etapa="${e.id}" ondragover="event.preventDefault();this.classList.add('drop')" ondragleave="this.classList.remove('drop')" ondrop="soltar(event, ${e.id})">
      <div class="fw-bold small mb-2">${esc(e.nombre)} · ${e.probabilidad_pct}% <span class="badge bg-light text-dark">${items.length}</span></div>
      ${items.map((o) => `<div class="kanban-card" draggable="true" ondragstart="event.dataTransfer.setData('id', ${o.id_oportunidad})">
        <div class="fw-bold small">${esc(o.cliente)}</div><div class="small">${esc(o.titulo)}</div>
        <div class="small text-muted">${o.monto_estimado ? CLP(o.monto_estimado) : "Sin monto"} · ${esc(o.vendedor)}</div>
        ${o.id_pedido ? `<div class="small text-success">Pedido N° ${o.id_pedido}</div>` : ""}</div>`).join("")}
    </div></div>`;
  }).join("");
  $("ponderado").textContent = CLP(pond);
}
async function soltar(ev, etapa) {
  ev.preventDefault();
  await api("/api/crm/oportunidades/" + ev.dataTransfer.getData("id"), { method: "PATCH", body: { id_etapa: etapa } });
  cargarPipeline();
}

// ---------- Pedidos ----------
let PEDIDO_RUTA = null;
const COLOR_PAGO = { "Aprobado": "success", "Pendiente": "warning text-dark", "Rechazado": "danger", "Anulado": "secondary", "Reembolsado": "info" };
// B2C: estado del pago Webpay (con tarjeta y autorización). B2B: orden de compra / crédito, sin pasarela.
const pagoCRM = (p) => p.pago_estado
  ? `<span class="badge bg-${COLOR_PAGO[p.pago_estado]}" title="${p.pago_autorizacion ? "Autorización " + esc(p.pago_autorizacion) : ""}">${esc(p.pago_estado)}</span>`
    + (p.pago_tarjeta ? `<div class="text-muted">Webpay **** ${esc(p.pago_tarjeta)}</div>` : "")
  : `<span class="text-muted">${p.tipo_cliente === "B2B" ? "Crédito B2B" : "—"}</span>`;
async function cargarPedidos() {
  const est = $("p-estado-f").value;
  const rows = await api("/api/crm/pedidos" + (est ? "?estado=" + encodeURIComponent(est) : ""));
  $("t-pedidos").innerHTML = rows.map((p) => `<tr>
    <td><b>${p.id_pedido}</b></td><td>${esc(p.fecha_pedido.slice(0, 16))}</td><td>${esc(p.cliente)}<div class="text-muted">${esc(p.observacion || "")}</div></td>
    <td>${p.tipo_cliente}</td><td>${esc(p.canal)}</td><td>${esc(p.comuna)}</td><td class="text-end">${CLP(p.total_neto)}</td><td>${pagoCRM(p)}</td><td>${p.camion_id ? "🚚 " + p.camion_id : "—"}</td>
    <td><select class="form-select form-select-sm border-${COLOR_ESTADO[p.estado]}" onchange="cambiarEstado(${p.id_pedido}, this.value, this)">
      ${CAT.estados.map((e) => `<option value="${e.id}" ${e.nombre === p.estado ? "selected" : ""}>${esc(e.nombre)}</option>`).join("")}</select></td></tr>`).join("");
}
$("p-estado-f").onchange = cargarPedidos;
async function cambiarEstado(id, estado, sel) {
  if (Number(estado) === 4) { PEDIDO_RUTA = id; bootstrap.Modal.getOrCreateInstance($("m-ruta")).show(); return; }
  try { await api(`/api/crm/pedidos/${id}/estado`, { method: "PATCH", body: { id_estado_pedido: estado } }); } catch (e) { alert(e.message); }
  cargarPedidos();
}
$("f-ruta").onsubmit = async (e) => {
  e.preventDefault();
  try {
    await api(`/api/crm/pedidos/${PEDIDO_RUTA}/estado`, { method: "PATCH", body: { id_estado_pedido: 4, ...Object.fromEntries(new FormData(e.target)) } });
    bootstrap.Modal.getInstance($("m-ruta")).hide();
  } catch (err) { alert(err.message); }
  cargarPedidos();
};
$("m-ruta").addEventListener("hidden.bs.modal", cargarPedidos);

// ---------- Casos de clientes (requerimientos IA con plazo, evidencia IoT y resolución) ----------
const PRIORIDAD = { 1: ["Alta", "danger"], 2: ["Media", "warning text-dark"], 3: ["Baja", "secondary"] };
const COLOR_CASO = { "Nuevo": "primary", "En gestión": "warning text-dark", "Resuelto": "success" };
const badgePrioridad = (p) => { const [t, c] = PRIORIDAD[p] || PRIORIDAD[3]; return `<span class="badge bg-${c}">${t}</span>`; };
const duracion = (m) => m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${Math.floor(m / 1440)} d ${Math.floor((m % 1440) / 60)} h`;
function plazo(r) {
  if (r.estado === "Resuelto") return r.en_plazo
    ? `<span class="text-success">✔ En plazo</span><div class="text-muted">${r.horas_resolucion} h</div>`
    : `<span class="text-danger">Fuera de plazo</span><div class="text-muted">${r.horas_resolucion} h</div>`;
  const m = r.minutos_restantes;
  return m >= 0 ? `<span class="${m < 60 ? "text-warning fw-bold" : ""}">⏱ quedan ${duracion(m)}</span>` : `<span class="text-danger fw-bold">⚠ vencido hace ${duracion(-m)}</span>`;
}
let CASO = null, EVID_CHART = null;

async function cargarReq() {
  const rows = await api("/api/crm/requerimientos?estado=" + $("r-estado-f").value);
  $("t-req").innerHTML = rows.map((r) => `<tr class="${r.estado !== "Resuelto" && (r.prioridad === 1 || r.minutos_restantes < 0) ? "fila-alerta" : ""}">
    <td><b>${r.id_requerimiento}</b></td><td>${esc(r.fecha.slice(0, 16))}</td>
    <td><a href="#" onclick="ficha(${r.id_cliente});return false">${esc(r.cliente)}</a> <span class="text-muted">${r.tipo_cliente}</span><div class="text-muted">${esc(r.ejecutivo || "Sin asignar")}</div></td>
    <td>${r.id_pedido ? "N° " + r.id_pedido : "—"}</td><td><b>${esc(r.categoria || "—")}</b></td><td>${badgePrioridad(r.prioridad)}</td>
    <td>${plazo(r)}</td><td><span class="badge bg-${COLOR_CASO[r.estado]}">${esc(r.estado)}</span>${r.solucion ? `<div class="text-muted">${esc(r.solucion)}</div>` : ""}
      ${r.calificacion ? `<div>${"⭐".repeat(r.calificacion)}</div>` : ""}</td>
    <td style="max-width:280px">${esc(r.mensaje)}</td>
    <td><button class="btn btn-sm ${r.estado === "Resuelto" ? "btn-outline-secondary" : "btn-primary"}" onclick="gestionar(${r.id_requerimiento})">${r.estado === "Resuelto" ? "Ver" : "Gestionar"}</button></td></tr>`).join("")
    || `<tr><td colspan="10" class="text-muted p-3">Sin casos en esta vista. Prueba el chat de la tienda con una sesión de cliente.</td></tr>`;
}
$("r-estado-f").onchange = cargarReq;

async function gestionar(id) {
  const d = await api("/api/crm/requerimientos/" + id), c = d.caso;
  CASO = d;
  const abierto = c.estado !== "Resuelto";
  $("caso-titulo").innerHTML = `Caso N° ${c.id_requerimiento} · ${esc(c.cliente)} <span class="badge bg-light text-dark">${c.tipo_cliente}</span>
    <span class="badge bg-${COLOR_CASO[c.estado]}">${esc(c.estado)}</span>`;
  const ped = d.pedido;
  $("caso-cuerpo").innerHTML = `<div class="row g-3">
    <div class="col-lg-5">
      <div class="card border-0 bg-light mb-3"><div class="card-body small">
        <div class="text-muted mb-1">${esc(c.fecha.slice(0, 16))} · vía chat de la tienda</div>
        <blockquote class="fs-6 mb-2">“${esc(c.mensaje)}”</blockquote>
        <div class="text-muted mb-2">🤖 IA: ${esc(c.respuesta_ia || "—")}</div>
        <div class="d-flex flex-wrap gap-2 align-items-center"><b>${esc(c.categoria || "Sin categoría")}</b> ${badgePrioridad(c.prioridad)} · ${plazo(c)}</div>
        <div class="mt-1">Ejecutivo: <b>${esc(c.gestor || c.vendedor || "Sin asignar")}</b>${!c.gestor && c.vendedor ? " (vendedor del cliente)" : ""}</div>
      </div></div>
      ${abierto ? `<div class="card border-0 shadow-sm mb-3"><div class="card-body small">
        <h6 class="fw-bold">Clasificación</h6>
        <div class="d-flex gap-2 mb-2">
          <select id="cs-cat" class="form-select form-select-sm">${CAT.categoriasReq.map((x) => `<option value="${x.id}" ${x.nombre === c.categoria ? "selected" : ""}>${esc(x.nombre)}</option>`).join("")}</select>
          <select id="cs-pri" class="form-select form-select-sm" style="max-width:110px">${[1, 2, 3].map((p) => `<option value="${p}" ${p === c.prioridad ? "selected" : ""}>${PRIORIDAD[p][0]}</option>`).join("")}</select>
          <button class="btn btn-sm btn-outline-primary" onclick="accionCaso('reclasificar')">Corregir</button></div>
        <div class="text-muted">Si la IA se equivocó, corrige la categoría o la prioridad: el plazo se recalcula.</div>
        ${c.estado === "Nuevo" ? `<button class="btn btn-sm btn-warning mt-2" onclick="accionCaso('tomar')">🙋 Tomar caso (pasa a En gestión)</button>` : ""}
      </div></div>` : ""}
      ${ped ? `<div class="card border-0 shadow-sm mb-3"><div class="card-body small">
        <h6 class="fw-bold">Pedido N° ${ped.id_pedido} <span class="badge bg-${COLOR_ESTADO[ped.estado]}">${esc(ped.estado)}</span></h6>
        <div class="text-muted">${esc(ped.fecha_pedido.slice(0, 16))} · canal ${esc(ped.canal)} · total ${CLP(ped.total_con_iva)}</div>
        <ul class="mt-2 mb-2">${d.items.map((i) => `<li>${i.cantidad} ${esc(i.unidad)} · ${esc(i.nombre)} (${CLP(i.precio_unitario)})</li>`).join("")}</ul>
        ${d.pago ? `<div>💳 Pago ${esc(d.pago.estado.toLowerCase())} ${CLP(d.pago.monto)}${d.pago.tarjeta_ultimos4 ? " · Webpay **** " + esc(d.pago.tarjeta_ultimos4) : ""}</div>`
          : `<div class="text-muted">${c.tipo_cliente === "B2B" ? "Compra B2B con orden de compra / crédito" : "Sin pago registrado"}</div>`}
      </div></div>`
      : abierto ? `<div class="card border-0 shadow-sm mb-3"><div class="card-body small">
        <h6 class="fw-bold">Pedido afectado</h6><p class="text-muted mb-2">El cliente no indicó el pedido. Vincúlalo para ver la evidencia del despacho y poder reponer o reembolsar.</p>
        <div class="d-flex gap-2"><select id="cs-ped" class="form-select form-select-sm">${d.pedidosCliente.map((p) =>
          `<option value="${p.id_pedido}">N° ${p.id_pedido} · ${esc(p.fecha_pedido.slice(0, 10))} · ${esc(p.estado)} · ${CLP(p.total_con_iva)}</option>`).join("") || "<option value=''>El cliente no tiene pedidos</option>"}</select>
          <button class="btn btn-sm btn-outline-primary" onclick="accionCaso('vincular')" ${d.pedidosCliente.length ? "" : "disabled"}>Vincular</button></div>
      </div></div>` : ""}
    </div>
    <div class="col-lg-7">
      ${evidenciaHTML(d)}
      ${abierto ? resolverHTML(d) : resolucionHTML(c)}
    </div></div>`;
  if (d.evidencia) graficoEvidencia(d);
  if (abierto) cambiarSolucion();
  bootstrap.Modal.getOrCreateInstance($("m-caso")).show();
}

function evidenciaHTML(d) {
  const t = `<h6 class="fw-bold">🚚 Evidencia IoT del despacho</h6>`;
  if (!d.pedido) return `<div class="card border-0 shadow-sm mb-3"><div class="card-body small">${t}<p class="text-muted mb-0">Sin pedido vinculado.</p></div></div>`;
  if (!d.despacho) return `<div class="card border-0 shadow-sm mb-3"><div class="card-body small">${t}<p class="text-muted mb-0">El pedido aún no ha sido despachado: no hay telemetría asociada.</p></div></div>`;
  const s = d.despacho, e = d.evidencia;
  const veredicto = e.lecturas === 0 ? `<div class="alert alert-secondary py-2 mb-2">No hay lecturas del camión en ese período.</div>`
    : e.alertas > 0 ? `<div class="alert alert-danger py-2 mb-2">⚠ Se registraron <b>${e.alertas} alertas de ruptura de frío</b> durante el despacho (máx. ${e.temp_max_obs} °C, rango ${s.temp_min} a ${s.temp_max} °C). <b>El reclamo tiene respaldo.</b></div>`
    : `<div class="alert alert-success py-2 mb-2">✔ La cadena de frío se mantuvo dentro de rango durante todo el despacho (${e.temp_min_obs} a ${e.temp_max_obs} °C). Revisa otras causas: manipulación o almacenamiento del cliente.</div>`;
  return `<div class="card border-0 shadow-sm mb-3"><div class="card-body small">${t}
    <div class="mb-2"><b>${esc(s.camion_id)}</b> (${esc(s.patente)}) · ${esc(s.conductor)} · rango ${s.temp_min} a ${s.temp_max} °C<br>
      Salida ${esc(s.fecha_salida.slice(0, 16))} → ${s.fecha_entrega ? "entrega " + esc(s.fecha_entrega.slice(0, 16)) : "<b>en ruta</b>"} · ${e.lecturas} lecturas · promedio ${e.temp_prom ?? "—"} °C</div>
    ${veredicto}
    <canvas id="c-evid" height="110"></canvas>
    ${e.lista_alertas.length ? `<div class="mt-2 text-danger">Alertas: ${e.lista_alertas.map((a) => `${esc(a.fecha_hora.slice(5, 16))} (${a.temp_camara} °C)`).join(" · ")}</div>` : ""}
  </div></div>`;
}

function graficoEvidencia(d) {
  if (EVID_CHART) EVID_CHART.destroy();
  const s = d.despacho, serie = d.evidencia.serie, lab = serie.map((x) => x.t.slice(5, 16));
  EVID_CHART = new Chart($("c-evid"), { type: "line", data: { labels: lab, datasets: [
    { label: "Temperatura (°C)", data: serie.map((x) => x.temp), borderColor: "#1f8ac0", tension: .3,
      pointBackgroundColor: serie.map((x) => (x.alerta ? "#c62828" : "#1f8ac0")), pointRadius: serie.map((x) => (x.alerta ? 4 : 1)) },
    { label: "Máx. permitido", data: lab.map(() => s.temp_max), borderColor: "#c62828", borderDash: [5, 5], pointRadius: 0 },
    { label: "Mín. permitido", data: lab.map(() => s.temp_min), borderColor: "#90a4ae", borderDash: [5, 5], pointRadius: 0 }] },
    options: { plugins: { legend: { labels: { boxWidth: 12 } } }, scales: { x: { ticks: { maxTicksLimit: 8 } } } } });
}

function resolverHTML(d) {
  const pago = d.pago, reembolsable = pago && pago.estado === "Aprobado" && pago.reembolsable && pago.saldo_reembolsable > 0;
  const disp = { 1: !!d.pedido, 2: !!reembolsable, 3: true, 4: true };
  const ayuda = { 1: d.pedido ? "Crea un pedido sin costo con los productos afectados" : "Requiere vincular un pedido",
    2: reembolsable ? `Devuelve el dinero con Transbank (máx. ${CLP(pago.saldo_reembolsable)})` : "Solo para pedidos pagados con Webpay",
    3: "Monto a favor del cliente para su próxima compra o factura", 4: "Responder sin compensación (consultas)" };
  const def = disp[1] ? 1 : 4;
  return `<form class="card border-0 shadow-sm" onsubmit="resolverCaso(event)"><div class="card-body small">
    <h6 class="fw-bold">✅ Resolver caso</h6>
    <div class="row g-2 mb-2">${CAT.soluciones.map((x) => `<div class="col-sm-6"><label class="border rounded p-2 d-block h-100 ${disp[x.id] ? "" : "opacity-50"}">
      <input type="radio" name="id_solucion" value="${x.id}" ${x.id === def ? "checked" : ""} ${disp[x.id] ? "" : "disabled"} onchange="cambiarSolucion()">
      <b>${esc(x.nombre)}</b><div class="text-muted">${ayuda[x.id]}</div></label></div>`).join("")}</div>
    <div id="sol-1" class="mb-2">${d.items.map((i) => `<div class="d-flex align-items-center gap-2 mb-1">
      <input type="number" class="form-control form-control-sm rep-cant" style="max-width:90px" min="0" max="${i.cantidad}" value="${i.cantidad}" data-id="${i.id_producto}">
      <span>${esc(i.unidad)} · ${esc(i.nombre)} <span class="text-muted">(máx. ${i.cantidad})</span></span></div>`).join("")}</div>
    <div id="sol-monto" class="mb-2"><label class="form-label fw-bold mb-1">Monto ($)</label>
      <input type="number" id="sol-monto-v" class="form-control form-control-sm" min="1" style="max-width:200px"></div>
    <label class="form-label fw-bold mb-1">Mensaje para el cliente <span class="text-muted fw-normal">(lo verá en "Mis casos")</span></label>
    <textarea id="sol-msg" class="form-control form-control-sm mb-2" rows="3" required minlength="10" oninput="this.dataset.editado=1"></textarea>
    <button class="btn btn-success">Resolver y notificar al cliente</button>
  </div></form>`;
}

function cambiarSolucion() {
  const d = CASO, sol = Number(document.querySelector("input[name=id_solucion]:checked").value);
  const nombre = d.caso.cliente.split(" ")[0];
  $("sol-1").style.display = sol === 1 ? "block" : "none";
  $("sol-monto").style.display = sol === 2 || sol === 3 ? "block" : "none";
  if (sol === 2) $("sol-monto-v").value = d.pago.saldo_reembolsable;
  if (sol === 3 && d.pedido && !$("sol-monto-v").value) $("sol-monto-v").value = d.pedido.total_con_iva;
  const plantilla = {
    1: `Hola ${nombre}, revisamos tu caso y te enviaremos sin costo los productos afectados en el próximo despacho. Disculpa las molestias.`,
    2: `Hola ${nombre}, realizamos el reembolso a tu tarjeta. Según tu banco, puede tardar algunos días hábiles en verse reflejado. Disculpa las molestias.`,
    3: `Hola ${nombre}, emitimos una nota de crédito a tu favor que se descontará de tu próxima compra. Disculpa las molestias.`,
    4: `Hola ${nombre}, `,
  }[sol];
  if (!$("sol-msg").dataset.editado) $("sol-msg").value = plantilla;
}

async function accionCaso(accion) {
  const body = { accion };
  if (accion === "reclasificar") Object.assign(body, { id_categoria_req: $("cs-cat").value, prioridad: Number($("cs-pri").value) });
  if (accion === "vincular") body.id_pedido = $("cs-ped").value;
  try { await api("/api/crm/requerimientos/" + CASO.caso.id_requerimiento, { method: "PATCH", body }); }
  catch (e) { return alert(e.message); }
  gestionar(CASO.caso.id_requerimiento);
  cargarReq();
}

async function resolverCaso(ev) {
  ev.preventDefault();
  const sol = Number(document.querySelector("input[name=id_solucion]:checked").value);
  const body = { id_solucion: sol, mensaje: $("sol-msg").value, monto: $("sol-monto-v").value,
    items: [...document.querySelectorAll(".rep-cant")].map((i) => ({ id_producto: i.dataset.id, cantidad: Number(i.value) })) };
  const btn = ev.submitter;
  btn.disabled = true;
  try {
    const r = await api(`/api/crm/requerimientos/${CASO.caso.id_requerimiento}/resolver`, { method: "POST", body });
    bootstrap.Modal.getInstance($("m-caso")).hide();
    aviso(`Caso N° ${CASO.caso.id_requerimiento} resuelto con ${esc(r.detalle)}. El cliente ya puede verlo en "Mis casos".`);
    cargarReq();
  } catch (e) { alert(e.message); btn.disabled = false; }
}

function resolucionHTML(c) {
  return `<div class="card border-0 shadow-sm"><div class="card-body small">
    <h6 class="fw-bold">✅ Resolución</h6>
    <div><b>${esc(c.solucion || "—")}</b>${c.monto_compensacion ? " · " + CLP(c.monto_compensacion) : ""}${c.id_pedido_reposicion ? ` · pedido de reposición N° ${c.id_pedido_reposicion}` : ""}</div>
    <div class="text-muted">${esc((c.fecha_resolucion || "").slice(0, 16))} por ${esc(c.gestor || "—")} · ${c.horas_resolucion} h · ${c.en_plazo ? "<span class='text-success'>en plazo</span>" : "<span class='text-danger'>fuera de plazo</span>"}</div>
    <div class="border-start border-3 ps-2 my-2">${esc(c.respuesta_ejecutivo || "")}</div>
    <h6 class="fw-bold mt-3">Satisfacción del cliente</h6>
    ${c.calificacion ? `<div class="fs-5">${"⭐".repeat(c.calificacion)}<span class="text-muted fs-6"> ${c.calificacion}/5</span></div>${c.comentario_cliente ? `<div class="fst-italic">“${esc(c.comentario_cliente)}”</div>` : ""}`
      : `<div class="text-muted">El cliente aún no califica la atención.</div>`}
  </div></div>`;
}

// ---------- Flota IoT ----------
async function cargarFlota() {
  const d = await api("/api/crm/flota");
  if (!MAPA) {
    MAPA = L.map("mapa").setView([-38.9, -72.6], 8);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap" }).addTo(MAPA);
  }
  d.camiones.forEach((c) => {
    const color = c.alerta_ruptura_frio ? "#c62828" : c.segundos > 60 ? "#9e9e9e" : "#1f8ac0";
    const pop = `<b>${c.camion_id}</b> (${esc(c.patente)})<br>Temp: ${c.temp_camara} °C · rango ${c.temp_min} a ${c.temp_max}<br>Combustible: ${c.combustible_pct}%`;
    if (!MARCAS[c.camion_id]) MARCAS[c.camion_id] = L.circleMarker([c.lat, c.lon], { radius: 9, weight: 2 }).addTo(MAPA);
    MARCAS[c.camion_id].setLatLng([c.lat, c.lon]).setStyle({ color, fillColor: color, fillOpacity: .8 }).bindPopup(pop);
  });
  $("t-flota").innerHTML = d.camiones.map((c) => `<tr class="${c.alerta_ruptura_frio ? "fila-alerta" : ""}">
    <td><b>${c.camion_id}</b></td><td class="${c.alerta_ruptura_frio ? "text-danger fw-bold" : ""}">${c.temp_camara} °C</td><td>${c.temp_min} a ${c.temp_max}</td>
    <td>${c.combustible_pct}%</td><td>${c.alertas_1h}</td><td>${c.segundos < 60 ? "hace " + c.segundos + " s" : esc(c.fecha_hora.slice(5, 16))}</td></tr>`).join("");
  $("l-alertas").innerHTML = d.alertas.map((a) => `<li><b>${a.camion_id}</b> ${esc(a.fecha_hora.slice(5, 19))} · ${a.temp_camara} °C (rango ${a.temp_min} a ${a.temp_max})</li>`).join("") || "<li>Sin alertas</li>";
  const h = await api(`/api/crm/flota/${$("sel-camion").value}/historial`);
  grafico("c-temp", { type: "line", data: { labels: h.map((r) => r.fecha_hora.slice(11, 19)), datasets: [{ label: "°C", data: h.map((r) => r.temp_camara),
    borderColor: "#1f8ac0", pointBackgroundColor: h.map((r) => (r.alerta_ruptura_frio ? "#c62828" : "#1f8ac0")), pointRadius: h.map((r) => (r.alerta_ruptura_frio ? 4 : 1.5)), tension: .25 }] },
    options: { animation: false, plugins: { legend: { display: false } } } });
  $("flota-hora").textContent = new Date().toLocaleTimeString("es-CL");
}
$("sel-camion").onchange = () => { if (CHARTS["c-temp"]) { CHARTS["c-temp"].destroy(); delete CHARTS["c-temp"]; } cargarFlota(); };

iniciar();
