// app.js — front del hub: login (password + 2FA) y el panel de accesos (la matriz quién×sistema→rol,
// que vive en accesos.js).
import { viewAccesos } from "/accesos.js";
const app = document.getElementById("app");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const initials = (s) => (s || "?").trim().split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");

async function api(method, path, body) {
  const r = await fetch(path, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  let data = {}; try { data = await r.json(); } catch { /* sin cuerpo */ }
  return { status: r.status, ok: r.ok, data };
}

// Avisos abajo al centro, apilados. Con `accion` ({texto, fn}) suman un botón (p. ej. Deshacer)
// y duran más; el tiempo se frena mientras el mouse o el foco están encima.
function toast(msg, bad, accion) {
  let box = document.getElementById("toasts");
  if (!box) {
    box = document.createElement("div");
    box.id = "toasts"; box.className = "toasts";
    document.body.appendChild(box);
  }
  const t = document.createElement("div");
  t.className = "toast" + (bad ? " bad" : "");
  t.setAttribute("role", bad ? "alert" : "status");
  const txt = document.createElement("span");
  txt.textContent = msg;
  t.appendChild(txt);
  if (accion) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "toast-accion"; b.textContent = accion.texto;
    b.onclick = () => { t.remove(); accion.fn(); };
    t.appendChild(b);
  }
  while (box.children.length >= 3) box.firstElementChild.remove();
  box.appendChild(t);
  const dura = accion ? 9000 : 2600;
  let timer = setTimeout(() => t.remove(), dura);
  const frenar = () => clearTimeout(timer);
  const seguir = () => { clearTimeout(timer); timer = setTimeout(() => t.remove(), 2500); };
  t.addEventListener("mouseenter", frenar); t.addEventListener("focusin", frenar);
  t.addEventListener("mouseleave", seguir); t.addEventListener("focusout", seguir);
  return t;
}

// Modal que muestra el LINK de alta/reset con botón copiar (y, si se mandó por email, el aviso).
// Reemplaza la vieja muestra de la contraseña temporal: el admin nunca ve la clave.
function showLinkDialog(title, link, emailed, email) {
  const back = document.createElement("div");
  back.className = "modal-back";
  const mailed = emailed ? `<p class="link-mailed">Enviado por email a ${esc(email)}.</p>` : "";
  back.innerHTML = `
    <div class="modal-card">
      <button class="modal-x" type="button" aria-label="Cerrar">&#10005;</button>
      <h3 class="modal-tit">${esc(title)}</h3>
      <div class="modal-cuerpo">
        <p>Compartí este enlace de un solo uso con la persona. Abriéndolo define su propia contraseña. Vence pronto.</p>
        ${mailed}
        <div class="link-row">
          <input class="link-input" type="text" readonly value="${esc(link)}" aria-label="Enlace de alta/reset" />
          <button class="link-copy" type="button">Copiar</button>
        </div>
      </div>
    </div>`;
  const close = () => back.remove();
  back.querySelector(".modal-x").onclick = close;
  back.addEventListener("click", (e) => { if (e.target === back) close(); });
  const input = back.querySelector(".link-input");
  back.querySelector(".link-copy").onclick = async () => {
    try { await navigator.clipboard.writeText(link); }
    catch { input.focus(); input.select(); document.execCommand?.("copy"); }
    toast("Enlace copiado");
  };
  document.body.appendChild(back);
  input.focus(); input.select();
}

// ---------- ojito mostrar/ocultar contraseña (login + cambio de clave) ----------
// El ojo se dibuja UNA vez y el estado "oculto" sólo le agrega la barra
// encima. Antes eran dos dibujos distintos: la almendra cerrada se convertía
// en dos arcos abiertos, la pupila en un arco partido y el centro óptico se
// corría de y=12 a y=11. El botón no se movía --medido: mismo `right` y mismo
// centro en los dos estados-- pero el ícono se transformaba entero, y eso se
// ve como si saltara. Compartiendo el trazo, al mostrar la clave sólo aparece
// la barra: nada se mueve.
const EYE_BODY = `<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>`;
const EYE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${EYE_BODY}</svg>`;
const EYE_OFF_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${EYE_BODY}<line x1="3" y1="3" x2="21" y2="21"/></svg>`;
function eyeify(root) {
  (root || document).querySelectorAll('input[type="password"]').forEach((inp) => {
    if (inp.dataset.eye || inp.closest(".pass-wrap")) return;
    inp.dataset.eye = "1";
    const w = document.createElement("span"); w.className = "pass-wrap";
    inp.parentNode.insertBefore(w, inp); w.appendChild(inp);
    const b = document.createElement("button");
    b.type = "button"; b.className = "pass-toggle"; b.tabIndex = -1;
    b.setAttribute("aria-label", "Mostrar u ocultar la contraseña");
    b.innerHTML = EYE_SVG;
    b.addEventListener("click", () => {
      const s = inp.type === "password";
      inp.type = s ? "text" : "password";
      b.innerHTML = s ? EYE_OFF_SVG : EYE_SVG;
      inp.focus();
    });
    w.appendChild(b);
  });
}

