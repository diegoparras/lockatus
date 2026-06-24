// recovery-check.mjs — recuperación de contraseña "tanque". Verifica: nuevo usuario obligado a
// cambiar, contraseña vieja inválida tras el cambio, el cambio MATA los refresh tokens, y el reset
// del admin NO saltea el 2FA. Contra el server :8081 (Postgres + dev server arriba).
import { createHash, randomBytes } from "node:crypto";
import { authenticator } from "otplib";

const BASE = process.env.BASE || "http://localhost:8081";
const RU = "http://localhost:9999/callback";

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
const uid = r.data.id, temp1 = r.data.tempPass;
check("alta de usuario → contraseña temporal", !!temp1 && !!uid);

const rec = client();
r = await rec("POST", "/api/login", { json: { email: EMAIL, password: temp1 } });
check("login con la temporal → exige cambiarla (must_change)", r.status === 200 && r.data.must_change === true);
r = await rec("GET", "/api/me");
check("/api/me reporta must_change", r.data.must_change === true);

r = await rec("POST", "/api/account/password", { json: { current: temp1, new: "Pass1-larga" } });
check("cambio de contraseña (con la actual) → ok", r.status === 200 && r.data.ok);

const recOld = client();
r = await recOld("POST", "/api/login", { json: { email: EMAIL, password: temp1 } });
check("la temporal vieja YA NO sirve", r.status === 401);
r = await rec("GET", "/api/me");
check("must_change quedó en false tras el cambio", r.data.must_change === false);

// --- el cambio de contraseña MATA los refresh tokens (vía OIDC) ---
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
await recAuth("POST", "/api/account/password", { json: { current: "Pass1-larga", new: "Pass2-larga" } });
r = await recAuth("POST", "/token", { form: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh }) });
check("tras cambiar la contraseña, el refresh token QUEDA INVALIDADO", r.status === 400);

// --- el reset del admin NO saltea el 2FA ---
const rec2 = client();
await rec2("POST", "/api/login", { json: { email: EMAIL, password: "Pass2-larga" } });
r = await rec2("POST", "/api/2fa/setup");
const secret = r.data.secret;
await rec2("POST", "/api/2fa/confirm", { json: { code: authenticator.generate(secret) } });
r = await admin("POST", `/api/admin/users/${uid}/reset-password`, {});
const temp2 = r.data.tempPass;
check("admin resetea la contraseña → nueva temporal", !!temp2);
const rec3 = client();
r = await rec3("POST", "/api/login", { json: { email: EMAIL, password: temp2 } });
check("login con la temporal del reset → PIDE 2FA (no lo saltea)", r.status === 200 && r.data.need_totp === true);
r = await rec3("POST", "/api/login", { json: { email: EMAIL, password: temp2, totp: authenticator.generate(secret) } });
check("recién con password+2FA entra, y debe cambiar la temporal", r.status === 200 && r.data.must_change === true);

// limpieza
await admin("PUT", `/api/admin/users/${uid}/status`, { json: { status: "disabled" } });

console.log(`\n${fail === 0 ? "TODO OK ✅" : "HAY FALLAS ❌"}  (${ok} ok, ${fail} fail)`);
process.exit(fail === 0 ? 0 : 1);
