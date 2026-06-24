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

async function boot() {
  const me = await api("GET", "/api/me");
  if (me.ok && me.data.admin) return viewMatrix();
  if (me.ok) return viewMessage(`Sesión iniciada como ${esc(me.data.user.email)}, pero sin acceso al panel de Lockatus.`);
  viewLogin();
}

// ---------- login ----------
function viewLogin() {
  app.innerHTML = `
    <main class="wrap"><div class="card">
      <div class="brand"><span class="lock" aria-hidden="true"></span><h1>Lockatus</h1></div>
      <p class="sub">Identidad única de la Suite Escriba</p>
      <form id="login" autocomplete="on">
        <input id="email" type="email" placeholder="Correo" autocomplete="username" required />
        <input id="pass" type="password" placeholder="Contraseña" autocomplete="current-password" required />
        <input id="totp" inputmode="numeric" placeholder="Código 2FA (6 dígitos)" autocomplete="one-time-code" style="display:none" />
        <button type="submit">Ingresar</button>
        <p class="hint err" id="msg"></p>
      </form>
    </div></main>`;
  const totpEl = document.getElementById("totp"), msg = document.getElementById("msg");
  document.getElementById("login").addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = { email: document.getElementById("email").value, password: document.getElementById("pass").value };
    if (totpEl.style.display !== "none") body.totp = totpEl.value;
    const r = await api("POST", "/api/login", body);
    if (r.data.need_totp) { totpEl.style.display = ""; totpEl.focus(); msg.textContent = "Ingresá tu código de 2FA."; return; }
    if (!r.ok) { msg.textContent = r.data.error || "No se pudo ingresar"; return; }
    const ret = new URLSearchParams(location.search).get("return");
    if (ret && ret.startsWith("/")) { location.href = ret; return; } // volver al /authorize del SSO
    boot();
  });
}

function viewMessage(text) {
  app.innerHTML = `<main class="wrap"><div class="card"><div class="brand"><span class="lock"></span><h1>Lockatus</h1></div>
    <p class="sub">${esc(text)}</p><button id="out">Cerrar sesión</button></div></main>`;
  document.getElementById("out").onclick = async () => { await api("POST", "/api/logout"); boot(); };
}

// ---------- matriz de accesos ----------
async function viewMatrix() {
  const r = await api("GET", "/api/admin/matrix");
  if (!r.ok) return viewLogin();
  const { apps, users } = r.data;

  const head = `<th class="u">Usuario</th><th>2FA</th>${apps.map((a) => `<th>${esc(a.name)}</th>`).join("")}<th></th>`;
  const cell = (u, a) => {
    const cur = u.roles[a.slug] || "";
    const opts = `<option value="">—</option>` + a.roles.map((ro) => `<option value="${esc(ro)}" ${ro === cur ? "selected" : ""}>${esc(ro)}</option>`).join("");
    return `<td><select class="role" data-uid="${u.id}" data-app="${esc(a.slug)}" ${cur ? 'data-has="1"' : ""}>${opts}</select></td>`;
  };
  const row = (u) => `
    <tr class="${u.status !== "active" ? "off" : ""}">
      <td class="u"><div class="ucell"><span class="av">${esc(initials(u.name || u.email))}</span>
        <span class="uinfo"><b>${esc(u.name || u.email.split("@")[0])}</b><span class="email">${esc(u.email)}${u.status !== "active" ? " · deshabilitado" : ""}</span></span></div></td>
      <td class="tfa">${u.totp ? '<span class="ok" title="2FA activo">●</span>' : '<span class="no">—</span>'}</td>
      ${apps.map((a) => cell(u, a)).join("")}
      <td class="acc"><button class="mini" data-act="status" data-uid="${u.id}" data-status="${u.status}">${u.status === "active" ? "Deshabilitar" : "Habilitar"}</button>${u.totp ? `<button class="mini" data-act="reset" data-uid="${u.id}">Reset 2FA</button>` : ""}</td>
    </tr>`;

  app.innerHTML = `
    <div class="panel">
      <div class="topbar">
        <div><div class="crumb">Lockatus · Admin</div><h2>Accesos</h2></div>
        <div class="actions"><button id="nuevo">+ Usuario</button><button id="mi2fa" class="ghost">Mi 2FA</button><button id="logout" class="ghost">Salir</button></div>
      </div>
      <form id="newuser" class="newuser" style="display:none">
        <input id="nu-email" type="email" placeholder="correo@org.com" required />
        <input id="nu-name" placeholder="Nombre (opcional)" />
        <button type="submit">Crear</button>
      </form>
      <div class="tablewrap"><table class="matrix"><thead><tr>${head}</tr></thead><tbody>${users.map(row).join("")}</tbody></table></div>
    </div>`;

  document.getElementById("logout").onclick = async () => { await api("POST", "/api/logout"); boot(); };
  document.getElementById("mi2fa").onclick = () => view2fa();
  document.getElementById("nuevo").onclick = () => { const f = document.getElementById("newuser"); f.style.display = f.style.display === "none" ? "flex" : "none"; };
  document.getElementById("newuser").addEventListener("submit", async (e) => {
    e.preventDefault();
    const r2 = await api("POST", "/api/admin/users", { email: document.getElementById("nu-email").value, name: document.getElementById("nu-name").value });
    if (!r2.ok) return toast(r2.data.error || "No se pudo crear", true);
    toast(`Usuario creado · contraseña temporal: ${r2.data.tempPass}`);
    viewMatrix();
  });

  app.querySelectorAll("select.role").forEach((sel) => sel.addEventListener("change", async () => {
    const r3 = await api("PUT", `/api/admin/users/${sel.dataset.uid}/role`, { app: sel.dataset.app, role: sel.value });
    if (!r3.ok) { toast(r3.data.error || "No se pudo guardar", true); return; }
    toast(sel.value ? `Rol asignado: ${sel.value}` : "Acceso revocado");
  }));

  app.querySelectorAll("button[data-act]").forEach((btn) => btn.onclick = async () => {
    const uid = btn.dataset.uid;
    if (btn.dataset.act === "status") {
      const next = btn.dataset.status === "active" ? "disabled" : "active";
      const r4 = await api("PUT", `/api/admin/users/${uid}/status`, { status: next });
      if (!r4.ok) return toast(r4.data.error || "Error", true);
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

boot();
