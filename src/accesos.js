// accesos.js — la matriz de accesos (personas × apps → rol) del panel de admin.
//
// Dos presentaciones de los mismos datos: en pantallas anchas, una tabla con la columna de
// personas fija, el encabezado fijo, flechas a los costados y navegación con el teclado como una
// grilla; en pantallas angostas, una tarjeta por persona. Todo cambio pasa por `cambiar()` (una
// celda) o por las vistas previas de cambio en bloque y copia: guardado al momento, indicador en
// la celda, Deshacer y confirmación de los roles altos. Las reglas las vuelve a validar el
// servidor (server/accesos.js): acá sólo se anticipan.
import { nivelRol, esRolAlto, NOMBRE_NIVEL } from "/niveles.js";

const HUB = "lockatus";
const LS_OCULTAS = "lockatus.appsOcultas";
const MSJ_PROPIO = "No podés sacarte tu propio acceso de admin a Lockatus.";
const VIA = { celda: "en la matriz", reintento: "en la matriz", deshacer: "con Deshacer", bloque: "en bloque",
  copia: "copiando accesos", arranque: "al instalar Lockatus", api: "por API" };

let H = null;   // helpers de app.js: api, toast, esc, initials, openAppEditor, showLinkDialog, recargar, salir
let esc = (s) => String(s ?? "");
const S = {
  apps: [], users: [], me: null,
  q: "", sel: new Set(), ocultas: leerOcultas(),
  activa: null,            // { uid|"h", nav } — la celda que tiene el tab de la grilla
  hist: new Map(),         // cache del historial por "uid|app"
  reintentos: new Map(),   // "uid|app" → fn
  avisosError: new Map(),  // "uid|app" → el aviso de error (se va si el reintento sale bien)
  scroll: { left: 0, top: 0 },
};

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const reducido = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const sinTildes = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const nombre = (u) => u.name || u.email.split("@")[0];
const userById = (id) => S.users.find((u) => u.id === Number(id));
const appBySlug = (slug) => S.apps.find((a) => a.slug === slug);
const appsVisibles = () => S.apps.filter((a) => !S.ocultas.has(a.slug));
const clave = (uid, slug) => `${uid}|${slug}`;
const personas = (n) => (n === 0 ? "nadie" : n === 1 ? "1 persona" : `${n} personas`);
const conAcceso = (slug) => S.users.filter((u) => u.status === "active" && u.roles[slug]).length;

function leerOcultas() {
  try { return new Set(JSON.parse(localStorage.getItem(LS_OCULTAS) || "[]")); } catch { return new Set(); }
}
function guardarOcultas() {
  try { localStorage.setItem(LS_OCULTAS, JSON.stringify([...S.ocultas])); } catch { /* sin storage */ }
}

async function api(method, path, body) {
  try { return await H.api(method, path, body); }
  catch { return { status: 0, ok: false, data: { error: "Sin conexión con Lockatus" } }; }
}

// ---------------------------------------------------------------- iconos (SVG line, sin emojis)
const IC = {
  buscar: `<svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="9" cy="9" r="5.5"/><path d="M13.2 13.2 17 17"/></svg>`,
  columnas: `<svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="14" height="12" rx="2"/><path d="M8 4v12M12.5 4v12"/></svg>`,
  izq: `<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5 7 10l5 5"/></svg>`,
  der: `<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m8 5 5 5-5 5"/></svg>`,
  car: `<svg class="rc-car" viewBox="0 0 20 20" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 8 4 4 4-4"/></svg>`,
  ok: `<svg viewBox="0 0 20 20" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 10.5 3.2 3L15 7"/></svg>`,
  tilde: `<svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 10.5 3.2 3L15 7"/></svg>`,
  reloj: `<svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10" cy="10" r="7"/><path d="M10 6v4l2.6 1.6"/></svg>`,
  puntos: `<svg viewBox="0 0 20 20" width="16" height="16" fill="currentColor" aria-hidden="true"><circle cx="4" cy="10" r="1.6"/><circle cx="10" cy="10" r="1.6"/><circle cx="16" cy="10" r="1.6"/></svg>`,
  tfa: `<svg viewBox="0 0 20 20" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="8.5" width="12" height="8" rx="1.5"/><path d="M6.5 8.5V6a3.5 3.5 0 0 1 7 0v2.5"/></svg>`,
  tfaOff: `<svg viewBox="0 0 20 20" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="8.5" width="12" height="8" rx="1.5"/><path d="M6.5 8.5V6a3.5 3.5 0 0 1 6.6-1.6"/></svg>`,
  flecha: `<svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 10h12M12 6l4 4-4 4"/></svg>`,
};
const barras = `<span class="rc-bars" aria-hidden="true"><i></i><i></i><i></i></span>`;

// Etiqueta de un rol con su color por nivel (para listas, vistas previas e historial).
function chip(a, rol, extra = "") {
  const n = nivelRol(a?.roles || [], rol);
  return rol
    ? `<span class="nchip ${extra}" data-n="${n}" title="Nivel ${NOMBRE_NIVEL[n].toLowerCase()}">${barras}${esc(rol)}</span>`
    : `<span class="nchip ${extra}" data-n="0" title="Sin acceso" aria-label="Sin acceso">—</span>`;
}

function cuando(ts) {
  const d = new Date(ts), s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return "recién";
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  return d.toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
const fechaLarga = (ts) => new Date(ts).toLocaleString("es-AR", { dateStyle: "long", timeStyle: "short" });

function anunciar(msg) {
  const live = $("#mx-live");
  if (!live) return;
  live.textContent = "";
  setTimeout(() => { live.textContent = msg; }, 30);
}

// ================================================================ vista
export async function viewAccesos(helpers) {
  H = helpers; esc = helpers.esc;
  const r = await api("GET", "/api/admin/matrix");
  if (!r.ok) return H.salir();
  S.apps = r.data.apps; S.users = r.data.users; S.me = r.data.me;
  S.hist.clear(); S.reintentos.clear();
  for (const uid of [...S.sel]) if (!userById(uid)) S.sel.delete(uid);
  armar();
}

async function recargar() {
  guardarScroll();
  const r = await api("GET", "/api/admin/matrix");
  if (!r.ok) return H.toast(r.data.error || "No se pudo actualizar la matriz", true);
  S.apps = r.data.apps; S.users = r.data.users; S.me = r.data.me;
  S.hist.clear(); S.reintentos.clear();
  pintar();
  if (document.activeElement === document.body) $(".matrix [data-nav][tabindex='0']")?.focus({ preventScroll: true });
}

function guardarScroll() {
  const w = $("#mx-scroll");
  if (w) S.scroll = { left: w.scrollLeft, top: w.scrollTop };
}

// Esqueleto de la pantalla (una vez por entrada): encabezado, altas, herramientas, bloque.
function armar() {
  const root = H.root;
  root.innerHTML = `
    <div class="panel">
      <div class="matrix-head">
        <div><div class="crumb">Lockatus · Admin</div><h2>Accesos</h2></div>
        <div class="actions"><button id="nuevo" type="button">+ Usuario</button><button id="nuevoapp" type="button" class="ghost">+ App</button></div>
      </div>
      <form id="newuser" class="newuser" style="display:none">
        <input id="nu-email" type="email" placeholder="correo@org.com" required />
        <input id="nu-name" placeholder="Nombre (opcional)" />
        <button type="submit">Crear</button>
      </form>
      <form id="newapp" class="newuser" style="display:none">
        <input id="na-slug" placeholder="slug (ej. trustux)" autocomplete="off" required />
        <input id="na-name" placeholder="Nombre visible (opcional)" />
        <input id="na-roles" placeholder="roles del más alto al más bajo, separados por coma (ej. admin, editor, lector)" required />
        <input id="na-redirect" placeholder="redirect_uri (opcional, ej. https://miapp/callback)" />
        <button type="submit">Agregar app</button>
      </form>
      <div class="mx-tools">
        <label class="mx-search">${IC.buscar}
          <input id="mx-q" type="search" placeholder="Buscar persona (nombre o email)" aria-label="Buscar persona por nombre o email" autocomplete="off" spellcheck="false" />
          <span class="mx-q-n" id="mx-q-n" aria-live="polite"></span>
        </label>
        <button type="button" class="ghost mx-filtro" id="mx-filtro" aria-haspopup="dialog" aria-expanded="false">${IC.columnas}<span>Apps</span><span class="mx-filtro-n" id="mx-filtro-n"></span></button>
        <span class="sp"></span>
        <div class="mx-leyenda" aria-label="Color de cada rol según su nivel en la app">
          <span class="nchip" data-n="3">${barras}Alto</span>
          <span class="nchip" data-n="2">${barras}Intermedio</span>
          <span class="nchip" data-n="1">${barras}Básico</span>
          <span class="nchip" data-n="0">—</span><span class="mx-leyenda-t">sin acceso</span>
        </div>
      </div>
      <div class="mx-bulk hidden" id="mx-bulk" role="region" aria-label="Cambio en bloque">
        <b id="mx-bulk-n"></b>
        <span class="mx-bulk-campos">
          <label>Dar en <select id="mx-bulk-app" aria-label="App"></select></label>
          <label>el rol <select id="mx-bulk-rol" aria-label="Rol"></select></label>
        </span>
        <button type="button" id="mx-bulk-ver">Revisar cambios…</button>
        <button type="button" class="ghost" id="mx-bulk-x">Quitar selección</button>
      </div>
      <div id="mx-cuerpo"></div>
      <div class="sr-only" id="mx-live" aria-live="polite"></div>
    </div>`;
  cablearAltas();
  cablearHerramientas();
  cablearGlobal();
  pintar();
}

// ---------------------------------------------------------------- altas (usuario / app)
function cablearAltas() {
  const toggle = (id) => { const f = document.getElementById(id); f.style.display = f.style.display === "none" ? "flex" : "none"; if (f.style.display === "flex") f.querySelector("input").focus(); ajustarAlto(); };
  $("#nuevo").onclick = () => toggle("newuser");
  $("#nuevoapp").onclick = () => toggle("newapp");
  $("#newuser").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("#nu-email").value.trim();
    const r = await api("POST", "/api/admin/users", { email, name: $("#nu-name").value });
    if (!r.ok) return H.toast(r.data.error || "No se pudo crear", true);
    H.showLinkDialog("Usuario creado", r.data.link, r.data.emailed, email);
    $("#nu-email").value = ""; $("#nu-name").value = ""; $("#newuser").style.display = "none";
    recargar();
  });
  $("#newapp").addEventListener("submit", async (e) => {
    e.preventDefault();
    const slug = $("#na-slug").value.trim().toLowerCase();
    const roles = $("#na-roles").value.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
    const name = $("#na-name").value.trim() || slug;
    const redirect = $("#na-redirect").value.trim();
    const r = await api("PUT", `/api/admin/apps/${encodeURIComponent(slug)}`, { name, roles, redirect_uris: redirect ? redirect.split(/[\s,]+/).filter(Boolean) : [] });
    if (!r.ok) return H.toast(r.data.error || "No se pudo agregar la app", true);
    H.toast(`App agregada: ${slug} (${roles.join(", ")})`);
    $("#newapp").reset(); $("#newapp").style.display = "none";
    recargar();
  });
}

