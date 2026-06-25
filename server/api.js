// api.js — router del backend: discovery OIDC + login (sesión del hub) + panel de accesos (admin).
// El flujo OIDC authorize/token y el enrolado de 2FA se cablean encima de esto.
import { getJwks } from "./keys.js";
import { config } from "./config.js";
import { signSession, verifySession } from "./tokens.js";
import { verifyPassword, decryptSecret, encryptSecret, sha256, genRecoveryCodes } from "./crypto.js";
import { verifyTotp, newSecret, otpauthUrl, qrDataUrl } from "./totp.js";
import * as db from "./db.js";
import * as oidc from "./oidc.js";
import { sendSetupLink, smtpConfigured } from "./mailer.js";

function send(res, code, obj, cookie) {
  const h = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
  if (cookie) h["Set-Cookie"] = cookie;
  res.writeHead(code, h);
  res.end(JSON.stringify(obj));
}

function readBody(req, limit = 1e6) {
  return new Promise((resolve) => {
    let d = "", size = 0, bad = false;
    req.on("data", (c) => { size += c.length; if (size > limit) bad = true; else d += c; });
    req.on("end", () => { if (bad) return resolve(null); try { resolve(d ? JSON.parse(d) : {}); } catch { resolve(null); } });
    req.on("error", () => resolve(null));
  });
}

const parseCookies = (req) => Object.fromEntries((req.headers.cookie || "").split(";").map((c) => {
  const i = c.indexOf("="); return i < 0 ? [c.trim(), ""] : [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1).trim())];
}).filter((x) => x[0]));

const getSession = (req) => verifySession(parseCookies(req)[config.cookieName]);

function setCookie(value, maxAgeSec) {
  const parts = [`${config.cookieName}=${value}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAgeSec}`];
  if (config.cookieSecure) parts.push("Secure");
  return parts.join("; ");
}

async function requireAdmin(req, res) {
  const s = getSession(req);
  if (!s) { send(res, 401, { error: "no autenticado" }); return null; }
  const roles = await db.rolesDe(s.uid);
  if (roles.lockatus !== "admin") { send(res, 403, { error: "solo admin de Lockatus" }); return null; }
  return s;
}

// Lockout simple anti-fuerza-bruta, por email, en memoria.
const fails = new Map();
const MAX_FAILS = 5;

