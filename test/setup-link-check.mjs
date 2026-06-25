// setup-link-check.mjs — integración del flujo de LINK de alta/reset de contraseña (un solo uso).
// Cubre: alta → link → set-password → login con la clave nueva; token usado 2 veces → falla;
// token VENCIDO → falla; token basura → error genérico (anti-enumeración); rate-limit del POST
// público. Requiere Postgres arriba + el dev server en :8081. Usa el mismo DATABASE_URL que dev.mjs
// para poder insertar un token ya vencido directo en la DB.
import { randomBytes } from "node:crypto";

process.env.DATABASE_URL ||= `postgresql://${process.env.POSTGRES_USER || "lockatus"}:${process.env.POSTGRES_PASSWORD || "lockatus"}@127.0.0.1:55433/${process.env.POSTGRES_DB || "lockatus"}`;
const { sha256 } = await import("../server/crypto.js");
const pg = (await import("pg")).default;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });

const BASE = process.env.BASE || "http://localhost:8081";
const tokenOf = (link) => new URL(link).searchParams.get("token");

function client() {
  let cookie = "";
  return async (method, path, body) => {
    const r = await fetch(BASE + path, {
      method, headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const sc = r.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0];
    let data = {}; try { data = await r.json(); } catch { /* */ }
    return { status: r.status, data };
  };
}
let ok = 0, fail = 0;
const check = (n, c) => { if (c) { ok++; console.log("  ✓", n); } else { fail++; console.log("  ✗", n); } };

const admin = client();
await admin("POST", "/api/login", { email: "admin@lockatus.local", password: "admin1234" });

// 1) alta → LINK (sin contraseña) → set-password → login
const EMAIL = "lnk_" + randomBytes(3).toString("hex") + "@org.com";
let r = await admin("POST", "/api/admin/users", { email: EMAIL, name: "Link Test" });
const uid = r.data.id, link = r.data.link;
check("alta → devuelve link y NO tempPass", !!link && r.data.tempPass === undefined && !!uid);
check("link apunta a /set-password con ?token=", /\/set-password\?token=/.test(link) && (tokenOf(link)?.length || 0) >= 40);

const pub = client();
r = await pub("POST", "/api/set-password", { token: tokenOf(link), password: "Clave-Nueva-1" });
check("set-password con el link → ok", r.status === 200 && r.data.ok);

const u = client();
r = await u("POST", "/api/login", { email: EMAIL, password: "Clave-Nueva-1" });
check("login con la clave recién definida → ok", r.status === 200 && r.data.ok && r.data.must_change === false);

// 2) token usado dos veces → falla (genérico)
r = await pub("POST", "/api/set-password", { token: tokenOf(link), password: "Otra-Clave-2" });
check("el mismo token NO sirve la 2ª vez", r.status === 400 && /inválido o vencido/i.test(r.data.error || ""));

// 3) clave demasiado corta → 400 (validación de fuerza)
r = await admin("POST", "/api/admin/users", { email: "lnk2_" + randomBytes(3).toString("hex") + "@org.com" });
r = await pub("POST", "/api/set-password", { token: tokenOf(r.data.link), password: "corta" });
check("clave < 8 → rechazada", r.status === 400);

// 4) token VENCIDO → falla. Insertamos un token con expires_at en el pasado directo en la DB.
const expiredEmail = "exp_" + randomBytes(3).toString("hex") + "@org.com";
r = await admin("POST", "/api/admin/users", { email: expiredEmail });
const expUid = r.data.id;
const rawToken = randomBytes(32).toString("base64url");
await pool.query(
  `INSERT INTO password_setup_tokens(user_id, kind, token_hash, expires_at, created_by)
   VALUES($1,'alta',$2, now() - interval '1 minute', 'test')`, [expUid, sha256(rawToken)]);
r = await pub("POST", "/api/set-password", { token: rawToken, password: "Clave-Vencida-9" });
check("token VENCIDO → rechazado con error genérico", r.status === 400 && /inválido o vencido/i.test(r.data.error || ""));

// 5) token basura → mismo error genérico (anti-enumeración: no revela si existe)
r = await pub("POST", "/api/set-password", { token: "no-existe-este-token-para-nada", password: "Clave-Basura-9" });
check("token inexistente → mismo error genérico (anti-enum)", r.status === 400 && /inválido o vencido/i.test(r.data.error || ""));

// 6) rate-limit por IP del POST público (MAX 20 / ventana). Una ráfaga lo dispara → 429.
const rl = client();
let got429 = false;
for (let i = 0; i < 30; i++) {
  const rr = await rl("POST", "/api/set-password", { token: "x".repeat(20), password: "Clave-RL-12345" });
  if (rr.status === 429) { got429 = true; break; }
}
check("el POST público se rate-limita por IP (429)", got429);

await pool.end();
console.log(`\n${fail === 0 ? "TODO OK ✅" : "HAY FALLAS ❌"}  (${ok} ok, ${fail} fail)`);
process.exit(fail === 0 ? 0 : 1);