// ---------------------------------------------------------------- buscador, filtro, bloque
function cablearHerramientas() {
  const q = $("#mx-q");
  q.value = S.q;
  q.addEventListener("input", () => { S.q = q.value; filtrar(); });
  q.addEventListener("keydown", (e) => { if (e.key === "Escape" && q.value) { e.stopPropagation(); q.value = ""; S.q = ""; filtrar(); } });

  $("#mx-filtro").onclick = (e) => abrirFiltro(e.currentTarget);

  const selApp = $("#mx-bulk-app"), selRol = $("#mx-bulk-rol");
  selApp.onchange = () => llenarRolesBloque();
  $("#mx-bulk-x").onclick = () => { S.sel.clear(); sincronizarSeleccion(); };
  $("#mx-bulk-ver").onclick = () => {
    if (!selRol.value) { selRol.focus(); return H.toast("Elegí el rol que querés dar", true); }
    const a = appBySlug(selApp.value);
    const role = selRol.value === "__sin" ? null : selRol.value;
    const cambios = [...S.sel].map((uid) => ({ uid, app: a.slug, role }));
    vistaPrevia({
      titulo: role ? `Dar ${role} de ${a.name} a ${personas(cambios.length)}` : `Quitar el acceso a ${a.name} a ${personas(cambios.length)}`,
      cargar: () => api("POST", "/api/admin/roles/preview", { cambios }),
      aplicar: (items) => api("POST", "/api/admin/roles/bulk", { cambios: items.map((i) => ({ uid: i.uid, app: i.app, role: i.despues, antes: i.antes })), confirm: true }),
      alTerminar: () => { S.sel.clear(); },
    });
  };
}

function llenarRolesBloque() {
  const selApp = $("#mx-bulk-app"), selRol = $("#mx-bulk-rol");
  const a = appBySlug(selApp.value);
  if (!a) { selRol.innerHTML = ""; return; }
  selRol.innerHTML = `<option value="" disabled selected>Elegí un rol</option>` +
    a.roles.map((r) => `<option value="${esc(r)}">${esc(r)} · ${NOMBRE_NIVEL[nivelRol(a.roles, r)].toLowerCase()}</option>`).join("") +
    `<option value="__sin">— Sin acceso (quitar)</option>`;
}

function sincronizarSeleccion() {
  const n = S.sel.size;
  $$(".mx-sel").forEach((cb) => { cb.checked = S.sel.has(Number(cb.dataset.uid)); cb.closest("tr, .ucard")?.classList.toggle("sel", cb.checked); });
  const vis = filasVisibles().map((tr) => Number(tr.dataset.uid));
  const all = $("#mx-all");
  if (all) {
    const k = vis.filter((id) => S.sel.has(id)).length;
    all.checked = vis.length > 0 && k === vis.length;
    all.indeterminate = k > 0 && k < vis.length;
  }
  const bar = $("#mx-bulk");
  bar.classList.toggle("hidden", n === 0);
  if (n) {
    $("#mx-bulk-n").textContent = n === 1 ? "1 persona elegida" : `${n} personas elegidas`;
    const selApp = $("#mx-bulk-app"), prev = selApp.value;
    selApp.innerHTML = appsVisibles().map((a) => `<option value="${esc(a.slug)}">${esc(a.name)}</option>`).join("");
    if (prev && appBySlug(prev) && !S.ocultas.has(prev)) selApp.value = prev;
    if (selApp.value !== prev || !$("#mx-bulk-rol").options.length) llenarRolesBloque();
  }
  ajustarAlto();
}

// Filtro de apps: mostrar u ocultar columnas (se recuerda en este navegador).
function abrirFiltro(btn) {
  const el = document.createElement("div");
  el.className = "pop filtro-pop";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", "Apps que se muestran");
  const lista = () => S.apps.map((a) => `
    <label class="filtro-op"><input type="checkbox" data-app="${esc(a.slug)}" ${S.ocultas.has(a.slug) ? "" : "checked"} />
      <span>${esc(a.name)}</span><span class="filtro-n" title="Personas con acceso">${conAcceso(a.slug)}</span></label>`).join("");
  el.innerHTML = `<div class="pop-tit">Apps que se muestran</div><div class="filtro-lista">${lista()}</div>
    <div class="pop-sep"></div><div class="filtro-acc"><button type="button" class="ghost mini" data-todas>Mostrar todas</button></div>`;
  el.addEventListener("change", (e) => {
    const cb = e.target.closest("input[data-app]");
    if (!cb) return;
    if (cb.checked) S.ocultas.delete(cb.dataset.app); else S.ocultas.add(cb.dataset.app);
    if (S.ocultas.size >= S.apps.length) { S.ocultas.delete(cb.dataset.app); cb.checked = true; H.toast("Dejá al menos una app a la vista", true); return; }
    guardarOcultas(); guardarScroll(); pintar();
  });
  el.querySelector("[data-todas]").onclick = () => {
    S.ocultas.clear(); guardarOcultas();
    el.querySelectorAll("input[data-app]").forEach((cb) => { cb.checked = true; });
    guardarScroll(); pintar();
  };
  abrirPop(btn, el, { foco: el.querySelector("input") });
}