// IP del cliente: respeta X-Forwarded-For (reverse proxy / TLS) y cae al socket si no hay.
const clientIp = (req) =>
  (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
  req.socket?.remoteAddress || "";

// Rate-limit en memoria del POST público de set-password, por IP. Ventana móvil simple:
// MAX_SETPW intentos por IP cada SETPW_WINDOW ms. Frena fuerza bruta sobre tokens.
const setpwHits = new Map();
const MAX_SETPW = 20, SETPW_WINDOW = 10 * 60 * 1000; // 20 intentos / 10 min por IP
function setpwRateLimited(ip) {
  const now = Date.now();
  const h = setpwHits.get(ip);
  if (!h || now - h.t > SETPW_WINDOW) { setpwHits.set(ip, { n: 1, t: now }); return false; }
  h.n += 1;
  return h.n > MAX_SETPW;
}

// Emite el link de alta/reset e intenta mandarlo por email (si hay SMTP). Devuelve {link, emailed}.
// El email NUNCA falla el flujo: si no hay SMTP o el envío revienta, emailed=false y el admin copia
// el link de la respuesta. No se loguea el token ni el link.
async function issueSetupLink(userId, email, kind, createdBy) {
  const { link } = await db.createSetupToken(userId, kind, createdBy);
  let emailed = false;
  try { emailed = await sendSetupLink(email, link, kind); } catch { emailed = false; }
  return { link, emailed };
}

export async function handle(req, res, path, dbOk) {
  const m = req.method;
  const seg = path.split("/").filter(Boolean); // ["api","admin","users","5","role"]

  // ---- discovery OIDC (público) ----
  if (path === "/health") return send(res, 200, { ok: true, service: "lockatus", db: dbOk });
  if (path === "/jwks.json" || path === "/.well-known/jwks.json") return send(res, 200, getJwks());
  if (path === "/.well-known/openid-configuration") return send(res, 200, {
    issuer: config.issuer,
    authorization_endpoint: `${config.issuer}/authorize`,
    token_endpoint: `${config.issuer}/token`,
    jwks_uri: `${config.issuer}/jwks.json`,
    userinfo_endpoint: `${config.issuer}/userinfo`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    id_token_signing_alg_values_supported: ["RS256"],
    scopes_supported: ["openid", "profile", "email", "roles"],
  });

  // ---- OIDC (Authorization Code + PKCE) ----
  if (path === "/authorize" && m === "GET") return oidc.authorize(req, res, getSession(req));
  if (path === "/token" && m === "POST") return oidc.token(req, res);
  if (path === "/userinfo" && m === "GET") return oidc.userinfo(req, res);

  // ---- sesión del hub ----
  if (path === "/api/login" && m === "POST") {
    const b = await readBody(req);
    if (!b) return send(res, 400, { error: "JSON inválido" });
    const email = String(b.email || "").trim().toLowerCase();
    const f = fails.get(email);
    if (f && f.n >= MAX_FAILS && Date.now() - f.t < 60000) return send(res, 429, { error: "Demasiados intentos, esperá un minuto" });
    const u = await db.getUserByEmail(email);
    const hash = u ? await db.getPasswordHash(u.id) : null;
    if (!u || u.status !== "active" || !verifyPassword(String(b.password || ""), hash)) {
      fails.set(email, { n: (f?.n || 0) + 1, t: Date.now() });
      return send(res, 401, { error: "Credenciales inválidas" });
    }
    const totp = await db.getTotpFactor(u.id);
    if (totp) {
      const code = String(b.totp || "").trim();
      if (!code) return send(res, 200, { need_totp: true });
      // Código del authenticator (6 dígitos) o, de respaldo, un código de recuperación (un solo uso).
      let okCode = /^\d{6}$/.test(code) && verifyTotp(code, decryptSecret(totp.secret));
      if (!okCode) okCode = await db.consumeRecovery(u.id, sha256(code.toUpperCase()));
      if (!okCode) return send(res, 401, { error: "Código 2FA inválido" });
    }
    fails.delete(email);
    await db.auditSec(email, "login", "", u.org_id);
    const cookie = setCookie(signSession({ uid: u.id, email: u.email, exp: Date.now() + config.sessionTtlMs }), config.sessionTtlMs / 1000);
    return send(res, 200, { ok: true, user: { id: u.id, email: u.email, name: u.name }, must_change: u.must_change_password }, cookie);
  }

  if (path === "/api/logout" && m === "POST")
    return send(res, 200, { ok: true }, `${config.cookieName}=; Path=/; HttpOnly; Max-Age=0`);

  // ---- set-password PÚBLICO (canje del link de alta/reset): el usuario define SU contraseña ----
  // Sin sesión: el portador del token (de un solo uso) es la autorización. Rate-limit por IP.
  // Errores GENÉRICOS ("link inválido o vencido") → no revela si el usuario existe (anti-enum).
  if (path === "/api/set-password" && m === "POST") {
    const ip = clientIp(req);
    if (setpwRateLimited(ip)) return send(res, 429, { error: "Demasiados intentos, esperá un rato" });
    const b = await readBody(req);
    if (!b) return send(res, 400, { error: "JSON inválido" });
    const password = String(b.password || "");
    if (password.length < 8) return send(res, 400, { error: "La contraseña debe tener al menos 8 caracteres" });
    // Consume atómico (one-time + expiry). Null → genérico, sin distinguir inexistente/usado/vencido.
    const consumed = await db.consumeSetupToken(String(b.token || ""));
    if (!consumed) return send(res, 400, { error: "Link inválido o vencido" });
    const u = await db.getUserById(consumed.userId);
    if (!u) return send(res, 400, { error: "Link inválido o vencido" }); // mismo error genérico
    await db.setPasswordFactor(u.id, password);
    await db.setMustChange(u.id, false);   // ya definió su clave: no hay que forzar otro cambio
    await db.revokeAllRefresh(u.id);        // echa sesiones viejas en todas las apps
    await db.auditSec(u.email, consumed.kind === "reset" ? "set_password_reset" : "set_password_alta", "", u.org_id, ip);
    // El usuario acaba de probar el token de un solo uso Y definir su clave: le damos sesión del hub
    // para encadenar el paso OPCIONAL de 2FA (que usa /api/2fa/setup, con sesión). Solo si está activo.
    const cookie = u.status === "active"
      ? setCookie(signSession({ uid: u.id, email: u.email, exp: Date.now() + config.sessionTtlMs }), config.sessionTtlMs / 1000)
      : undefined;
    return send(res, 200, { ok: true }, cookie);
  }

  if (path === "/api/me" && m === "GET") {
    const s = getSession(req);
    if (!s) return send(res, 401, { error: "no autenticado" });
    const u = await db.getUserById(s.uid);
    if (!u || u.status !== "active") return send(res, 401, { error: "sesión inválida" });
    const roles = await db.rolesDe(u.id);
    const totp = !!(await db.getTotpFactor(u.id));
    return send(res, 200, { user: { id: u.id, email: u.email, name: u.name }, roles, totp, must_change: u.must_change_password, admin: roles.lockatus === "admin" });
  }

  // ---- cuenta propia: cambiar contraseña (invalida sesiones en todas las apps) ----
  if (path === "/api/account/password" && m === "POST") {
    const s = getSession(req); if (!s) return send(res, 401, { error: "no autenticado" });
    const b = await readBody(req); if (!b) return send(res, 400, { error: "JSON inválido" });
    const u = await db.getUserById(s.uid);
    if (!verifyPassword(String(b.current || ""), await db.getPasswordHash(u.id))) return send(res, 401, { error: "Contraseña actual incorrecta" });
    if (String(b.new || "").length < 8) return send(res, 400, { error: "La nueva contraseña debe tener al menos 8 caracteres" });
    await db.setPasswordFactor(u.id, String(b.new));
    await db.setMustChange(u.id, false);
    await db.revokeAllRefresh(u.id);
    await db.auditSec(u.email, "password_change", "", u.org_id);
    return send(res, 200, { ok: true });
  }

  // ---- 2FA del propio usuario (sobre su sesión) ----
  if (path === "/api/2fa/setup" && m === "POST") {
    const s = getSession(req); if (!s) return send(res, 401, { error: "no autenticado" });
    const u = await db.getUserById(s.uid);
    if (await db.getTotpFactor(u.id)) return send(res, 409, { error: "el 2FA ya está activo" });
    const secret = newSecret();
    await db.setTotpUnconfirmed(u.id, encryptSecret(secret));
    const url = otpauthUrl(u.email, secret);
    return send(res, 200, { secret, otpauth: url, qr: await qrDataUrl(url) });
  }

  if (path === "/api/2fa/confirm" && m === "POST") {
    const s = getSession(req); if (!s) return send(res, 401, { error: "no autenticado" });
    const b = await readBody(req); if (!b) return send(res, 400, { error: "JSON inválido" });
    const u = await db.getUserById(s.uid);
    const raw = await db.getTotpRaw(u.id);
    if (!raw) return send(res, 400, { error: "no hay un enrolado en curso (pedí setup primero)" });
    if (!verifyTotp(String(b.code || ""), decryptSecret(raw.secret))) return send(res, 401, { error: "Código inválido" });
    await db.confirmTotp(u.id);
    const codes = genRecoveryCodes();
    await db.setRecoveryCodes(u.id, codes.map(sha256));
    await db.auditSec(u.email, "2fa_enrolado", "", u.org_id);
    return send(res, 200, { ok: true, recovery: codes }); // se muestran UNA vez
  }

  if (path === "/api/2fa/disable" && m === "POST") {
    const s = getSession(req); if (!s) return send(res, 401, { error: "no autenticado" });
    const b = await readBody(req); if (!b) return send(res, 400, { error: "JSON inválido" });
    const u = await db.getUserById(s.uid);
    const totp = await db.getTotpFactor(u.id);
    if (!totp) return send(res, 409, { error: "no tenés 2FA activo" });
    if (!verifyTotp(String(b.code || ""), decryptSecret(totp.secret))) return send(res, 401, { error: "Código inválido" });
    await db.removeTotpFactor(u.id);
    await db.auditSec(u.email, "2fa_desactivado", "", u.org_id);
    return send(res, 200, { ok: true });
  }

  // ---- panel de accesos (admin de Lockatus) ----
  if (seg[0] === "api" && seg[1] === "admin") {
    const s = await requireAdmin(req, res);
    if (!s) return;
    const actor = (await db.getUserById(s.uid))?.email || "admin";

    if (path === "/api/admin/matrix" && m === "GET")
      return send(res, 200, { apps: await db.listApps(), users: await db.listMatrix() });

    if (path === "/api/admin/users" && m === "POST") {
      const b = await readBody(req);
      if (!b) return send(res, 400, { error: "JSON inválido" });
      const email = String(b.email || "").trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return send(res, 400, { error: "correo inválido" });
      if (await db.getUserByEmail(email)) return send(res, 409, { error: "ya existe un usuario con ese correo" });
      // Alta SIN contraseña: el usuario la define con el LINK de un solo uso (el admin no la ve).
      // Hasta que la setee, no puede entrar (must_change=true y no hay factor 'password' usable).
      const id = await db.createUser({ email, name: String(b.name || "") });
      await db.setMustChange(id, true);
      const { link, emailed } = await issueSetupLink(id, email, "alta", actor);
      await db.auditSec(actor, "crear_usuario", email, 1, clientIp(req));
      return send(res, 201, { ok: true, id, link, emailed });
    }

    // Alta/edición de una app de la familia Escriba: onboarding de apps NUEVAS sin tocar el
    // código del hub ni redeployar. La app declara su slug + catálogo de roles (+ redirect_uris
    // opcionales). Luego se le asignan roles a los usuarios en la matriz, igual que las demás.
    if (seg[2] === "apps" && seg[3] && !seg[4] && m === "PUT") {
      const b = await readBody(req);
      if (!b) return send(res, 400, { error: "JSON inválido" });
      const slug = String(seg[3]).toLowerCase();
      if (!/^[a-z][a-z0-9-]{1,30}$/.test(slug)) return send(res, 400, { error: "slug inválido (a-z, 0-9, '-')" });
      const roles = Array.isArray(b.roles) ? b.roles.map((r) => String(r).trim()).filter(Boolean) : [];
      if (!roles.length) return send(res, 400, { error: "roles: lista no vacía de los roles que declara la app" });
      const name = String(b.name || slug);
      const redirects = Array.isArray(b.redirect_uris) ? b.redirect_uris.map(String) : [];
      await db.ensureApp(slug, name, roles, redirects);
      if (redirects.length) await db.setRedirectUris(slug, redirects); // ensureApp solo setea redirects al crear
      await db.auditSec(actor, "alta_app", `${slug} [${roles.join(",")}]`);
      return send(res, 200, { ok: true, slug, name, roles });
    }

    if (seg[2] === "apps" && seg[3] && seg[4] === "redirect-uris" && m === "PUT") {
      const b = await readBody(req);
      if (!b || !Array.isArray(b.redirect_uris)) return send(res, 400, { error: "redirect_uris debe ser una lista" });
      if (!(await db.getApp(seg[3]))) return send(res, 404, { error: "app desconocida" });
      await db.setRedirectUris(seg[3], b.redirect_uris.map(String));
      await db.auditSec(actor, "set_redirect_uris", seg[3]);
      return send(res, 200, { ok: true });
    }

    if (seg[2] === "users" && seg[3]) {
      const id = Number(seg[3]);
      const target = await db.getUserById(id);
      if (!target) return send(res, 404, { error: "usuario no encontrado" });

      if (seg[4] === "role" && m === "PUT") {
        const b = await readBody(req);
        if (!b) return send(res, 400, { error: "JSON inválido" });
        const app = String(b.app || "");
        const appDef = (await db.listApps()).find((a) => a.slug === app);
        if (!appDef) return send(res, 400, { error: "app desconocida" });
        if (!b.role) { await db.revokeRole(id, app); await db.auditSec(actor, "revocar_acceso", `${target.email}@${app}`); return send(res, 200, { ok: true, role: null }); }
        if (!appDef.roles.includes(b.role)) return send(res, 400, { error: "rol no declarado por la app" });
        await db.assignRole(id, app, b.role, actor);
        await db.auditSec(actor, "asignar_rol", `${target.email}@${app}=${b.role}`);
        return send(res, 200, { ok: true, role: b.role });
      }

      if (seg[4] === "status" && m === "PUT") {
        const b = await readBody(req);
        const status = b?.status === "active" ? "active" : "disabled";
        await db.setUserStatus(id, status);
        await db.auditSec(actor, "estado_usuario", `${target.email}=${status}`);
        return send(res, 200, { ok: true, status });
      }

      if (seg[4] === "reset-2fa" && m === "POST") {
        await db.removeTotpFactor(id);
        await db.auditSec(actor, "reset_2fa", target.email);
        return send(res, 200, { ok: true });
      }

      // Reset de contraseña por admin: emite un LINK de un solo uso (el admin no ve la clave nueva).
      // NO toca el 2FA (el reset no es un bypass del segundo factor). La contraseña vieja sigue
      // válida hasta que el usuario abra el link y ponga una nueva (ahí se revocan las sesiones).
      if (seg[4] === "reset-password" && m === "POST") {
        const { link, emailed } = await issueSetupLink(id, target.email, "reset", actor);
        await db.auditSec(actor, "reset_password", target.email, 1, clientIp(req));
        return send(res, 200, { ok: true, link, emailed });
      }
    }
    return send(res, 404, { error: "ruta admin no encontrada" });
  }

  return send(res, 404, { error: "no encontrado" });
}
