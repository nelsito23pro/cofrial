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
    ["% pedidos por web (14 d)", (k.pct_web ?? 0) + "%"], ["Alertas de frío (1 h)", k.alertas_1h, k.alertas_1h > 0], ["Lecturas IoT (5 min)", k.lecturas_5min],
    ["Requerimientos abiertos", k.requerimientos_abiertos, k.requerimientos_abiertos > 0]];
  $("kpis").innerHTML = kpis.map(([t, v, alerta]) => `<div class="col-6 col-md-4 col-xl"><div class="card kpi ${alerta ? "alerta" : ""}"><div class="card-body py-2">
    <div class="small text-muted">${t}</div><div class="v">${v}</div></div></div></div>`).join("");
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
        <h6 class="fw-bold mt-3">Requerimientos</h6><ul class="small">${f.requerimientos.map((r) => `<li>[${esc(r.categoria || "—")}] ${esc(r.mensaje)} ${r.resuelto ? "✔" : ""}</li>`).join("") || "<li>—</li>"}</ul></div>
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
async function cargarPedidos() {
  const est = $("p-estado-f").value;
  const rows = await api("/api/crm/pedidos" + (est ? "?estado=" + encodeURIComponent(est) : ""));
  $("t-pedidos").innerHTML = rows.map((p) => `<tr>
    <td><b>${p.id_pedido}</b></td><td>${esc(p.fecha_pedido.slice(0, 16))}</td><td>${esc(p.cliente)}<div class="text-muted">${esc(p.observacion || "")}</div></td>
    <td>${p.tipo_cliente}</td><td>${esc(p.canal)}</td><td>${esc(p.comuna)}</td><td class="text-end">${CLP(p.total_neto)}</td><td>${p.camion_id ? "🚚 " + p.camion_id : "—"}</td>
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

// ---------- Requerimientos IA ----------
async function cargarReq() {
  const rows = await api("/api/crm/requerimientos");
  const pr = { 1: ["Alta", "danger"], 2: ["Media", "warning text-dark"], 3: ["Baja", "secondary"] };
  $("t-req").innerHTML = rows.map((r) => `<tr class="${!r.resuelto && r.prioridad === 1 ? "fila-alerta" : ""}">
    <td>${esc(r.fecha.slice(0, 16))}</td><td><a href="#" onclick="ficha(${r.id_cliente});return false">${esc(r.cliente)}</a><div class="text-muted">${esc(r.vendedor || "")}</div></td>
    <td><b>${esc(r.categoria || "—")}</b></td><td><span class="badge bg-${(pr[r.prioridad] || pr[3])[1]}">${(pr[r.prioridad] || pr[3])[0]}</span></td>
    <td>${esc(r.mensaje)}</td><td class="text-muted">${esc(r.respuesta_ia || "")}</td>
    <td>${r.resuelto ? "✔ Resuelto" : `<button class="btn btn-sm btn-outline-success" onclick="resolver(${r.id_requerimiento})">Resolver</button>`}</td></tr>`).join("")
    || `<tr><td colspan="7" class="text-muted p-3">Sin requerimientos. Prueba el chat de la tienda con una sesión de cliente.</td></tr>`;
}
async function resolver(id) { await api("/api/crm/requerimientos/" + id, { method: "PATCH", body: { resuelto: true } }); cargarReq(); }

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