// ================================================================ pintar la matriz
function pintar() {
  const cuerpo = $("#mx-cuerpo");
  if (!cuerpo) return;
  const apps = appsVisibles();
  const users = S.users;
  $("#mx-filtro-n").textContent = apps.length === S.apps.length ? `${apps.length}` : `${apps.length} de ${S.apps.length}`;
  $("#mx-filtro").setAttribute("aria-label", `Apps que se muestran: ${apps.length} de ${S.apps.length}`);

  if (!users.length) {
    cuerpo.innerHTML = `<div class="matrix-empty">Todavía no hay usuarios. Creá el primero con “+ Usuario”.</div>`;
    return;
  }

  const head = `
    <tr>
      <th class="u" scope="col"><div class="u-in">
        <input type="checkbox" class="mx-check" id="mx-all" data-nav="0" tabindex="-1" aria-label="Elegir todas las personas que se ven" />
        <span class="u-tit">Persona</span><span class="u-cnt" id="mx-u-cnt">${users.length}</span>
      </div></th>
      ${apps.map((a, i) => `<th class="app" scope="col" data-col="${i}" data-app="${esc(a.slug)}">
        <button type="button" class="appcol" data-nav="${i + 2}" tabindex="-1" data-app="${esc(a.slug)}"
          aria-label="${esc(a.name)}: ${personas(conAcceso(a.slug))} con acceso. Editar app" title="Editar app ${esc(a.name)}">
          <span class="appn">${esc(a.name)}</span><span class="appc" data-cnt="${esc(a.slug)}">${personas(conAcceso(a.slug))}</span>
        </button></th>`).join("")}
      <th class="fill" aria-hidden="true"></th>
    </tr>`;
  const fila = (u) => `
    <tr data-uid="${u.id}" class="${u.status !== "active" ? "off" : ""}">
      <th class="u" scope="row"><div class="u-in">
        <input type="checkbox" class="mx-check mx-sel" data-uid="${u.id}" data-nav="0" tabindex="-1" aria-label="Elegir a ${esc(nombre(u))}" />
        ${celdaPersona(u)}
        <button type="button" class="icon-btn rowmenu-btn" data-uid="${u.id}" data-nav="1" tabindex="-1" aria-haspopup="menu" aria-expanded="false" aria-label="Acciones de ${esc(nombre(u))}" title="Acciones">${IC.puntos}</button>
      </div></th>
      ${apps.map((a, i) => `<td class="cell" data-col="${i}">${botonCelda(u, a, i)}</td>`).join("")}
      <td class="fill" aria-hidden="true"></td>
    </tr>`;

  const tarjeta = (u) => `
    <article class="ucard ${u.status !== "active" ? "off" : ""}" data-uid="${u.id}">
      <header class="ucard-head">
        <input type="checkbox" class="mx-check mx-sel" data-uid="${u.id}" aria-label="Elegir a ${esc(nombre(u))}" />
        ${celdaPersona(u)}
        <button type="button" class="icon-btn rowmenu-btn" data-uid="${u.id}" aria-haspopup="menu" aria-expanded="false" aria-label="Acciones de ${esc(nombre(u))}" title="Acciones">${IC.puntos}</button>
      </header>
      <div class="ucard-roles">${apps.map((a) => filaTarjeta(u, a)).join("")}</div>
    </article>`;

  cuerpo.innerHTML = `
    <div class="mx-frame" id="mx-frame">
      <button type="button" class="mx-flecha izq" id="mx-izq" aria-label="Ver las apps anteriores" title="Apps anteriores" aria-controls="mx-scroll" hidden>${IC.izq}</button>
      <div class="tablewrap" id="mx-scroll">
        <table class="matrix" role="grid" aria-label="Accesos: personas por app" aria-describedby="mx-ayuda">
          <thead>${head}</thead><tbody>${users.map(fila).join("")}</tbody>
        </table>
      </div>
      <button type="button" class="mx-flecha der" id="mx-der" aria-label="Ver más apps" title="Más apps" aria-controls="mx-scroll" hidden>${IC.der}</button>
    </div>
    <p class="sr-only" id="mx-ayuda">Con las flechas del teclado te movés entre las celdas; Enter abre el rol de esa celda.</p>
    <div class="mx-vacio hidden" id="mx-vacio"></div>
    <div class="cards">${users.map(tarjeta).join("")}</div>`;

  HL.tr = null; HL.col = null;
  medirColumnas();
  cablearTabla();
  filtrar();
  sincronizarSeleccion();
  ajustarAlto();
  const w = $("#mx-scroll");
  w.scrollLeft = S.scroll.left; w.scrollTop = S.scroll.top;
  actualizarFlechas();
  restaurarActiva();
}

function celdaPersona(u) {
  const tfa = u.totp
    ? `<span class="tfa-mini on" role="img" title="2FA activo" aria-label="2FA activo">${IC.tfa}</span>`
    : `<span class="tfa-mini off" role="img" title="Sin 2FA" aria-label="Sin 2FA">${IC.tfaOff}</span>`;
  const yo = u.id === S.me ? `<span class="yo-tag">vos</span>` : "";
  return `<div class="ucell"><span class="av" aria-hidden="true">${esc(H.initials(u.name || u.email))}</span>
    <span class="uinfo"><b><span class="uname">${esc(nombre(u))}</span>${yo}${tfa}</b>
    <span class="email" title="${esc(u.email)}">${esc(u.email)}${u.status !== "active" ? ` · <span class="off-tag">deshabilitado</span>` : ""}</span></span></div>`;
}

function etiquetaCelda(a, rol) {
  return rol ? `${a.name}: ${rol}, nivel ${NOMBRE_NIVEL[nivelRol(a.roles, rol)].toLowerCase()}` : `${a.name}: Sin acceso`;
}

function botonCelda(u, a, i) {
  const rol = u.roles[a.slug] || null, n = nivelRol(a.roles, rol);
  return `<div class="cw"><button type="button" class="rc" data-n="${n}" data-uid="${u.id}" data-app="${esc(a.slug)}" data-nav="${i + 2}" tabindex="-1"
      aria-haspopup="listbox" aria-expanded="false" aria-label="${esc(etiquetaCelda(a, rol))}"${rol ? "" : ` title="Sin acceso"`}>
      ${barras}<span class="rc-t">${rol ? esc(rol) : "—"}</span>${IC.car}</button><span class="rc-st" data-uid="${u.id}" data-app="${esc(a.slug)}"></span></div>`;
}

function opcionesSelect(u, a) {
  const cur = u.roles[a.slug] || "";
  const propio = a.slug === HUB && u.id === S.me && cur === "admin";
  return `<option value="" ${propio ? "disabled" : ""}>— Sin acceso</option>` +
    a.roles.map((ro) => `<option value="${esc(ro)}" ${ro === cur ? "selected" : ""}>${esc(ro)}</option>`).join("");
}

function filaTarjeta(u, a) {
  const rol = u.roles[a.slug] || null;
  return `<div class="rolerow" data-app="${esc(a.slug)}">
    <span class="rolerow-app">${esc(a.name)}</span>
    <span class="rolerow-ctl"><select class="role" data-uid="${u.id}" data-app="${esc(a.slug)}" data-n="${nivelRol(a.roles, rol)}" aria-label="Rol de ${esc(nombre(u))} en ${esc(a.name)}">${opcionesSelect(u, a)}</select>
      <span class="rc-st" data-uid="${u.id}" data-app="${esc(a.slug)}"></span></span>
    <button type="button" class="icon-btn hist-btn" data-uid="${u.id}" data-app="${esc(a.slug)}" aria-label="Historial de ${esc(a.name)}" title="Historial">${IC.reloj}</button>
  </div>`;
}

// Ancho igual para todas las columnas de apps: el del rol más largo (o del nombre de la app).
function medirColumnas() {
  const frame = $("#mx-frame");
  if (!frame) return;
  const ctx = document.createElement("canvas").getContext("2d");
  const fam = getComputedStyle(document.body).fontFamily;
  let max = 0;
  ctx.font = `600 13px ${fam}`;
  for (const a of appsVisibles()) for (const r of a.roles) max = Math.max(max, ctx.measureText(r).width);
  ctx.font = `600 11.5px ${fam}`;
  for (const a of appsVisibles()) max = Math.max(max, ctx.measureText(a.name.toUpperCase()).width * 1.05 - 26);
  // barras (12) + separaciones (14) + flechita (16) + relleno del botón (20) + celda (16)
  const colw = Math.max(112, Math.ceil(max + 80));
  frame.style.setProperty("--mx-colw", `${colw}px`);
  const t = $(".matrix", frame), th = $("th.u", frame);
  t.style.width = `${th.getBoundingClientRect().width + colw * appsVisibles().length}px`;
  frame.style.setProperty("--mx-stickyw", `${th.getBoundingClientRect().width}px`);
  frame.style.setProperty("--mx-headh", `${$("thead", frame).getBoundingClientRect().height}px`);
}

// ---------------------------------------------------------------- buscador
function filasVisibles() { return $$(".matrix tbody tr").filter((tr) => !tr.hidden); }

