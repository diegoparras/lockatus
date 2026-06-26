// app.js — front del hub: login (password + 2FA) y el panel de accesos (la matriz quién×sistema→rol).
const app = document.getElementById("app");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const initials = (s) => (s || "?").trim().split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");

async function api(method, path, body) {
  const r = await fetch(path, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  let data = {}; try { data = await r.json(); } catch { /* sin cuerpo */ }
  return { status: r.status, ok: r.ok, data };
}

function toast(msg, bad) {
  const t = document.createElement("div");
  t.className = "toast" + (bad ? " bad" : "");
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
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
const EYE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>`;
const EYE_OFF_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c6.4 0 10 7 10 7a13.2 13.2 0 0 1-1.67 2.68M6.6 6.6A13.4 13.4 0 0 0 2 11s3.6 7 10 7a9.1 9.1 0 0 0 5.4-1.6"/><path d="M14.12 14.12A3 3 0 1 1 9.88 9.88"/><line x1="2" y1="2" x2="22" y2="22"/></svg>`;
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
// Cierra los menús "…" por fila de la matriz (excepto, opcionalmente, uno).
function closeRowMenus(except) {
  document.querySelectorAll(".rowmenu-pop").forEach((p) => {
    if (p === except) return;
    p.classList.add("hidden");
    const b = p.parentElement.querySelector(".rowmenu-btn");
    if (b) b.setAttribute("aria-expanded", "false");
  });
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

// Wiring del chrome (una sola vez; los elementos son estáticos en index.html).
(function wireChrome() {
  const btnMenu = document.getElementById("btn-menu");
  if (btnMenu) btnMenu.addEventListener("click", (e) => {
    e.stopPropagation();
    hdrMenu.classList.contains("hidden") ? openMenu() : closeMenu();
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".rowmenu")) closeRowMenus(null);
    if (!hdrMenu || hdrMenu.classList.contains("hidden")) return;
    if (!e.target.closest("#hdr-menu-wrap")) closeMenu();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    closeMenu();
    closeRowMenus(null);
    hide(acercaModal);
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

// ---------- matriz de accesos ----------
async function viewMatrix() {
  const r = await api("GET", "/api/admin/matrix");
  if (!r.ok) return viewLogin();
  const { apps, users } = r.data;

  // Identidad en el menú del topbar (quién está logueado).
  const me = await api("GET", "/api/me");
  const ui = document.getElementById("user-info");
  if (ui && me.ok) ui.textContent = `${me.data.user.email} · Admin`;
  chrome(true);

  // Icono de 2FA (sobrio, sin emoji): candado-check para activo, guion para inactivo.
  const TFA_ON_SVG = `<svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="8.5" width="12" height="8" rx="1.5"/><path d="M6.5 8.5V6a3.5 3.5 0 0 1 7 0v2.5"/><path d="M8.2 12.4l1.4 1.4 2.4-2.6"/></svg>`;
  const tfaBadge = (u) => u.totp
    ? `<span class="tfa-badge on" title="2FA activo">${TFA_ON_SVG}<span>2FA</span></span>`
    : `<span class="tfa-badge off" title="Sin 2FA">2FA <span class="dash">—</span></span>`;

  // <select> de rol canónico, reutilizado por la tabla y por las tarjetas.
  const roleSelect = (u, a) => {
    const cur = u.roles[a.slug] || "";
    const opts = `<option value="">— Sin acceso</option>` + a.roles.map((ro) => `<option value="${esc(ro)}" ${ro === cur ? "selected" : ""}>${esc(ro)}</option>`).join("");
    return `<select class="role" data-uid="${u.id}" data-app="${esc(a.slug)}" aria-label="Rol en ${esc(a.name)}" ${cur ? 'data-has="1"' : ""}>${opts}</select>`;
  };

  // Menú "…" por fila con las acciones (Reset pass / Habilitar-Deshabilitar / Reset 2FA).
  const rowMenu = (u) => `
    <div class="rowmenu">
      <button class="icon-btn rowmenu-btn" type="button" aria-haspopup="true" aria-expanded="false" aria-label="Acciones del usuario" title="Acciones">
        <svg viewBox="0 0 20 20" width="16" height="16" fill="currentColor" aria-hidden="true"><circle cx="4" cy="10" r="1.6"/><circle cx="10" cy="10" r="1.6"/><circle cx="16" cy="10" r="1.6"/></svg>
      </button>
      <div class="rowmenu-pop menu hidden">
        <button class="menu-item" type="button" data-act="resetpw" data-uid="${u.id}">Reset contraseña</button>
        <button class="menu-item" type="button" data-act="status" data-uid="${u.id}" data-status="${u.status}">${u.status === "active" ? "Deshabilitar usuario" : "Habilitar usuario"}</button>
        ${u.totp ? `<button class="menu-item" type="button" data-act="reset" data-uid="${u.id}">Reset 2FA</button>` : ""}
      </div>
    </div>`;

  const userCell = (u) => `<div class="ucell"><span class="av">${esc(initials(u.name || u.email))}</span>
    <span class="uinfo"><b>${esc(u.name || u.email.split("@")[0])}</b><span class="email">${esc(u.email)}${u.status !== "active" ? " · deshabilitado" : ""}</span></span></div>`;

  // ---- Tabla (pantallas anchas): 1.ª columna Usuario sticky + scroll-x suave si hace falta ----
  const head = `<th class="u">Usuario</th><th class="c-tfa">2FA</th>${apps.map((a) => `<th><button type="button" class="appcol" data-app="${esc(a.slug)}" title="Editar app">${esc(a.name)}</button></th>`).join("")}<th class="c-acc" aria-label="Acciones"></th>`;
  const tRow = (u) => `
    <tr class="${u.status !== "active" ? "off" : ""}">
      <td class="u">${userCell(u)}</td>
      <td class="tfa c-tfa">${tfaBadge(u)}</td>
      ${apps.map((a) => `<td>${roleSelect(u, a)}</td>`).join("")}
      <td class="acc c-acc">${rowMenu(u)}</td>
    </tr>`;

  // ---- Tarjetas (pantallas angostas): una card por usuario, app→rol apilada ----
  const card = (u) => `
    <article class="ucard ${u.status !== "active" ? "off" : ""}">
      <header class="ucard-head">
        ${userCell(u)}
        <div class="ucard-meta">${tfaBadge(u)}${rowMenu(u)}</div>
      </header>
      <div class="ucard-roles">
        ${apps.map((a) => `<div class="rolerow"><span class="rolerow-app">${esc(a.name)}</span>${roleSelect(u, a)}</div>`).join("")}
      </div>
    </article>`;

  const empty = !users.length ? `<div class="matrix-empty">Todavía no hay usuarios. Creá el primero con “+ Usuario”.</div>` : "";

  app.innerHTML = `
    <div class="panel">
      <div class="matrix-head">
        <div><div class="crumb">Lockatus · Admin</div><h2>Accesos</h2></div>
        <div class="actions"><button id="nuevo">+ Usuario</button><button id="nuevoapp" class="ghost">+ App</button></div>
      </div>
      <form id="newuser" class="newuser" style="display:none">
        <input id="nu-email" type="email" placeholder="correo@org.com" required />
        <input id="nu-name" placeholder="Nombre (opcional)" />
        <button type="submit">Crear</button>
      </form>
      <form id="newapp" class="newuser" style="display:none">
        <input id="na-slug" placeholder="slug (ej. trustux)" autocomplete="off" required />
        <input id="na-name" placeholder="Nombre visible (opcional)" />
        <input id="na-roles" placeholder="roles separados por coma (ej. admin, editor, lector)" required />
        <input id="na-redirect" placeholder="redirect_uri (opcional, ej. https://miapp/callback)" />
        <button type="submit">Agregar app</button>
      </form>
      ${empty}
      <div class="tablewrap"><table class="matrix"><thead><tr>${head}</tr></thead><tbody>${users.map(tRow).join("")}</tbody></table></div>
      <div class="cards">${users.map(card).join("")}</div>
    </div>`;

  document.getElementById("nuevo").onclick = () => { const f = document.getElementById("newuser"); f.style.display = f.style.display === "none" ? "flex" : "none"; };
  document.getElementById("newuser").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("nu-email").value.trim();
    const r2 = await api("POST", "/api/admin/users", { email, name: document.getElementById("nu-name").value });
    if (!r2.ok) return toast(r2.data.error || "No se pudo crear", true);
    showLinkDialog("Usuario creado", r2.data.link, r2.data.emailed, email);
    viewMatrix();
  });

  // Alta de una app NUEVA de la familia (onboarding desde la propia matriz, sin tocar código).
  document.getElementById("nuevoapp").onclick = () => { const f = document.getElementById("newapp"); f.style.display = f.style.display === "none" ? "flex" : "none"; };
  document.getElementById("newapp").addEventListener("submit", async (e) => {
    e.preventDefault();
    const slug = document.getElementById("na-slug").value.trim().toLowerCase();
    const roles = document.getElementById("na-roles").value.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
    const name = document.getElementById("na-name").value.trim() || slug;
    const redirect = document.getElementById("na-redirect").value.trim();
    const redirect_uris = redirect ? redirect.split(/[\s,]+/).filter(Boolean) : [];
    const ra = await api("PUT", `/api/admin/apps/${slug}`, { name, roles, redirect_uris });
    if (!ra.ok) return toast(ra.data.error || "No se pudo agregar la app", true);
    toast(`App agregada: ${slug} (${roles.join(", ")})`);
    viewMatrix();
  });

  // Click en el nombre de una app (encabezado de columna) → editor de la app.
  app.querySelectorAll(".appcol").forEach((b) => (b.onclick = () => openAppEditor(b.dataset.app)));

  app.querySelectorAll("select.role").forEach((sel) => sel.addEventListener("change", async () => {
    const r3 = await api("PUT", `/api/admin/users/${sel.dataset.uid}/role`, { app: sel.dataset.app, role: sel.value });
    if (!r3.ok) { toast(r3.data.error || "No se pudo guardar", true); return; }
    // Mantener en sincronía la otra copia del select (tabla ↔ tarjeta) del mismo usuario·app.
    app.querySelectorAll(`select.role[data-uid="${sel.dataset.uid}"][data-app="${sel.dataset.app}"]`).forEach((tw) => {
      if (tw !== sel) tw.value = sel.value;
      sel.value ? tw.setAttribute("data-has", "1") : tw.removeAttribute("data-has");
    });
    toast(sel.value ? `Rol asignado: ${sel.value}` : "Acceso revocado");
  }));

  // Menús "…" por fila (uno por copia tabla/tarjeta). Abren/cierran como el kebab del topbar.
  app.querySelectorAll(".rowmenu-btn").forEach((btn) => btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const pop = btn.parentElement.querySelector(".rowmenu-pop");
    const willOpen = pop.classList.contains("hidden");
    closeRowMenus(willOpen ? pop : null);
    pop.classList.toggle("hidden", !willOpen);
    btn.setAttribute("aria-expanded", willOpen ? "true" : "false");
  }));

  app.querySelectorAll("button[data-act]").forEach((btn) => btn.onclick = async () => {
    closeRowMenus(null);
    const uid = btn.dataset.uid, act = btn.dataset.act;
    if (act === "status") {
      const next = btn.dataset.status === "active" ? "disabled" : "active";
      const r4 = await api("PUT", `/api/admin/users/${uid}/status`, { status: next });
      if (!r4.ok) return toast(r4.data.error || "Error", true);
    } else if (act === "resetpw") {
      const r6 = await api("POST", `/api/admin/users/${uid}/reset-password`);
      if (!r6.ok) return toast(r6.data.error || "Error", true);
      const email = (users.find((x) => String(x.id) === String(uid)) || {}).email || "";
      showLinkDialog("Restablecer contraseña", r6.data.link, r6.data.emailed, email);
      return;
    } else {
      const r5 = await api("POST", `/api/admin/users/${uid}/reset-2fa`);
      if (!r5.ok) return toast(r5.data.error || "Error", true);
      toast("2FA reseteado");
    }
    viewMatrix();
  });
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
