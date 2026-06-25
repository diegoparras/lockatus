// recovery-check.mjs — recuperación de contraseña "tanque" con el LINK de alta/reset (un solo uso).
// Verifica: alta sin contraseña (el usuario la define por el link), la clave vieja deja de valer, el
// set-password MATA los refresh tokens, y el reset del admin NO saltea el 2FA. Contra el server :8081
// (Postgres + dev server arriba).
import { createHash, randomBytes } from "node:crypto";
import { authenticator } from "otplib";

const BASE = process.env.BASE || "http://localhost:8081";
const RU = "http://localhost:9999/callback";
const tokenOf = (link) => new URL(link).searchParams.get("token");

// cliente con su propio jar de cookie
function client() {
  let cookie = "";
  return async (method, path, { json, form, headers, redirect } = {}) => {
    const r = await fetch(BASE + path, {
      method,
      headers: { ...(json ? { "Content-Type": "application/json" } : {}), ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(headers || {}) },
      body: json ? JSON.stringify(json) : form,
      redirect: redirect || "follow",
    });
    const sc = r.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0];
    let data = {}; try { data = await r.json(); } catch { /* */ }
    return { status: r.status, data, location: r.headers.get("location") };
  };
}
let ok = 0, fail = 0;
const check = (n, c) => { if (c) { ok++; console.log("  ✓", n); } else { fail++; console.log("  ✗", n); } };

const admin = client();
await admin("POST", "/api/login", { json: { email: "admin@lockatus.local", password: "admin1234" } });

const EMAIL = "rec_" + randomBytes(3).toString("hex") + "@org.com";
let r = await admin("POST", "/api/admin/users", { json: { email: EMAIL, name: "Recu Test" } });
const uid = r.data.id, link1 = r.data.link;
check("alta de usuario → devuelve LINK (no contraseña)", !!link1 && !!uid && r.data.tempPass === undefined);
check("alta sin SMTP → emailed=false", r.data.emailed === false);

// la temporal no existe: sin definir la clave, no se puede entrar
const recPre = client();
r = await recPre("POST", "/api/login", { json: { email: EMAIL, password: "loquesea" } });
check("antes de usar el link, no se puede ingresar", r.status === 401);

// el usuario abre el link y define SU contraseña
const rec = client();
r = await rec("POST", "/api/set-password", { json: { token: tokenOf(link1), password: "Pass1-larga" } });
check("set-password con el token del link → ok", r.status === 200 && r.data.ok);

// el mismo token NO sirve dos veces
r = await rec("POST", "/api/set-password", { json: { token: tokenOf(link1), password: "Otra-larga-9" } });
check("el token de un solo uso NO sirve dos veces", r.status === 400);

// ya puede entrar con su clave (sin must_change: la definió él)
const rec2 = client();
r = await rec2("POST", "/api/login", { json: { email: EMAIL, password: "Pass1-larga" } });
check("login con la contraseña definida → ok, sin must_change", r.status === 200 && r.data.ok && r.data.must_change === false);

// --- el set-password MATA los refresh tokens (vía OIDC) ---
await admin("PUT", "/api/admin/apps/escriba/redirect-uris", { json: { redirect_uris: [RU] } });
await admin("PUT", `/api/admin/users/${uid}/role`, { json: { app: "escriba", role: "lector" } });
const verifier = randomBytes(32).toString("base64url");
const challenge = createHash("sha256").update(verifier).digest("base64url");
const recAuth = client();
await recAuth("POST", "/api/login", { json: { email: EMAIL, password: "Pass1-larga" } });
r = await recAuth("GET", "/authorize?" + new URLSearchParams({ client_id: "escriba", redirect_uri: RU, response_type: "code", scope: "openid", state: "s", code_challenge: challenge, code_challenge_method: "S256" }), { redirect: "manual" });
const code = new URL(r.location).searchParams.get("code");
r = await recAuth("POST", "/token", { form: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: RU, client_id: "escriba", code_verifier: verifier }) });
const refresh = r.data.refresh_token;
check("OIDC: el usuario obtuvo un refresh token", !!refresh);
// el admin resetea → link nuevo; el usuario define otra clave → debe matar el refresh
r = await admin("POST", `/api/admin/users/${uid}/reset-password`, {});
const link2 = r.data.link;
check("admin resetea → devuelve LINK (no contraseña)", !!link2 && r.data.tempPass === undefined);
const recReset = client();
await recReset("POST", "/api/set-password", { json: { token: tokenOf(link2), password: "Pass2-larga" } });
r = await recAuth("POST", "/token", { form: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh }) });
check("tras el set-password del reset, el refresh token QUEDA INVALIDADO", r.status === 400);

const recOld = client();
r = await recOld("POST", "/api/login", { json: { email: EMAIL, password: "Pass1-larga" } });
check("la contraseña vieja YA NO sirve tras el reset", r.status === 401);

// --- el reset del admin NO saltea el 2FA ---
const rec3 = client();
await rec3("POST", "/api/login", { json: { email: EMAIL, password: "Pass2-larga" } });
r = await rec3("POST", "/api/2fa/setup");
const secret = r.data.secret;
await rec3("POST", "/api/2fa/confirm", { json: { code: authenticator.generate(secret) } });
r = await admin("POST", `/api/admin/users/${uid}/reset-password`, {});
const link3 = r.data.link;
const rec4 = client(); // este cliente define la clave por el link (le da sesión del hub)
r = await rec4("POST", "/api/set-password", { json: { token: tokenOf(link3), password: "Pass3-larga" } });
check("set-password tras el reset → ok (y NO toca el 2FA)", r.status === 200 && r.data.ok);
// una sesión NUEVA (sin la cookie del set-password) debe exigir 2FA al loguear
const rec5 = client();
r = await rec5("POST", "/api/login", { json: { email: EMAIL, password: "Pass3-larga" } });
check("login en sesión nueva → PIDE 2FA (el reset no lo saltea)", r.status === 200 && r.data.need_totp === true);
r = await rec5("POST", "/api/login", { json: { email: EMAIL, password: "Pass3-larga", totp: authenticator.generate(secret) } });
check("recién con password+2FA entra", r.status === 200 && r.data.ok);

// limpieza
await admin("PUT", `/api/admin/users/${uid}/status`, { json: { status: "disabled" } });

console.log(`\n${fail === 0 ? "TODO OK ✅" : "HAY FALLAS ❌"}  (${ok} ok, ${fail} fail)`);
process.exit(fail === 0 ? 0 : 1);