function filtrar() {
  const q = sinTildes(S.q.trim());
  const si = new Set(S.users.filter((u) => !q || sinTildes(`${u.name || ""} ${u.email}`).includes(q)).map((u) => String(u.id)));
  const n = si.size;
  $$(".matrix tbody tr, .ucard").forEach((el) => { el.hidden = !si.has(el.dataset.uid); });
  const vacio = $("#mx-vacio");
  if (vacio) {
    vacio.classList.toggle("hidden", n > 0);
    vacio.innerHTML = n ? "" : `Nadie coincide con «${esc(S.q.trim())}». <button type="button" class="linkbtn" id="mx-q-limpiar">Limpiar la búsqueda</button>`;
    const b = $("#mx-q-limpiar");
    if (b) b.onclick = () => { S.q = ""; $("#mx-q").value = ""; filtrar(); $("#mx-q").focus(); };
  }
  const frame = $("#mx-frame");
  if (frame) frame.classList.toggle("hidden", n === 0);
  $("#mx-q-n").textContent = q ? `${n} de ${S.users.length}` : "";
  const cnt = $("#mx-u-cnt");
  if (cnt) cnt.textContent = q ? `${n}/${S.users.length}` : `${S.users.length}`;
  if (S.activa && S.activa.uid !== "h" && !filasVisibles().some((tr) => tr.dataset.uid === String(S.activa.uid))) S.activa = null;
  sincronizarSeleccion();
  asegurarTab();
}

// ================================================================ tabla: flechas, sombra, grilla
function cablearTabla() {
  const w = $("#mx-scroll"), frame = $("#mx-frame");
  w.addEventListener("scroll", () => { actualizarFlechas(); }, { passive: true });
  $("#mx-izq").onclick = () => desplazar(-1);
  $("#mx-der").onclick = () => desplazar(1);
  if (cablearTabla.ro) cablearTabla.ro.disconnect();
  cablearTabla.ro = new ResizeObserver(() => { medirColumnas(); actualizarFlechas(); });
  cablearTabla.ro.observe(w);

  const t = $(".matrix", frame);
  t.addEventListener("keydown", teclaGrilla);
  t.addEventListener("focusin", (e) => {
    const el = e.target.closest("[data-nav]");
    if (!el) return;
    marcarActiva(el);
    iluminarDesde(el);
  });
  t.addEventListener("mouseover", (e) => {
    const c = e.target.closest("td, th");
    if (!c || !t.contains(c)) return;
    iluminar(c.closest("tr"), c.dataset.col);
    const rc = e.target.closest(".rc");
    if (rc) programarTip(rc); else ocultarTip();
  });
  t.addEventListener("mouseleave", () => {
    ocultarTip();
    const f = document.activeElement?.closest?.("[data-nav]");
    if (f && t.contains(f)) iluminarDesde(f); else iluminar(null, null);
  });
  t.addEventListener("focusout", (e) => { if (!t.contains(e.relatedTarget) && !t.matches(":hover")) iluminar(null, null); });
}

// La tabla ocupa el alto que queda en la ventana (así el encabezado fijo se ve siempre).
function ajustarAlto() {
  const w = $("#mx-scroll");
  if (!w || !w.offsetParent) return;
  const top = w.getBoundingClientRect().top + window.scrollY;
  w.style.maxHeight = `${Math.max(380, Math.floor(window.innerHeight - top - 24))}px`;
}
window.addEventListener("resize", () => ajustarAlto());

function actualizarFlechas() {
  const w = $("#mx-scroll"), frame = $("#mx-frame");
  if (!w || !frame) return;
  const max = w.scrollWidth - w.clientWidth;
  const izq = w.scrollLeft > 2, der = w.scrollLeft < max - 2;
  frame.classList.toggle("can-izq", izq);
  frame.classList.toggle("can-der", der);
  frame.classList.toggle("scrolled", izq);
  for (const [id, si, otro] of [["#mx-izq", izq, "#mx-der"], ["#mx-der", der, "#mx-izq"]]) {
    const b = $(id);
    if (b.hidden === !si) continue;
    const teniaFoco = document.activeElement === b;
    b.hidden = !si;
    if (teniaFoco) { const o = $(otro); (o.hidden ? $("[data-nav][tabindex='0']") : o)?.focus(); }
  }
}

// Desplaza de a dos columnas (una si queda poco), alineando el borde a una columna.
function desplazar(dir) {
  const w = $("#mx-scroll");
  const colw = parseFloat(getComputedStyle($("#mx-frame")).getPropertyValue("--mx-colw")) || 120;
  const visibles = Math.max(1, Math.floor((w.clientWidth - $("th.u").getBoundingClientRect().width) / colw));
  const paso = visibles >= 3 ? 2 : 1;
  const actual = Math.round(w.scrollLeft / colw);
  const dest = Math.max(0, Math.min(w.scrollWidth - w.clientWidth, (actual + dir * paso) * colw));
  w.scrollTo({ left: dest, behavior: reducido() ? "auto" : "smooth" });
}

// ---- iluminar fila y columna ----
const HL = { tr: null, col: null };
function iluminar(tr, col) {
  col = col == null || col === "" ? null : String(col);
  if (HL.tr !== tr) { HL.tr?.classList.remove("hl"); tr?.classList.add("hl"); HL.tr = tr; }
  if (HL.col !== col) {
    if (HL.col != null) $$(`.matrix [data-col="${HL.col}"]`).forEach((c) => c.classList.remove("hlc"));
    if (col != null) $$(`.matrix [data-col="${col}"]`).forEach((c) => c.classList.add("hlc"));
    HL.col = col;
  }
}
function iluminarDesde(el) {
  const c = el.closest("td, th");
  const tr = el.closest("tr");
  iluminar(tr?.parentElement?.tagName === "THEAD" ? null : tr, c?.dataset.col);
}

// ---- grilla con el teclado (un solo tab: la celda activa; las flechas mueven) ----
function grilla() {
  const t = $(".matrix");
  if (!t) return [];
  const rows = [t.tHead.rows[0], ...filasVisibles()];
  return rows.map((tr) => { const m = []; $$("[data-nav]", tr).forEach((el) => { m[Number(el.dataset.nav)] = el; }); return m; });
}
function marcarActiva(el) {
  $$(".matrix [data-nav][tabindex='0']").forEach((x) => { if (x !== el) x.tabIndex = -1; });
  el.tabIndex = 0;
  const tr = el.closest("tr");
  S.activa = { uid: tr.dataset.uid || "h", nav: el.dataset.nav };
}
function asegurarTab() {
  const t = $(".matrix");
  if (!t) return;
  const cur = $("[data-nav][tabindex='0']", t);
  if (cur && !cur.closest("tr").hidden) return;
  const primera = filasVisibles()[0];
  const el = primera ? $('[data-nav="2"]', primera) || $("[data-nav]", primera) : $("[data-nav]", t.tHead);
  if (el) marcarActiva(el);
}
function restaurarActiva() {
  const a = S.activa;
  if (a) {
    const tr = a.uid === "h" ? $(".matrix thead tr") : $(`.matrix tbody tr[data-uid="${a.uid}"]`);
    const el = tr && !tr.hidden && ($(`[data-nav="${a.nav}"]`, tr) || $("[data-nav]", tr));
    if (el) { marcarActiva(el); return; }
  }
  asegurarTab();
}
function enfocar(el) {
  marcarActiva(el);
  el.focus({ preventScroll: true });
  mostrarCelda(el);
}
// Lleva la celda a la vista sin que quede tapada por la columna o el encabezado fijos.
function mostrarCelda(el) {
  const w = $("#mx-scroll");
  const cell = el.closest("td, th");
  if (!w || !cell) return;
  if (!cell.classList.contains("u")) {
    const sticky = $("th.u").getBoundingClientRect().width, margen = 52; // degradé + flecha
    const l = cell.offsetLeft, r = l + cell.offsetWidth, max = w.scrollWidth - w.clientWidth;
    if (l < w.scrollLeft + sticky + (w.scrollLeft > 0 ? margen : 0)) w.scrollLeft = Math.max(0, l - sticky - margen);
    else if (r > w.scrollLeft + w.clientWidth - (w.scrollLeft < max ? margen : 0)) w.scrollLeft = Math.min(max, r - w.clientWidth + margen);
  }
  const tr = el.closest("tr");
  if (tr.parentElement.tagName === "TBODY") {
    const head = $(".matrix thead").getBoundingClientRect().height;
    const t = tr.offsetTop, b = t + tr.offsetHeight;
    if (t < w.scrollTop + head) w.scrollTop = t - head;
    else if (b > w.scrollTop + w.clientHeight) w.scrollTop = b - w.clientHeight;
  }
  const rr = el.getBoundingClientRect();
  if (rr.bottom > window.innerHeight) window.scrollBy(0, rr.bottom - window.innerHeight + 12);
  else if (rr.top < 70) window.scrollBy(0, rr.top - 70);
}

