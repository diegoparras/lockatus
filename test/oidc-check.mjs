// oidc-check.mjs — integración del flujo OIDC (Authorization Code + PKCE) contra el server :8081.
// Simula una app: registra su redirect_uri, manda al usuario a /authorize, canjea el código en
// /token, verifica los JWT con el JWKS y prueba que revocar el rol corta el SSO (la matriz manda).
import { createHash, randomBytes } from "node:crypto";
import { jwtVerify, createRemoteJWKSet } from "jose";

const BASE = process.env.BASE || "http://localhost:8081";
const RU = "http://localhost:9999/callback";
const JWKS = createRemoteJWKSet(new URL(BASE + "/jwks.json"));
let cookie = "";

async function call(method, path, body, opts = {}) {
  const r = await fetch(BASE + path, {
    method,
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(opts.headers || {}) },
    body: body ? JSON.stringify(body) : opts.body,
    redirect: opts.redirect || "follow",
  });
  const sc = r.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0];
  return r;
}
const j = async (r) => { try { return await r.json(); } catch { return {}; } };

let ok = 0, fail = 0;
const check = (name, cond) => { if (cond) { ok++; console.log("  ✓", name); } else { fail++; console.log("  ✗", name); } };

// 0) admin entra y prepara el cliente "escriba": registra redirect_uri + se da rol editor.
await call("POST", "/api/login", undefined, { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "admin@lockatus.local", password: "admin1234" }) });
await call("PUT", "/api/admin/apps/escriba/redirect-uris", { redirect_uris: [RU] });
await call("PUT", "/api/admin/users/1/role", { app: "escriba", role: "editor" });

// 1) PKCE + /authorize (con la sesión del hub) → 302 al callback con ?code
const verifier = randomBytes(32).toString("base64url");
const challenge = createHash("sha256").update(verifier).digest("base64url");
const authQ = new URLSearchParams({ client_id: "escriba", redirect_uri: RU, response_type: "code", scope: "openid email", state: "st-123", code_challenge: challenge, code_challenge_method: "S256", nonce: "n-xyz" });
let r = await call("GET", "/authorize?" + authQ, undefined, { redirect: "manual" });
const loc = r.headers.get("location") || "";
check("/authorize → 302 al redirect_uri con code + state", r.status === 302 && loc.startsWith(RU) && new URL(loc).searchParams.get("state") === "st-123" && !!new URL(loc).searchParams.get("code"));
const code = new URL(loc).searchParams.get("code");

// 2) /token con PKCE válido → access + id + refresh
const form = (o) => new URLSearchParams(o);
r = await call("POST", "/token", undefined, { headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form({ grant_type: "authorization_code", code, redirect_uri: RU, client_id: "escriba", code_verifier: verifier }) });
const tok = await j(r);
check("/token → access + id + refresh", r.status === 200 && tok.access_token && tok.id_token && tok.refresh_token);

// 3) verificación de los JWT con el JWKS (lo que hace la app, offline)
const { payload: ap } = await jwtVerify(tok.access_token, JWKS, { issuer: BASE, audience: "escriba" });
check("access token válido: aud=escriba, rol y email correctos", ap.role === "editor" && ap.email === "admin@lockatus.local");
const { payload: ip } = await jwtVerify(tok.id_token, JWKS, { issuer: BASE, audience: "escriba" });
check("id token válido: nonce ecoado", ip.nonce === "n-xyz" && ip.email === "admin@lockatus.local");

// 4) /userinfo con el access token
r = await fetch(BASE + "/userinfo", { headers: { Authorization: "Bearer " + tok.access_token } });
const ui = await j(r);
check("/userinfo → claims del usuario", r.status === 200 && ui.email === "admin@lockatus.local" && ui.role === "editor");

// 5) refresh → nuevo access token
r = await call("POST", "/token", undefined, { headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form({ grant_type: "refresh_token", refresh_token: tok.refresh_token }) });
const rf = await j(r);
check("refresh_token → nuevo access token", r.status === 200 && !!rf.access_token);

// 6) PKCE: code_verifier equivocado → invalid_grant (con un código nuevo)
r = await call("GET", "/authorize?" + new URLSearchParams({ client_id: "escriba", redirect_uri: RU, response_type: "code", scope: "openid", state: "s2", code_challenge: challenge, code_challenge_method: "S256" }), undefined, { redirect: "manual" });
const code2 = new URL(r.headers.get("location")).searchParams.get("code");
r = await call("POST", "/token", undefined, { headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form({ grant_type: "authorization_code", code: code2, redirect_uri: RU, client_id: "escriba", code_verifier: "verifier-equivocado" }) });
check("PKCE inválido → invalid_grant", r.status === 400 && (await j(r)).error === "invalid_grant");

// 7) la matriz manda: revoco el acceso → el refresh y el authorize fallan
await call("PUT", "/api/admin/users/1/role", { app: "escriba", role: "" }); // revoca
r = await call("POST", "/token", undefined, { headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form({ grant_type: "refresh_token", refresh_token: tok.refresh_token }) });
check("acceso revocado → el refresh corta (access_denied)", r.status === 403);
r = await call("GET", "/authorize?" + authQ, undefined, { redirect: "manual" });
check("acceso revocado → /authorize devuelve error=access_denied", new URL(r.headers.get("location")).searchParams.get("error") === "access_denied");

console.log(`\n${fail === 0 ? "TODO OK ✅" : "HAY FALLAS ❌"}  (${ok} ok, ${fail} fail)`);
process.exit(fail === 0 ? 0 : 1);
