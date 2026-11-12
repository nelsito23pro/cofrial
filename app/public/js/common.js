// Utilidades compartidas del portal: API, carrito, cabecera y asistente IA
const CLP = (n) => "$" + Math.round(Number(n) || 0).toLocaleString("es-CL");
const IVA = 0.19;

async function api(url, opts = {}) {
  const r = await fetch(url, { headers: { "Content-Type": "application/json" }, credentials: "same-origin", ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Error ${r.status}`);
  return data;
}
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------- carrito (localStorage) ----------
const Carrito = {
  leer() { try { return JSON.parse(localStorage.getItem("cofrial_carrito")) || []; } catch { return []; } },
  guardar(items) { try { localStorage.setItem("cofrial_carrito", JSON.stringify(items)); } catch {} pintarContador(); },
  agregar(prod, cantidad) {
    const items = this.leer();
    const it = items.find((i) => i.id_producto === prod.id_producto);
    if (it) it.cantidad += cantidad; else items.push({ id_producto: prod.id_producto, nombre: prod.nombre, unidad: prod.unidad, cantidad });
    this.guardar(items);
  },
  vaciar() { this.guardar([]); },
};
function pintarContador() {
  const el = document.getElementById("carrito-count");
  if (el) el.textContent = Carrito.leer().reduce((s, i) => s + i.cantidad, 0);
}

// ---------- cabecera ----------
let SESION = null;
async function cabecera(activa) {
  SESION = (await api("/api/me")).cliente;
  const perfil = SESION
    ? `<span class="badge badge-perfil me-2">Perfil ${esc(SESION.tipo)} · ${esc(SESION.lista)}${SESION.estado === "Prospecto" ? " · pendiente de aprobación" : ""}</span>
       <a class="nav-link d-inline text-white ${activa === "pedidos" ? "fw-bold" : ""}" href="/mis-pedidos">Mis pedidos</a>
       <a class="nav-link d-inline text-white ${activa === "casos" ? "fw-bold" : ""}" href="/mis-casos">Mis casos</a>
       <a class="nav-link d-inline text-white-50" href="#" id="salir">Salir</a>`
    : `<a class="btn btn-sm btn-light" href="/cuenta">Ingresar</a> <a class="btn btn-sm btn-outline-light" href="/registro">Crear cuenta</a>`;
  document.getElementById("cabecera").innerHTML = `
  <nav class="navbar navbar-dark navbar-cof mb-4"><div class="container">
    <a class="navbar-brand" href="/">❄ COFRIAL</a>
    <div class="d-flex align-items-center gap-2 flex-wrap">
      <span class="text-white-50 small d-none d-md-inline">${SESION ? "Hola, " + esc(SESION.nombre) : "Cadena de frío inteligente"}</span>
      ${perfil}
      ${SESION ? `<a class="btn btn-sm btn-outline-light" href="/carrito">🛒 Carrito (<span id="carrito-count">0</span>)</a>` : ""}
    </div></div></nav>`;
  const s = document.getElementById("salir");
  if (s) s.onclick = async (e) => {   // al salir se vacía el carrito: en un computador compartido no debe verlo el siguiente usuario
    e.preventDefault(); await api("/api/auth/logout", { method: "POST" }); Carrito.vaciar(); location.href = "/";
  };
  pintarContador();
  montarChat();
  return SESION;
}

// ---------- asistente IA ----------
let CHAT_PEDIDO = null;   // pedido sobre el que el cliente reporta un problema (desde "Mis pedidos")
function reportarProblema(idPedido) {
  CHAT_PEDIDO = idPedido;
  document.getElementById("chat-box").style.display = "block";
  document.getElementById("chat-contexto").innerHTML = `<div class="alert alert-warning py-1 px-2 mb-0 small d-flex justify-content-between align-items-center">
    <span>Reportando un problema con el <b>pedido N° ${Number(idPedido)}</b></span>
    <button type="button" class="btn-close btn-sm" onclick="CHAT_PEDIDO=null;this.closest('.alert').remove()"></button></div>`;
  const input = document.getElementById("chat-input");
  input.placeholder = "Cuéntanos qué pasó: producto, cantidad y estado en que llegó...";
  input.focus();
}
function montarChat() {
  if (document.getElementById("chat-btn")) return;
  document.body.insertAdjacentHTML("beforeend", `
  <button id="chat-btn" class="btn btn-primary px-3">💬 Asistente IA</button>
  <div id="chat-box" class="card shadow">
    <div class="card-header d-flex justify-content-between align-items-center"><strong>Asistente Cofrial</strong>
      <button class="btn-close btn-sm" id="chat-cerrar"></button></div>
    <div id="chat-contexto"></div>
    <div id="chat-log" class="card-body p-2"><div class="msg msg-ia">Hola, ¿en qué te ayudo? Puedes consultar despachos, hacer un pedido o informar un problema con tu entrega.</div></div>
    <form id="chat-form" class="card-footer d-flex gap-2 p-2">
      <input class="form-control form-control-sm" id="chat-input" placeholder="Escribe tu mensaje..." autocomplete="off" maxlength="1000">
      <button class="btn btn-sm btn-primary">Enviar</button></form></div>`);
  const box = document.getElementById("chat-box"), log = document.getElementById("chat-log");
  document.getElementById("chat-btn").onclick = () => (box.style.display = box.style.display === "block" ? "none" : "block");
  document.getElementById("chat-cerrar").onclick = () => (box.style.display = "none");
  document.getElementById("chat-form").onsubmit = async (e) => {
    e.preventDefault();
    const input = document.getElementById("chat-input"), texto = input.value.trim();
    if (!texto) return;
    input.value = "";
    log.insertAdjacentHTML("beforeend", `<div class="msg msg-yo">${esc(texto)}</div>`);
    log.scrollTop = log.scrollHeight;
    try {
      const r = await api("/api/chat", { method: "POST", body: { mensaje: texto, id_pedido: CHAT_PEDIDO } });
      log.insertAdjacentHTML("beforeend", `<div class="msg msg-ia">${esc(r.respuesta)}
        <div class="msg-meta">Clasificado como <b>${esc(r.categoria)}</b> · prioridad ${r.prioridad} · motor ${esc(r.motor)}${r.registrado
          ? ` · caso N° ${r.id_requerimiento}${CHAT_PEDIDO ? ` (pedido N° ${CHAT_PEDIDO})` : ""} enviado a tu ejecutivo · <a href="/mis-casos">ver en Mis casos</a>`
          : " · inicia sesión para registrar tu caso"}</div></div>`);
    } catch (err) {
      log.insertAdjacentHTML("beforeend", `<div class="msg msg-ia text-danger">${esc(err.message)}</div>`);
    }
    log.scrollTop = log.scrollHeight;
  };
}

function aviso(msg, tipo = "success") {
  const el = document.getElementById("aviso");
  if (!el) return alert(msg);
  el.innerHTML = `<div class="alert alert-${tipo} alert-dismissible">${msg}<button class="btn-close" data-bs-dismiss="alert"></button></div>`;
}