function teclaGrilla(e) {
  const el = e.target.closest("[data-nav]");
  if (!el || e.target !== el) return;
  const k = e.key;
  if (el.classList.contains("rc") && (k === "F2" || (e.altKey && k === "ArrowDown"))) { e.preventDefault(); abrirMenuRol(el); return; }
  const g = grilla();
  let r = g.findIndex((fila) => fila.includes(el)), c = Number(el.dataset.nav);
  if (r < 0) return;
  const ultimaCol = (fila) => fila.length - 1;
  let dr = 0, dc = 0;
  switch (k) {
    case "ArrowRight": dc = 1; break;
    case "ArrowLeft": dc = -1; break;
    case "ArrowDown": dr = 1; break;
    case "ArrowUp": dr = -1; break;
    case "PageDown": dr = 10; break;
    case "PageUp": dr = -10; break;
    case "Home": if (e.ctrlKey) r = 0; c = 0; break;
    case "End": if (e.ctrlKey) r = g.length - 1; c = ultimaCol(g[r]); break;
    default: return;
  }
  e.preventDefault();
  if (dr) r = Math.max(0, Math.min(g.length - 1, r + dr));
  const fila = g[r];
  let dest = null;
  if (dc) {
    for (let x = c + dc; x >= 0 && x < fila.length; x += dc) if (fila[x]) { dest = fila[x]; break; }
    if (!dest) return;
  } else {
    dest = fila[c];
    for (let d = 1; !dest && d < fila.length + c; d++) dest = fila[c - d] || fila[c + d];
  }
  if (dest) enfocar(dest);
}

// ================================================================ eventos delegados
function cablearGlobal() {
  const root = $(".panel", H.root); // muere con la vista: no se acumulan listeners entre entradas
  root.addEventListener("click", (e) => {
    const rc = e.target.closest(".rc");
    if (rc) { ocultarTip(); return abrirMenuRol(rc); }
    const appcol = e.target.closest(".appcol");
    if (appcol) return H.openAppEditor(appcol.dataset.app);
    const rm = e.target.closest(".rowmenu-btn");
    if (rm) return abrirMenuFila(rm);
    const hb = e.target.closest(".hist-btn");
    if (hb) return abrirHistorial(hb, Number(hb.dataset.uid), hb.dataset.app);
    const retry = e.target.closest(".rc-retry");
    if (retry) { const fn = S.reintentos.get(clave(retry.dataset.uid, retry.dataset.app)); if (fn) fn(); }
  });
  root.addEventListener("change", (e) => {
    const sel = e.target.closest("select.role");
    if (sel) {
      const uid = Number(sel.dataset.uid), slug = sel.dataset.app;
      return cambiar(uid, slug, sel.value || null, { foco: sel });
    }
    const cb = e.target.closest(".mx-check");
    if (!cb) return;
    if (cb.id === "mx-all") {
      const vis = filasVisibles().map((tr) => Number(tr.dataset.uid));
      if (cb.checked) vis.forEach((id) => S.sel.add(id)); else vis.forEach((id) => S.sel.delete(id));
    } else {
      const id = Number(cb.dataset.uid);
      if (cb.checked) S.sel.add(id); else S.sel.delete(id);
    }
    sincronizarSeleccion();
  });
}

// ================================================================ popovers (flotan sobre todo)
let POP = null;
function abrirPop(anchor, el, { foco, alCerrar } = {}) {
  cerrarPop();
  ocultarTip();
  el.classList.add("pop");
  document.body.appendChild(el);
  const r = anchor.getBoundingClientRect();
  POP = { el, anchor, alCerrar, x: r.left, y: r.top };
  anchor.setAttribute("aria-expanded", "true");
  ubicar(el, anchor);
  (foco || el).focus({ preventScroll: true });
}
function cerrarPop(volver) {
  if (!POP) return;
  const p = POP;
  POP = null;
  p.el.remove();
  p.anchor.setAttribute("aria-expanded", "false");
  p.alCerrar?.();
  if (volver && p.anchor.isConnected) p.anchor.focus({ preventScroll: true });
}
function ubicar(el, anchor) {
  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth, h = el.offsetHeight;
  let top = r.bottom + 6;
  if (top + h > window.innerHeight - 8 && r.top - 6 - h > 8) top = r.top - 6 - h;
  top = Math.max(8, Math.min(top, window.innerHeight - h - 8));
  let left = Math.min(r.left, window.innerWidth - w - 8);
  el.style.top = `${Math.round(top)}px`;
  el.style.left = `${Math.round(Math.max(8, left))}px`;
}
(function popGlobal() {
  document.addEventListener("mousedown", (e) => {
    if (POP && !POP.el.contains(e.target) && !POP.anchor.contains(e.target)) cerrarPop();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && POP) { e.stopPropagation(); cerrarPop(true); }
    if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.target.closest?.("input, textarea, select") && $("#mx-q") && !document.querySelector(".modal-back:not(.hidden)")) {
      e.preventDefault(); $("#mx-q").focus();
    }
  }, true);
  // Se cierra si el scroll movió lo que está debajo del popover (no por scrolls que no lo
  // afectan, ni por el que quedó pendiente de la navegación con el teclado).
  window.addEventListener("scroll", (e) => {
    if (POP && !POP.el.contains(e.target)) {
      const r = POP.anchor.getBoundingClientRect();
      if (Math.abs(r.left - POP.x) > 2 || Math.abs(r.top - POP.y) > 2) cerrarPop();
    }
    if (TIP.btn) {
      const r = TIP.btn.getBoundingClientRect();
      if (Math.abs(r.left - TIP.x) > 2 || Math.abs(r.top - TIP.y) > 2) ocultarTip();
    }
  }, true);
  window.addEventListener("resize", () => { cerrarPop(); ocultarTip(); });
})();