// ---------- chrome: topbar + menú kebab + modal "Acerca de" ----------
const topbar = document.getElementById("topbar");
const hdrMenu = document.getElementById("hdr-menu");
const acercaModal = document.getElementById("acerca");
const show = (el) => el && el.classList.remove("hidden");
const hide = (el) => el && el.classList.add("hidden");

function setTheme(dark) {
  document.documentElement.dataset.theme = dark ? "dark" : "";
  try { localStorage.setItem("lockatus.theme", dark ? "dark" : "light"); } catch { /* sin storage */ }
}
function toggleTheme() { setTheme(document.documentElement.dataset.theme !== "dark"); }

function closeMenu() {
  hide(hdrMenu);
  const b = document.getElementById("btn-menu");
  if (b) b.setAttribute("aria-expanded", "false");
}
function openMenu() {
  show(hdrMenu);
  const b = document.getElementById("btn-menu");
  if (b) b.setAttribute("aria-expanded", "true");
}

function openAcerca() {
  const meta = document.querySelector('meta[name="lockatus-version"]');
  const v = (meta && meta.content || "").trim();
  const dd = document.getElementById("about-version");
  if (dd) dd.textContent = v && !v.startsWith("__") ? `v${v.replace(/^v/, "")}` : "—";
  show(acercaModal);
}

