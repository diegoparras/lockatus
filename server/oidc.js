// oidc.js — proveedor OIDC: Authorization Code + PKCE. /authorize emite un código (gateado por la
// matriz: sin rol asignado para esa app = sin acceso); /token lo canjea por access/id/refresh
// tokens (RS256, verificables offline); /userinfo devuelve los claims del access token.
import { config } from "./config.js";
import { signAccessToken, signIdToken, verifyAccessToken } from "./tokens.js";
import { randomToken, sha256b64url } from "./crypto.js";
import * as db from "./db.js";

const json = (res, code, obj) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(JSON.stringify(obj)); };
const redirect = (res, location) => { res.writeHead(302, { Location: location }); res.end(); };
const htmlError = (res, code, msg) => { res.writeHead(code, { "Content-Type": "text/html; charset=utf-8" }); res.end(`<!doctype html><meta charset=utf-8><body style="font-family:system-ui;padding:2rem"><h3>Lockatus</h3><p>${msg}</p>`); };
const tokenErr = (res, error, code = 400) => json(res, code, { error });

function readForm(req, limit = 1e5) {
  return new Promise((resolve) => {
    let d = "", bad = false;
    req.on("data", (c) => { if (d.length + c.length > limit) bad = true; else d += c; });
    req.on("end", () => {
      if (bad) return resolve({});
      const ct = req.headers["content-type"] || "";
      if (ct.includes("application/json")) { try { return resolve(JSON.parse(d || "{}")); } catch { return resolve({}); } }
      resolve(Object.fromEntries(new URLSearchParams(d)));
    });
    req.on("error", () => resolve({}));
  });
}

// GET /authorize — el usuario (ya logueado en el hub) obtiene un código para la app.
export async function authorize(req, res, session) {
  const u = new URL(req.url, config.issuer);
  const p = u.searchParams;
  const clientId = p.get("client_id"), redirectUri = p.get("redirect_uri") || "";
  const responseType = p.get("response_type"), scope = p.get("scope") || "openid";
  const state = p.get("state") || "", challenge = p.get("code_challenge"), method = p.get("code_challenge_method"), nonce = p.get("nonce") || "";

  // Validación del cliente ANTES de poder redirigir a ningún lado (anti open-redirect).
  const app = await db.getApp(clientId || "");
  if (!app) return htmlError(res, 400, "client_id desconocido.");
  if (!redirectUri || !(app.redirect_uris || []).includes(redirectUri)) return htmlError(res, 400, "redirect_uri no registrado para esta app.");

  const back = (params) => redirect(res, redirectUri + (redirectUri.includes("?") ? "&" : "?") + new URLSearchParams({ ...params, ...(state ? { state } : {}) }).toString());
  if (responseType !== "code") return back({ error: "unsupported_response_type" });
  if (method !== "S256" || !challenge) return back({ error: "invalid_request" });

  // Sin sesión del hub → al login, que vuelve a /authorize cuando termina (con su 2FA).
  if (!session) return redirect(res, "/?return=" + encodeURIComponent(req.url));
  const user = await db.getUserById(session.uid);
  if (!user || user.status !== "active") return redirect(res, "/?return=" + encodeURIComponent(req.url));

  // La matriz manda: sin rol para esta app, no entra.
  const role = await db.roleFor(user.id, clientId);
  if (!role) return back({ error: "access_denied" });

  const code = randomToken(24);
  await db.saveAuthCode({ code, userId: user.id, app: clientId, redirectUri, challenge, scope, nonce });
  await db.auditSec(user.email, "oidc_authorize", clientId, user.org_id);
  back({ code });
}

// POST /token — canje del código (o refresh) por tokens.
export async function token(req, res) {
  const b = await readForm(req);
  if (b.grant_type === "authorization_code") {
    const rec = await db.takeAuthCode(b.code || "");
    if (!rec) return tokenErr(res, "invalid_grant");
    if (rec.app_slug !== b.client_id || rec.redirect_uri !== b.redirect_uri) return tokenErr(res, "invalid_grant");
    if (sha256b64url(b.code_verifier || "") !== rec.code_challenge) return tokenErr(res, "invalid_grant");
    const user = await db.getUserById(rec.user_id);
    if (!user || user.status !== "active") return tokenErr(res, "invalid_grant");
    const role = await db.roleFor(user.id, rec.app_slug);
    if (!role) return tokenErr(res, "access_denied", 403);
    return issue(res, user, rec.app_slug, role, rec.scope || "openid", rec.nonce);
  }
  if (b.grant_type === "refresh_token") {
    const rt = await db.getRefreshToken(b.refresh_token || "");
    if (!rt) return tokenErr(res, "invalid_grant");
    const user = await db.getUserById(rt.user_id);
    if (!user || user.status !== "active") return tokenErr(res, "invalid_grant");
    const role = await db.roleFor(user.id, rt.app_slug); // si le revocaron el acceso, el refresh falla
    if (!role) return tokenErr(res, "access_denied", 403);
    const access = await signAccessToken({ sub: user.id, email: user.email, app: rt.app_slug, role, org: user.org_id });
    return json(res, 200, { access_token: access, token_type: "Bearer", expires_in: 600, scope: "openid" });
  }
  return tokenErr(res, "unsupported_grant_type");
}

async function issue(res, user, app, role, scope, nonce) {
  const access_token = await signAccessToken({ sub: user.id, email: user.email, app, role, org: user.org_id });
  const refresh = randomToken(32);
  await db.saveRefreshToken({ token: refresh, userId: user.id, app, ttlMs: config.refreshTokenTtlMs });
  await db.auditSec(user.email, "oidc_token", app, user.org_id);
  const body = { access_token, token_type: "Bearer", expires_in: 600, refresh_token: refresh, scope };
  if (scope.split(" ").includes("openid")) body.id_token = await signIdToken({ sub: user.id, email: user.email, name: user.name, app, role, nonce });
  json(res, 200, body);
}

// GET /userinfo — Bearer access token → claims.
export async function userinfo(req, res) {
  const auth = req.headers.authorization || "";
  const payload = auth.startsWith("Bearer ") ? await verifyAccessToken(auth.slice(7)) : null;
  if (!payload) { res.writeHead(401, { "WWW-Authenticate": "Bearer" }); return res.end(); }
  json(res, 200, { sub: payload.sub, email: payload.email, role: payload.role, org: payload.org });
}