// ---- menú de rol de una celda (listbox) ----
function abrirMenuRol(btn) {
  if (POP?.anchor === btn) return cerrarPop(true);
  const uid = Number(btn.dataset.uid), slug = btn.dataset.app;
  const u = userById(uid), a = appBySlug(slug);
  if (!u || !a) return;
  const actual = u.roles[slug] || null;
  const propio = slug === HUB && uid === S.me && actual === "admin";
  const ops = [null, ...a.roles];
  const el = document.createElement("div");
  el.className = "rolemenu";
  el.innerHTML = `
    <div class="pop-tit">${esc(nombre(u))}<span> · ${esc(a.name)}</span></div>
    <div class="rm-list" role="listbox" tabindex="0" aria-label="Rol de ${esc(nombre(u))} en ${esc(a.name)}">
      ${ops.map((ro, i) => {
        const n = nivelRol(a.roles, ro), dis = propio && ro !== "admin";
        return `<div class="rm-op" role="option" id="rm-op-${i}" data-i="${i}" data-n="${n}" aria-selected="${ro === actual}"${dis ? ` aria-disabled="true"` : ""}>
          ${ro ? barras : `<span class="rm-sin" aria-hidden="true">—</span>`}<span class="rm-t">${ro ? esc(ro) : "Sin acceso"}</span>
          <span class="rm-n">${ro ? NOMBRE_NIVEL[n] : ""}${ro && esRolAlto(a.roles, ro) && ro !== actual ? " · pide confirmar" : ""}</span>
          <span class="rm-ok">${ro === actual ? IC.tilde : ""}</span></div>`;
      }).join("")}
    </div>
    ${propio ? `<p class="pop-nota">${MSJ_PROPIO}</p>` : ""}
    <div class="pop-sep"></div>
    <button type="button" class="menu-item rm-hist">${IC.reloj}<span>Ver historial de esta celda</span></button>`;
  const list = $(".rm-list", el);
  const opsEl = $$(".rm-op", el);
  let i = Math.max(0, ops.indexOf(actual));
  const marcar = (k) => {
    i = (k + opsEl.length) % opsEl.length;
    opsEl.forEach((o, j) => o.classList.toggle("act", j === i));
    list.setAttribute("aria-activedescendant", opsEl[i].id);
    const o = opsEl[i];
    if (o.offsetTop < list.scrollTop) list.scrollTop = o.offsetTop;
    else if (o.offsetTop + o.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = o.offsetTop + o.offsetHeight - list.clientHeight;
  };
  const elegir = (k) => {
    const o = opsEl[k];
    if (o.getAttribute("aria-disabled") === "true") { H.toast(MSJ_PROPIO, true); return; }
    cerrarPop(true);
    cambiar(uid, slug, ops[k], { foco: btn });
  };
  list.addEventListener("keydown", (e) => {
    const k = e.key;
    if (k === "ArrowDown") { e.preventDefault(); marcar(i + 1); }
    else if (k === "ArrowUp") { e.preventDefault(); marcar(i - 1); }
    else if (k === "Home") { e.preventDefault(); marcar(0); }
    else if (k === "End") { e.preventDefault(); marcar(opsEl.length - 1); }
    else if (k === "Enter" || k === " ") { e.preventDefault(); elegir(i); }
    else if (k === "Tab" && !e.shiftKey) { e.preventDefault(); $(".rm-hist", el).focus(); }
    else if (/^\w$/.test(k)) {
      const j = ops.findIndex((ro, x) => x > i && sinTildes(ro || "sin acceso").startsWith(sinTildes(k)));
      const j2 = j >= 0 ? j : ops.findIndex((ro) => sinTildes(ro || "sin acceso").startsWith(sinTildes(k)));
      if (j2 >= 0) marcar(j2);
    }
  });
  el.addEventListener("click", (e) => {
    const o = e.target.closest(".rm-op");
    if (o) elegir(Number(o.dataset.i));
  });
  el.addEventListener("mousemove", (e) => { const o = e.target.closest(".rm-op"); if (o && Number(o.dataset.i) !== i) marcar(Number(o.dataset.i)); });
  $(".rm-hist", el).onclick = () => { cerrarPop(); abrirHistorial(btn, uid, slug); };
  $(".rm-hist", el).addEventListener("keydown", (e) => { if (e.key === "Tab") { e.preventDefault(); list.focus(); } });
  abrirPop(btn, el, { foco: list });
  marcar(i);
}

// ---- menú "…" de una persona ----
function abrirMenuFila(btn) {
  if (POP?.anchor === btn) return cerrarPop(true);
  const u = userById(btn.dataset.uid);
  if (!u) return;
  const yo = u.id === S.me;
  const el = document.createElement("div");
  el.className = "menu fila-menu";
  el.setAttribute("role", "menu");
  el.setAttribute("aria-label", `Acciones de ${nombre(u)}`);
  el.innerHTML = `
    <button type="button" class="menu-item" role="menuitem" data-act="copiar">Copiar accesos de…</button>
    <button type="button" class="menu-item" role="menuitem" data-act="resetpw">Reset contraseña</button>
    ${u.totp ? `<button type="button" class="menu-item" role="menuitem" data-act="reset2fa">Reset 2FA</button>` : ""}
    <div class="menu-sep" role="separator"></div>
    <button type="button" class="menu-item${u.status === "active" ? " peligro" : ""}" role="menuitem" data-act="status"
      ${yo ? `aria-disabled="true" title="No podés deshabilitar tu propio usuario"` : ""}>${u.status === "active" ? "Deshabilitar usuario" : "Habilitar usuario"}</button>`;
  const items = $$("[role=menuitem]", el);
  el.addEventListener("keydown", (e) => {
    const k = items.indexOf(document.activeElement);
    if (e.key === "ArrowDown") { e.preventDefault(); items[(k + 1) % items.length].focus(); }
    if (e.key === "ArrowUp") { e.preventDefault(); items[(k - 1 + items.length) % items.length].focus(); }
    if (e.key === "Tab") { e.preventDefault(); cerrarPop(true); }
  });
  el.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    if (b.getAttribute("aria-disabled") === "true") return H.toast(b.title, true);
    cerrarPop(true);
    const act = b.dataset.act;
    if (act === "copiar") return copiarAccesos(u, btn);
    if (act === "resetpw") {
      const r = await api("POST", `/api/admin/users/${u.id}/reset-password`);
      if (!r.ok) return H.toast(r.data.error || "Error", true);
      return H.showLinkDialog("Restablecer contraseña", r.data.link, r.data.emailed, u.email);
    }
    if (act === "reset2fa") {
      const ok = await confirmar({ titulo: `¿Resetear el 2FA de ${nombre(u)}?`, html: `<p>Va a tener que volver a activarlo con su app de autenticación.</p>`, ok: "Resetear 2FA" });
      if (!ok) return;
      const r = await api("POST", `/api/admin/users/${u.id}/reset-2fa`);
      if (!r.ok) return H.toast(r.data.error || "Error", true);
      H.toast("2FA reseteado");
      return recargar();
    }
    if (act === "status") {
      const next = u.status === "active" ? "disabled" : "active";
      if (next === "disabled") {
        const ok = await confirmar({ titulo: `¿Deshabilitar a ${nombre(u)}?`, html: `<p>No va a poder entrar a ninguna app de la suite hasta que lo vuelvas a habilitar. Sus accesos quedan guardados.</p>`, ok: "Deshabilitar", peligro: true });
        if (!ok) return;
      }
      const r = await api("PUT", `/api/admin/users/${u.id}/status`, { status: next });
      if (!r.ok) return H.toast(r.data.error || "Error", true);
      H.toast(next === "active" ? `${nombre(u)} quedó habilitado` : `${nombre(u)} quedó deshabilitado`);
      return recargar();
    }
  });
  abrirPop(btn, el, { foco: items[0] });
}

// ================================================================ historial de una celda
async function cargarHistorial(uid, slug) {
  const k = clave(uid, slug);
  if (S.hist.has(k)) return S.hist.get(k);
  const p = api("GET", `/api/admin/users/${uid}/history?app=${encodeURIComponent(slug)}`).then((r) => {
    if (!r.ok) { S.hist.delete(k); throw new Error(r.data.error || "No se pudo leer el historial"); }
    return r.data;
  });
  S.hist.set(k, p);
  return p;
}

function htmlHistorial(d, a, max) {
  const act = d.actual
    ? `<div class="h-hoy">Hoy: ${chip(a, d.actual.role)} <span>desde ${esc(cuando(d.actual.granted))}${d.actual.granted_by ? `, lo dio ${esc(d.actual.granted_by)}` : ""}</span></div>`
    : `<div class="h-hoy">Hoy: ${chip(a, null)} <span>sin acceso</span></div>`;
  const ev = d.eventos.slice(0, max);
  const lista = ev.length
    ? `<ol class="h-lista">${ev.map((e) => `
        <li><span class="h-cambio">${e.antes === undefined ? (e.despues ? `asignó ${chip(a, e.despues)}` : "quitó el acceso") : `${chip(a, e.antes)}<span class="h-fl">${IC.flecha}</span>${chip(a, e.despues)}`}</span>
          <span class="h-quien"><b>${esc(e.actor)}</b> · <time datetime="${esc(e.ts)}" title="${esc(fechaLarga(e.ts))}">${esc(cuando(e.ts))}</time>${VIA[e.via] ? ` · ${VIA[e.via]}` : ""}</span></li>`).join("")}</ol>`
    : `<p class="h-nada">No hay cambios registrados para este acceso.</p>`;
  const mas = d.eventos.length > max ? `<p class="h-mas">y ${d.eventos.length - max} cambios más</p>` : "";
  return act + lista + mas;
}

// Al apoyar el mouse un rato en una celda: un resumen (los 4 últimos cambios).
const TIP = { el: null, timer: null, btn: null, x: 0, y: 0 };
function programarTip(btn) {
  if (TIP.btn === btn || POP) return;
  ocultarTip();
  TIP.btn = btn;
  const r0 = btn.getBoundingClientRect();
  TIP.x = r0.left; TIP.y = r0.top;
  TIP.timer = setTimeout(async () => {
    const uid = Number(btn.dataset.uid), slug = btn.dataset.app, a = appBySlug(slug), u = userById(uid);
    let d;
    try { d = await cargarHistorial(uid, slug); } catch { return; }
    if (TIP.btn !== btn || POP || !btn.isConnected) return;
    const el = document.createElement("div");
    el.className = "pop histpop tip";
    el.setAttribute("role", "tooltip");
    el.id = "mx-tip";
    el.innerHTML = `<div class="pop-tit">Historial · ${esc(nombre(u))}<span> · ${esc(a.name)}</span></div>${htmlHistorial(d, a, 4)}`;
    document.body.appendChild(el);
    btn.setAttribute("aria-describedby", "mx-tip");
    ubicar(el, btn);
    TIP.el = el;
  }, 650);
}
function ocultarTip() {
  clearTimeout(TIP.timer);
  TIP.el?.remove();
  TIP.btn?.removeAttribute("aria-describedby");
  TIP.el = null; TIP.btn = null;
}