// ---------- Novedades: que cambio en cada version (sale del CHANGELOG.md) ----------
// Aparece solo al entrar al panel despues de una actualizacion (una vez por navegador: la ultima
// version vista queda en localStorage); el historial queda en el menu y en "Acerca de".
const novModal = document.getElementById("novedades");
const NOV_KEY = "lockatus.versionVista";
// Primero se escapa el HTML (esc); recien despues se convierten **negrita** y `codigo`.
const novMd = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/`([^`]+)`/g, "<code>$1</code>");
function novHtml(versiones) {
  return versiones.map((v) =>
    `<div class="nov-ver"><b>v${esc(v.version)}</b>${v.fecha ? `<span>${esc(v.fecha)}</span>` : ""}</div>` +
    v.secciones.map((s) => `<div class="nov-sec">${novMd(s.titulo)}</div><ul class="nov-list">${s.items.map((i) => `<li>${novMd(i)}</li>`).join("")}</ul>`).join(""),
  ).join("");
}
function verNovedades(d, bajada) {
  document.getElementById("nov-bajada").innerHTML = bajada;
  document.getElementById("nov-lista").innerHTML = d.versiones.length ? novHtml(d.versiones) : "<p>No hay notas para esta versión.</p>";
  show(novModal);
}
let novAvisado = false; // una vez por carga de página (viewMatrix se re-renderiza seguido)
async function avisarNovedades() {
  if (novAvisado) return;
  novAvisado = true;
  let vista = null;
  try { vista = localStorage.getItem(NOV_KEY); } catch { /* sin storage */ }
  const r = await api("GET", "/api/novedades" + (vista ? "?desde=" + encodeURIComponent(vista) : ""));
  if (!r.ok) return;
  try { localStorage.setItem(NOV_KEY, r.data.version); } catch { /* sin storage */ }
  if (vista === r.data.version || !r.data.versiones.length) return;
  if (document.querySelector(".modal-back:not(.hidden)")) return; // no tapar lo que el usuario abrio
  verNovedades(r.data, `Lockatus se actualizó a la <b>v${esc(r.data.version)}</b>. Esto cambió desde la última versión que viste:`);
}
async function novedadesTodas() {
  hide(acercaModal);
  const r = await api("GET", "/api/novedades?todas=1");
  if (!r.ok) return toast("No se pudieron cargar las novedades", true);
  verNovedades({ ...r.data, versiones: r.data.versiones.slice(0, 15) },
    `Versión instalada: <b>v${esc(r.data.version)}</b>. Últimas versiones, de la más nueva a la más vieja:`);
}

// Wiring del chrome (una sola vez; los elementos son estáticos en index.html).
(function wireChrome() {
  const btnMenu = document.getElementById("btn-menu");
  if (btnMenu) btnMenu.addEventListener("click", (e) => {
    e.stopPropagation();
    hdrMenu.classList.contains("hidden") ? openMenu() : closeMenu();
  });
  document.addEventListener("click", (e) => {
    if (!hdrMenu || hdrMenu.classList.contains("hidden")) return;
    if (!e.target.closest("#hdr-menu-wrap")) closeMenu();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    closeMenu();
    hide(acercaModal);
    hide(novModal);
  });
  const bind = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener("click", fn); };
  bind("brand-home", () => boot());
  bind("btn-theme", () => { toggleTheme(); });
  bind("btn-mi2fa", () => { closeMenu(); view2fa(); });
  bind("btn-mipass", () => { closeMenu(); viewPassword(false); });
  bind("btn-acerca", () => { closeMenu(); openAcerca(); });
  bind("btn-logout", async () => { closeMenu(); await api("POST", "/api/logout"); boot(); });
  bind("acerca-x", () => hide(acercaModal));
  if (acercaModal) acercaModal.addEventListener("click", (e) => { if (e.target === acercaModal) hide(acercaModal); });
  bind("btn-novedades", () => { closeMenu(); novedadesTodas(); });
  bind("acerca-novedades", () => novedadesTodas());
  bind("novedades-x", () => hide(novModal));
  bind("novedades-ok", () => hide(novModal));
  if (novModal) novModal.addEventListener("click", (e) => { if (e.target === novModal) hide(novModal); });
})();

// El topbar solo se ve en la vista logueada (la matriz). El resto de vistas lo ocultan.
function chrome(on) { on ? show(topbar) : (hide(topbar), closeMenu()); }

async function boot() {
  // Ruta pública del link de alta/reset: define tu contraseña (sin sesión previa).
  if (location.pathname === "/set-password") return viewSetPassword();
  const me = await api("GET", "/api/me");
  if (me.ok && me.data.must_change) return viewPassword(true);
  if (me.ok && me.data.admin) return viewMatrix();
  if (me.ok) return viewMessage(`Sesión iniciada como ${esc(me.data.user.email)}, pero sin acceso al panel de Lockatus.`);
  viewLogin();
}

// ---------- login ----------
function viewLogin() {
  chrome(false);
  app.innerHTML = `
    <div class="login-overlay">
      <form class="login-card" id="login" autocomplete="on">
        <span class="logo" style="background:center/contain no-repeat url('/logo.svg')"></span>
        <h2>Lockatus</h2>
        <p class="login-sub">Identidad única de la Suite Escriba</p>
        <input id="email" type="email" placeholder="Correo" autocomplete="username" required />
        <input id="pass" type="password" placeholder="Contraseña" autocomplete="current-password" required />
        <input id="totp" inputmode="numeric" placeholder="Código 2FA (6 dígitos)" autocomplete="one-time-code" style="display:none" />
        <button type="submit">Ingresar</button>
        <p class="login-err" id="msg"></p>
      </form>
    </div>`;
  eyeify(app);
  const totpEl = document.getElementById("totp"), msg = document.getElementById("msg");
  document.getElementById("login").addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = { email: document.getElementById("email").value, password: document.getElementById("pass").value };
    if (totpEl.style.display !== "none") body.totp = totpEl.value;
    const r = await api("POST", "/api/login", body);
    if (r.data.need_totp) { totpEl.style.display = ""; totpEl.focus(); msg.textContent = "Ingresá tu código de 2FA."; return; }
    if (!r.ok) { msg.textContent = r.data.error || "No se pudo ingresar"; return; }
    if (r.data.must_change) return viewPassword(true); // contraseña temporal → cambiar sí o sí
    const ret = new URLSearchParams(location.search).get("return");
    if (ret && ret.startsWith("/")) { location.href = ret; return; } // volver al /authorize del SSO
    boot();
  });
}

function viewMessage(text) {
  chrome(false);
  app.innerHTML = `<main class="wrap"><div class="card"><div class="col"><div class="brand"><span class="lock"></span><h1>Lockatus</h1></div>
    <p class="sub">${esc(text)}</p><button id="out">Cerrar sesión</button></div></div></main>`;
  document.getElementById("out").onclick = async () => { await api("POST", "/api/logout"); boot(); };
}

// Editor de una app (nombre, roles, redirect_uris) con Guardar / Eliminar / Cancelar.
async function openAppEditor(slug) {
  const r = await api("GET", `/api/admin/apps/${slug}`);
  if (!r.ok) return toast(r.data.error || "No se pudo abrir la app", true);
  const a = r.data;
  const back = document.createElement("div");
  back.className = "modal-back";
  back.innerHTML = `
    <div class="modal-card">
      <button class="modal-x" type="button" aria-label="Cerrar">&#10005;</button>
      <h3 class="modal-tit">Editar app · ${esc(a.slug)}</h3>
      <div class="modal-cuerpo">
        <label class="fld"><span>Nombre visible</span>
          <input id="ea-name" value="${esc(a.name || "")}" autocomplete="off" /></label>
        <label class="fld"><span>Roles (separados por coma)</span>
          <input id="ea-roles" value="${esc((a.roles || []).join(", "))}" autocomplete="off" /></label>
        <label class="fld"><span>Redirect URIs (uno por línea)</span>
          <textarea id="ea-redirects" rows="3" spellcheck="false">${esc((a.redirect_uris || []).join("\n"))}</textarea></label>
      </div>
      <div class="modal-acciones">
        <button class="ghost danger" id="ea-del" type="button">Eliminar app</button>
        <span style="flex:1"></span>
        <button class="ghost" id="ea-cancel" type="button">Cancelar</button>
        <button id="ea-save" type="button">Guardar</button>
      </div>
    </div>`;
  const onKey = (e) => { if (e.key === "Escape") close(); };
  const close = () => { back.remove(); document.removeEventListener("keydown", onKey); };
  back.querySelector(".modal-x").onclick = close;
  back.querySelector("#ea-cancel").onclick = close;
  back.addEventListener("click", (e) => { if (e.target === back) close(); });
  document.addEventListener("keydown", onKey);
  back.querySelector("#ea-save").onclick = async () => {
    const name = back.querySelector("#ea-name").value.trim() || a.slug;
    const roles = back.querySelector("#ea-roles").value.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
    if (!roles.length) return toast("Poné al menos un rol", true);
    const redirect_uris = back.querySelector("#ea-redirects").value.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
    const rr = await api("PUT", `/api/admin/apps/${a.slug}`, { name, roles, redirect_uris });
    if (!rr.ok) return toast(rr.data.error || "No se pudo guardar", true);
    toast("App actualizada"); close(); viewMatrix();
  };
  back.querySelector("#ea-del").onclick = async () => {
    if (!confirm(`¿Eliminar la app "${a.name || a.slug}"? Se quitan también los accesos que tenga asignados.`)) return;
    const rr = await api("DELETE", `/api/admin/apps/${a.slug}`);
    if (!rr.ok) return toast(rr.data.error || "No se pudo eliminar", true);
    toast("App eliminada"); close(); viewMatrix();
  };
  document.body.appendChild(back);
  back.querySelector("#ea-name").focus();
}

// ---------- matriz de accesos (accesos.js) ----------
async function viewMatrix() {
  // Identidad en el menú del topbar (quién está logueado).
  const me = await api("GET", "/api/me");
  if (!me.ok || !me.data.admin) return boot();
  const ui = document.getElementById("user-info");
  if (ui) ui.textContent = `${me.data.user.email} · Admin`;
  chrome(true);
  setTimeout(avisarNovedades, 400);
  return viewAccesos({ root: app, api, toast, esc, initials, openAppEditor, showLinkDialog, recargar: viewMatrix, salir: viewLogin });
}

// ---------- 2FA del propio usuario ----------
async function view2fa() {
  chrome(false);
  const me = await api("GET", "/api/me");
  if (me.data?.totp) {
    app.innerHTML = `<main class="wrap"><div class="card"><div class="col">
      <div class="brand"><span class="lock"></span><h1>Mi 2FA</h1></div>
      <p class="sub">El 2FA está <b>activo</b> en tu cuenta.</p>
      <input id="dcode" inputmode="numeric" placeholder="Código actual para desactivar" />
      <div class="row2"><button id="disable" class="ghost">Desactivar</button><button id="back">Volver</button></div>
      <p class="hint err" id="m2"></p></div></div></main>`;
    document.getElementById("back").onclick = boot;
    document.getElementById("disable").onclick = async () => {
      const r = await api("POST", "/api/2fa/disable", { code: document.getElementById("dcode").value });
      if (!r.ok) { document.getElementById("m2").textContent = r.data.error || "Error"; return; }
      toast("2FA desactivado"); boot();
    };
    return;
  }
  const s = await api("POST", "/api/2fa/setup");
  if (!s.ok) { toast(s.data.error || "Error", true); return boot(); }
  app.innerHTML = `<main class="wrap"><div class="card"><div class="col">
    <div class="brand"><span class="lock"></span><h1>Activar 2FA</h1></div>
    <p class="sub">Escaneá el QR con Google Authenticator (o el que uses) y confirmá con el código.</p>
    <img class="qr" src="${s.data.qr}" alt="QR de 2FA" />
    <p class="mono">${esc(s.data.secret)}</p>
    <input id="ccode" inputmode="numeric" placeholder="Código de 6 dígitos" />
    <div class="row2"><button id="confirm">Confirmar</button><button id="back" class="ghost">Cancelar</button></div>
    <p class="hint err" id="m2"></p></div></div></main>`;
  document.getElementById("back").onclick = boot;
  document.getElementById("confirm").onclick = async () => {
    const r = await api("POST", "/api/2fa/confirm", { code: document.getElementById("ccode").value });
    if (!r.ok) { document.getElementById("m2").textContent = r.data.error || "Error"; return; }
    app.innerHTML = `<main class="wrap"><div class="card"><div class="col">
      <div class="brand"><span class="lock"></span><h1>2FA activado</h1></div>
      <p class="sub">Guardá estos <b>códigos de recuperación</b>: se muestran una sola vez y cada uno sirve una vez si perdés el teléfono.</p>
      <pre class="codes">${r.data.recovery.map(esc).join("\n")}</pre>
      <button id="done">Listo</button></div></div></main>`;
    document.getElementById("done").onclick = boot;
  };
}

// ---------- set-password PÚBLICO (canje del link de alta/reset) ----------
// El usuario llega por el link del email (?token=...). Define SU contraseña; tras eso se le ofrece
// (opcional) enrolar 2FA reusando los endpoints existentes /api/2fa/setup + /api/2fa/confirm.
async function viewSetPassword() {
  chrome(false);
  const token = new URLSearchParams(location.search).get("token") || "";
  if (!token) return viewMessage("Link inválido o vencido. Pedí uno nuevo a tu administrador.");

  app.innerHTML = `
    <div class="login-overlay">
      <form class="login-card" id="setpw" autocomplete="on">
        <span class="logo" style="background:center/contain no-repeat url('/logo.svg')"></span>
        <h2>Definí tu contraseña</h2>
        <p class="login-sub">Elegí una contraseña para tu cuenta de la Suite Escriba.</p>
        <input id="sp-pw" type="password" placeholder="Nueva contraseña (mín. 8)" autocomplete="new-password" required />
        <input id="sp-pw2" type="password" placeholder="Repetir contraseña" autocomplete="new-password" required />
        <button type="submit">Guardar contraseña</button>
        <p class="login-err" id="sp-msg"></p>
      </form>
    </div>`;
  eyeify(app);
  const msg = document.getElementById("sp-msg");
  document.getElementById("setpw").addEventListener("submit", async (e) => {
    e.preventDefault();
    const pw = document.getElementById("sp-pw").value, pw2 = document.getElementById("sp-pw2").value;
    if (pw.length < 8) { msg.textContent = "La contraseña debe tener al menos 8 caracteres."; return; }
    if (pw !== pw2) { msg.textContent = "Las contraseñas no coinciden."; return; }
    const r = await api("POST", "/api/set-password", { token, password: pw });
    if (!r.ok) { msg.textContent = r.data.error || "No se pudo guardar"; return; }
    // Limpiar el token de la URL (que no quede en el historial) y ofrecer 2FA.
    try { history.replaceState(null, "", "/set-password"); } catch { /* */ }
    setPasswordOffer2fa();
  });
}

// Paso OPCIONAL de 2FA tras definir la contraseña (con la sesión recién creada por /api/set-password).
async function setPasswordOffer2fa() {
  const s = await api("POST", "/api/2fa/setup");
  const goLogin = () => { location.href = "/"; };
  if (!s.ok) return setPasswordDone(); // sin sesión o 2FA ya activo: cerrar el flujo igual
  app.innerHTML = `
    <div class="login-overlay">
      <div class="login-card">
        <span class="logo" style="background:center/contain no-repeat url('/logo.svg')"></span>
        <h2>Activá 2FA (opcional)</h2>
        <p class="login-sub">Sumá un segundo factor: escaneá el QR con tu app de autenticación y confirmá con el código. Podés saltarlo.</p>
        <img class="qr" src="${s.data.qr}" alt="QR de 2FA" />
        <p class="mono">${esc(s.data.secret)}</p>
        <input id="sp-code" inputmode="numeric" placeholder="Código de 6 dígitos" autocomplete="one-time-code" />
        <div class="row2"><button id="sp-confirm">Activar 2FA</button><button id="sp-skip" class="ghost" type="button">Saltar</button></div>
        <p class="login-err" id="sp-m2"></p>
      </div>
    </div>`;
  document.getElementById("sp-skip").onclick = goLogin;
  document.getElementById("sp-confirm").onclick = async () => {
    const r = await api("POST", "/api/2fa/confirm", { code: document.getElementById("sp-code").value });
    if (!r.ok) { document.getElementById("sp-m2").textContent = r.data.error || "Código inválido"; return; }
    app.innerHTML = `
      <div class="login-overlay">
        <div class="login-card">
          <span class="logo" style="background:center/contain no-repeat url('/logo.svg')"></span>
          <h2>2FA activado</h2>
          <p class="login-sub">Guardá estos <b>códigos de recuperación</b> (se muestran una sola vez):</p>
          <pre class="codes">${r.data.recovery.map(esc).join("\n")}</pre>
          <button id="sp-done">Continuar</button>
        </div>
      </div>`;
    document.getElementById("sp-done").onclick = goLogin;
  };
}

function setPasswordDone() {
  app.innerHTML = `
    <div class="login-overlay">
      <div class="login-card">
        <span class="logo" style="background:center/contain no-repeat url('/logo.svg')"></span>
        <h2>¡Listo!</h2>
        <p class="login-sub">Tu contraseña quedó definida. Ya podés ingresar.</p>
        <button id="sp-go">Ir a ingresar</button>
      </div>
    </div>`;
  document.getElementById("sp-go").onclick = () => { location.href = "/"; };
}

// ---------- contraseña propia (cambio forzado o voluntario) ----------
function viewPassword(forced) {
  chrome(false);
  app.innerHTML = `<main class="wrap"><div class="card"><div class="col">
    <div class="brand"><span class="lock"></span><h1>${forced ? "Cambiá tu contraseña" : "Mi contraseña"}</h1></div>
    <p class="sub">${forced ? "Tu contraseña es temporal. Definí una nueva para continuar." : "Cambiarla cierra tus sesiones en todas las apps."}</p>
    <input id="cur" type="password" placeholder="Contraseña actual" autocomplete="current-password" />
    <input id="nw" type="password" placeholder="Nueva contraseña (mín. 8)" autocomplete="new-password" />
    <input id="nw2" type="password" placeholder="Repetir nueva" autocomplete="new-password" />
    <div class="row2"><button id="save">Guardar</button>${forced ? `<button id="out" class="ghost">Salir</button>` : `<button id="back" class="ghost">Volver</button>`}</div>
    <p class="hint err" id="m3"></p></div></div></main>`;
  eyeify(app);
  if (forced) document.getElementById("out").onclick = async () => { await api("POST", "/api/logout"); boot(); };
  else document.getElementById("back").onclick = boot;
  document.getElementById("save").onclick = async () => {
    const nw = document.getElementById("nw").value, m3 = document.getElementById("m3");
    if (nw !== document.getElementById("nw2").value) { m3.textContent = "Las contraseñas nuevas no coinciden"; return; }
    const r = await api("POST", "/api/account/password", { current: document.getElementById("cur").value, new: nw });
    if (!r.ok) { m3.textContent = r.data.error || "Error"; return; }
    toast("Contraseña actualizada"); boot();
  };
}

boot();
