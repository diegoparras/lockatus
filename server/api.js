// api.js — router del backend: discovery OIDC + login (sesión del hub) + panel de accesos (admin).
// El flujo OIDC authorize/token y el enrolado de 2FA se cablean encima de esto.
import { getJwks } from "./keys.js";
import { config } from "./config.js";
import { signSession, verifySession } from "./tokens.js";
import { verifyPassword, decryptSecret, randomToken } from "./crypto.js";
import { verifyTotp } from "./totp.js";
import * as db from "./db.js";

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
      if (!b.totp) return send(res, 200, { need_totp: true });
      if (!verifyTotp(b.totp, decryptSecret(totp.secret))) return send(res, 401, { error: "Código 2FA inválido" });
    }
    fails.delete(email);
    await db.auditSec(email, "login", "", u.org_id);
    const cookie = setCookie(signSession({ uid: u.id, email: u.email, exp: Date.now() + config.sessionTtlMs }), config.sessionTtlMs / 1000);
    return send(res, 200, { ok: true, user: { id: u.id, email: u.email, name: u.name } }, cookie);
  }

  if (path === "/api/logout" && m === "POST")
    return send(res, 200, { ok: true }, `${config.cookieName}=; Path=/; HttpOnly; Max-Age=0`);

  if (path === "/api/me" && m === "GET") {
    const s = getSession(req);
    if (!s) return send(res, 401, { error: "no autenticado" });
    const u = await db.getUserById(s.uid);
    if (!u || u.status !== "active") return send(res, 401, { error: "sesión inválida" });
    const roles = await db.rolesDe(u.id);
    return send(res, 200, { user: { id: u.id, email: u.email, name: u.name }, roles, admin: roles.lockatus === "admin" });
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
      const tempPass = randomToken(9);
      const id = await db.createUserWithPassword({ email, name: String(b.name || "") }, tempPass);
      await db.auditSec(actor, "crear_usuario", email);
      return send(res, 201, { ok: true, id, tempPass });
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
    }
    return send(res, 404, { error: "ruta admin no encontrada" });
  }

  return send(res, 404, { error: "no encontrado" });
}