// Con el botón (menú de la celda o reloj de la tarjeta): el historial completo, con foco.
async function abrirHistorial(anchor, uid, slug) {
  const a = appBySlug(slug), u = userById(uid);
  const el = document.createElement("div");
  el.className = "histpop";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", `Historial de ${nombre(u)} en ${a.name}`);
  el.tabIndex = -1;
  el.innerHTML = `<div class="pop-tit">Historial · ${esc(nombre(u))}<span> · ${esc(a.name)}</span>
    <button type="button" class="pop-x" aria-label="Cerrar">&#10005;</button></div><div class="h-cuerpo"><p class="h-nada">Cargando…</p></div>`;
  $(".pop-x", el).onclick = () => cerrarPop(true);
  abrirPop(anchor, el, { foco: el });
  try {
    const d = await cargarHistorial(uid, slug);
    if (POP?.el !== el) return;
    $(".h-cuerpo", el).innerHTML = htmlHistorial(d, a, 25);
  } catch (err) {
    $(".h-cuerpo", el).innerHTML = `<p class="h-nada err">${esc(err.message)}</p>`;
  }
  ubicar(el, anchor);
}

// ================================================================ cambiar una celda
function pintarCelda(uid, slug) {
  const u = userById(uid), a = appBySlug(slug);
  if (!u || !a) return;
  const rol = u.roles[slug] || null, n = nivelRol(a.roles, rol);
  $$(`.rc[data-uid="${uid}"][data-app="${CSS.escape(slug)}"]`).forEach((b) => {
    b.dataset.n = n;
    $(".rc-t", b).textContent = rol || "—";
    b.setAttribute("aria-label", etiquetaCelda(a, rol));
    if (rol) b.removeAttribute("title"); else b.title = "Sin acceso";
  });
  $$(`select.role[data-uid="${uid}"][data-app="${CSS.escape(slug)}"]`).forEach((s) => {
    s.innerHTML = opcionesSelect(u, a);
    s.value = rol || "";
    s.dataset.n = n;
  });
  $$(`[data-cnt="${CSS.escape(slug)}"]`).forEach((c) => { c.textContent = personas(conAcceso(slug)); });
  const ap = $(`.appcol[data-app="${CSS.escape(slug)}"]`);
  if (ap) ap.setAttribute("aria-label", `${a.name}: ${personas(conAcceso(slug))} con acceso. Editar app`);
}

const ST_HTML = {
  guardando: `<span class="st-spin" aria-hidden="true"></span>`,
  guardado: IC.ok,
};
function estadoCelda(uid, slug, st) {
  $$(`.rc-st[data-uid="${uid}"][data-app="${CSS.escape(slug)}"]`).forEach((s) => {
    s.dataset.st = st || "";
    s.innerHTML = st === "error"
      ? `<button type="button" class="rc-retry" data-uid="${uid}" data-app="${esc(slug)}" aria-label="No se pudo guardar. Reintentar" title="No se pudo guardar. Reintentar">!</button>`
      : ST_HTML[st] || "";
    s.closest(".cw, .rolerow-ctl")?.classList.toggle("con-error", st === "error");
  });
  if (st === "guardado") {
    const tok = Symbol();
    estadoCelda.tok.set(clave(uid, slug), tok);
    setTimeout(() => { if (estadoCelda.tok.get(clave(uid, slug)) === tok) estadoCelda(uid, slug, ""); }, 1800);
  } else estadoCelda.tok.delete(clave(uid, slug));
}
estadoCelda.tok = new Map();

function setRol(u, slug, rol) { if (rol) u.roles[slug] = rol; else delete u.roles[slug]; }

// Guarda un cambio de una celda: confirmación si es un rol alto, guardado optimista con su
// indicador, Deshacer en el aviso y reintento si se cortó la conexión.
async function cambiar(uid, slug, nuevo, { via = "celda", confirmado = false, foco = null, antes: antesDado } = {}) {
  const u = userById(uid), a = appBySlug(slug);
  if (!u || !a) return;
  nuevo = nuevo || null;
  const antes = antesDado !== undefined ? antesDado : (u.roles[slug] || null);
  if (antes === nuevo && antesDado === undefined) return;
  if (slug === HUB && uid === S.me && antes === "admin" && nuevo !== "admin") {
    H.toast(MSJ_PROPIO, true); pintarCelda(uid, slug); return;
  }
  if (nuevo && esRolAlto(a.roles, nuevo) && !confirmado) {
    const ok = await confirmar({
      titulo: `¿Dar ${nuevo} de ${a.name} a ${nombre(u)}?`,
      html: `<p>${chip(a, nuevo)} es un rol alto de ${esc(a.name)}: ${slug === HUB ? "puede administrar Lockatus entero, dar y sacar accesos a todas las apps." : "suele poder administrar la app y a otras personas."}</p>
        <p class="cf-de">Hoy: ${chip(a, antes)} <span class="h-fl">${IC.flecha}</span> ${chip(a, nuevo)}</p>`,
      ok: `Sí, dar ${nuevo}`,
    });
    if (!ok) { pintarCelda(uid, slug); foco?.focus({ preventScroll: true }); return; }
    confirmado = true;
  }
  setRol(u, slug, nuevo);
  pintarCelda(uid, slug);
  estadoCelda(uid, slug, "guardando");
  S.reintentos.delete(clave(uid, slug));
  const r = await api("PUT", `/api/admin/users/${uid}/role`, { app: slug, role: nuevo || "", antes, confirm: confirmado, via });
  const yaEstaba = r.status === 409 && r.data.desactualizado && (r.data.actual || null) === nuevo; // se guardó y se perdió la respuesta
  if (r.ok || yaEstaba) {
    S.hist.delete(clave(uid, slug));
    S.avisosError.get(clave(uid, slug))?.remove();
    S.avisosError.delete(clave(uid, slug));
    estadoCelda(uid, slug, "guardado");
    const que = nuevo ? `${a.name}: ${nuevo}` : `${a.name}: sin acceso`;
    anunciar(`Guardado. ${nombre(u)}, ${que}.`);
    if (via === "deshacer") H.toast(nuevo ? `Deshecho: ${nombre(u)} vuelve a ${nuevo} en ${a.name}` : `Deshecho: ${nombre(u)} vuelve a no tener acceso a ${a.name}`);
    else H.toast(`${nombre(u)} · ${que}`, false, { texto: "Deshacer", fn: () => cambiar(uid, slug, antes, { via: "deshacer", confirmado: true, antes: nuevo }) });
    return;
  }
  if (r.status === 0 || r.status >= 500) {
    // No se sabe si llegó: queda a la vista lo que elegiste, con el error y el reintento.
    estadoCelda(uid, slug, "error");
    S.reintentos.set(clave(uid, slug), () => cambiar(uid, slug, nuevo, { via: "reintento", confirmado, antes, foco }));
    S.avisosError.get(clave(uid, slug))?.remove();
    S.avisosError.set(clave(uid, slug), H.toast(`No se pudo guardar ${a.name} de ${nombre(u)}. Tocá el signo de la celda para reintentar.`, true));
    return;
  }
  if (r.status === 409 && r.data.need_confirm) {
    setRol(u, slug, antes); pintarCelda(uid, slug); estadoCelda(uid, slug, "");
    return cambiar(uid, slug, nuevo, { via, foco });
  }
  if (r.status === 401) return H.salir();
  // Lo rechazó el servidor (regla, rol inválido o cambió mientras tanto): vuelve a lo que hay.
  setRol(u, slug, r.data.desactualizado ? (r.data.actual || null) : antes);
  pintarCelda(uid, slug);
  estadoCelda(uid, slug, "");
  H.toast(r.data.desactualizado ? `Ese acceso había cambiado: ahora es ${r.data.actual || "sin acceso"}. Revisalo.` : (r.data.error || "No se pudo guardar"), true);
}

