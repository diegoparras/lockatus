// twofa-check.mjs — integración del flujo de 2FA contra el server corriendo en :8081.
// Requiere Postgres arriba (docker compose up -d db) y el server (scripts/dev.mjs).
import { authenticator } from "otplib";

const BASE = process.env.BASE || "http://localhost:8081";
let cookie = "";
async function call(method, path, body) {
  const r = await fetch(BASE + path, {
    method,
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const sc = r.headers.get("set-cookie");
  if (sc) cookie = sc.split(";")[0];
  let data = {}; try { data = await r.json(); } catch { /* */ }
  return { status: r.status, data };
}

let ok = 0, fail = 0;
const check = (name, cond) => { if (cond) { ok++; console.log("  ✓", name); } else { fail++; console.log("  ✗", name); } };

const ADMIN = { email: "admin@lockatus.local", password: "admin1234" };

let r = await call("POST", "/api/login", ADMIN);
check("login admin (sin 2FA todavía)", r.status === 200 && r.data.ok);

r = await call("POST", "/api/2fa/setup");
check("setup devuelve secreto + QR", r.status === 200 && !!r.data.secret && r.data.qr?.startsWith("data:image"));
const secret = r.data.secret;

r = await call("POST", "/api/2fa/confirm", { code: "000000" });
check("confirm con código MALO se rechaza", r.status === 401);

r = await call("POST", "/api/2fa/confirm", { code: authenticator.generate(secret) });
check("confirm con código bueno → activa + recovery codes", r.status === 200 && Array.isArray(r.data.recovery) && r.data.recovery.length === 10);
const recovery = r.data.recovery || [];

r = await call("GET", "/api/me");
check("/api/me ahora reporta totp=true", r.data.totp === true);

// nueva sesión: el login ahora exige 2FA
cookie = "";
r = await call("POST", "/api/login", ADMIN);
check("login sin código → pide 2FA (need_totp)", r.status === 200 && r.data.need_totp === true);

r = await call("POST", "/api/login", { ...ADMIN, totp: "111111" });
check("login con código 2FA inválido → 401", r.status === 401);

r = await call("POST", "/api/login", { ...ADMIN, totp: authenticator.generate(secret) });
check("login con código 2FA válido → ok", r.status === 200 && r.data.ok);

// recovery code: un solo uso
cookie = "";
r = await call("POST", "/api/login", { ...ADMIN, totp: recovery[0] });
check("login con código de recuperación → ok", r.status === 200 && r.data.ok);
cookie = "";
r = await call("POST", "/api/login", { ...ADMIN, totp: recovery[0] });
check("el mismo código de recuperación NO sirve dos veces", r.status === 401);

// dejar la cuenta como estaba (sin 2FA) para no romper otras pruebas
cookie = "";
await call("POST", "/api/login", { ...ADMIN, totp: authenticator.generate(secret) });
r = await call("POST", "/api/2fa/disable", { code: authenticator.generate(secret) });
check("desactivar 2FA (con código) → ok", r.status === 200 && r.data.ok);

console.log(`\n${fail === 0 ? "TODO OK ✅" : "HAY FALLAS ❌"}  (${ok} ok, ${fail} fail)`);
process.exit(fail === 0 ? 0 : 1);