// ================================================================ modales
function abrirModal({ titulo, html, acciones, ancho, alCerrar }) {
  const back = document.createElement("div");
  back.className = "modal-back";
  const volverA = document.activeElement;
  back.innerHTML = `
    <div class="modal-card${ancho ? " ancho" : ""}" role="dialog" aria-modal="true" aria-labelledby="mx-modal-tit">
      <button class="modal-x" type="button" aria-label="Cerrar">&#10005;</button>
      <h3 class="modal-tit" id="mx-modal-tit">${esc(titulo)}</h3>
      <div class="modal-cuerpo">${html}</div>
      <div class="modal-acciones">${acciones}</div>
    </div>`;
  const cerrar = (valor) => {
    if (!back.isConnected) return;
    back.remove();
    document.removeEventListener("keydown", onKey, true);
    alCerrar?.(valor);
    if (volverA?.isConnected) volverA.focus({ preventScroll: true });
  };
  const onKey = (e) => {
    if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); cerrar(false); }
    if (e.key === "Tab") {
      const f = $$("button:not([disabled]), select, input, [tabindex='0']", back).filter((x) => x.offsetParent !== null);
      if (!f.length) return;
      const i = f.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    }
  };
  document.addEventListener("keydown", onKey, true);
  back.addEventListener("mousedown", (e) => { if (e.target === back) cerrar(false); });
  $(".modal-x", back).onclick = () => cerrar(false);
  document.body.appendChild(back);
  return { back, cerrar };
}

function confirmar({ titulo, html, ok, peligro }) {
  return new Promise((resolve) => {
    const { back, cerrar } = abrirModal({
      titulo, html,
      acciones: `<button type="button" class="ghost" data-no>Cancelar</button><button type="button" data-si class="${peligro ? "btn-peligro" : ""}">${esc(ok)}</button>`,
      alCerrar: (v) => resolve(v === true),
    });
    $("[data-no]", back).onclick = () => cerrar(false);
    $("[data-si]", back).onclick = () => cerrar(true);
    $("[data-no]", back).focus();
  });
}

// Vista previa de varios cambios (en bloque o copia): qué cambia, qué se saltea y por qué.
function htmlVistaPrevia(d) {
  const items = d.items || [];
  const cambian = items.filter((i) => i.estado === "cambia");
  const otros = items.filter((i) => ["bloqueado", "invalido", "desactualizado"].includes(i.estado));
  const iguales = items.filter((i) => i.estado === "igual").length;
  const altos = cambian.filter((i) => i.alto).length;
  const unaPersona = new Set(items.map((i) => i.uid)).size === 1;
  const fila = (i) => {
    const a = appBySlug(i.app) || { name: i.appNombre, roles: [] };
    const quien = unaPersona ? `<b>${esc(a.name)}</b>` : `<b>${esc(i.nombre || i.email)}</b><span>${esc(a.name)}</span>`;
    return `<li class="pv-it ${i.estado}"><span class="pv-quien">${quien}</span>
      <span class="pv-cambio">${chip(a, i.antes)}<span class="h-fl">${IC.flecha}</span>${chip(a, i.despues)}${i.alto ? `<span class="pv-alto">rol alto</span>` : ""}</span>
      ${i.motivo ? `<span class="pv-motivo">${esc(i.motivo)}</span>` : ""}</li>`;
  };
  const resumen = [
    cambian.length ? `<b>${cambian.length === 1 ? "1 acceso cambia" : `${cambian.length} accesos cambian`}</b>` : "<b>No hay nada para cambiar</b>",
    altos ? `${altos === 1 ? "1 da" : `${altos} dan`} un rol alto` : "",
    otros.length ? `${otros.length} no se ${otros.length === 1 ? "puede" : "pueden"} aplicar` : "",
    iguales ? `${iguales} ya ${iguales === 1 ? "estaba" : "estaban"} así` : "",
  ].filter(Boolean).join(" · ");
  return `<p class="pv-resumen">${resumen}</p>
    ${cambian.length ? `<ul class="pv-lista">${cambian.map(fila).join("")}</ul>` : ""}
    ${otros.length ? `<p class="pv-sub">No se aplican</p><ul class="pv-lista">${otros.map(fila).join("")}</ul>` : ""}`;
}

async function vistaPrevia({ titulo, cargar, aplicar, extraHtml = "", alAbrir, alTerminar }) {
  const { back, cerrar } = abrirModal({
    titulo, ancho: true,
    html: `${extraHtml}<div class="pv" aria-live="polite"><p class="h-nada">Calculando los cambios…</p></div>`,
    acciones: `<button type="button" class="ghost" data-no>Cancelar</button><button type="button" data-si disabled>Aplicar</button>`,
  });
  const si = $("[data-si]", back);
  let items = [];
  const refrescar = async () => {
    si.disabled = true;
    $(".pv", back).innerHTML = `<p class="h-nada">Calculando los cambios…</p>`;
    const r = await cargar(back);
    if (!back.isConnected) return;
    if (!r.ok) { $(".pv", back).innerHTML = `<p class="h-nada err">${esc(r.data.error || "No se pudo calcular")}</p>`; return; }
    items = (r.data.items || []).filter((i) => i.estado === "cambia");
    $(".pv", back).innerHTML = htmlVistaPrevia(r.data);
    si.disabled = items.length === 0;
    si.textContent = items.length ? `Aplicar ${items.length === 1 ? "1 cambio" : `${items.length} cambios`}` : "Aplicar";
  };
  $("[data-no]", back).onclick = () => cerrar(false);
  si.onclick = async () => {
    si.disabled = true; si.textContent = "Aplicando…";
    const r = await aplicar(items, back);
    if (!r.ok) { H.toast(r.data.error || "No se pudieron aplicar los cambios", true); return refrescar(); }
    cerrar(true);
    alTerminar?.();
    const hechos = (r.data.items || []).filter((i) => i.estado === "cambia");
    const salteados = (r.data.items || []).length - hechos.length - (r.data.iguales || 0);
    const msg = `${hechos.length === 1 ? "Se aplicó 1 cambio" : `Se aplicaron ${hechos.length} cambios`}${salteados > 0 ? ` (${salteados} salteados)` : ""}`;
    const inverso = hechos.map((i) => ({ uid: i.uid, app: i.app, role: i.antes, antes: i.despues }));
    H.toast(msg, false, hechos.length ? { texto: "Deshacer", fn: () => deshacerBloque(inverso) } : null);
    anunciar(msg);
    recargar();
  };
  alAbrir?.(back, refrescar);
  $("[data-no]", back).focus();
  refrescar();
}

async function deshacerBloque(cambios) {
  const r = await api("POST", "/api/admin/roles/bulk", { cambios, confirm: true, via: "deshacer" });
  if (!r.ok) return H.toast(r.data.error || "No se pudo deshacer", true);
  const n = r.data.aplicados;
  H.toast(n === cambios.length ? "Listo, se deshicieron los cambios" : `Se deshicieron ${n} de ${cambios.length} (el resto había cambiado)`, n !== cambios.length);
  recargar();
}

// Copiar los accesos de otra persona a `dest` (desde el menú de su fila).
function copiarAccesos(dest) {
  const otros = S.users.filter((u) => u.id !== dest.id).sort((x, y) => sinTildes(nombre(x)).localeCompare(sinTildes(nombre(y))));
  if (!otros.length) return H.toast("No hay otra persona de quien copiar", true);
  vistaPrevia({
    titulo: `Copiar accesos a ${nombre(dest)}`,
    extraHtml: `
      <label class="fld"><span>Copiar los accesos de</span>
        <select id="cp-de">${otros.map((u) => `<option value="${u.id}">${esc(nombre(u))} · ${esc(u.email)}</option>`).join("")}</select></label>
      <label class="cp-conservar"><input type="checkbox" id="cp-conservar" /> <span>Conservar los accesos que ${esc(nombre(dest))} ya tiene y la otra persona no (sólo sumar)</span></label>`,
    cargar: (back) => api("POST", `/api/admin/users/${dest.id}/copy-from`, { from: Number($("#cp-de", back).value), conservar: $("#cp-conservar", back).checked, dry_run: true }),
    // `esperado`: lo que mostró la vista previa; si algo cambió mientras tanto, el servidor no aplica.
    aplicar: (items, back) => api("POST", `/api/admin/users/${dest.id}/copy-from`, { from: Number($("#cp-de", back).value), conservar: $("#cp-conservar", back).checked, confirm: true,
      esperado: items.map((i) => ({ app: i.app, role: i.despues })) }),
    alAbrir: (back, refrescar) => {
      $("#cp-de", back).onchange = refrescar;
      $("#cp-conservar", back).onchange = refrescar;
      setTimeout(() => $("#cp-de", back).focus(), 0);
    },
  });
}
