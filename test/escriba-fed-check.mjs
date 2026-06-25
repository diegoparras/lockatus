// escriba-fed-check.mjs — Escriba (el hub, FastAPI) federado con Lockatus (AUTH_MODE=federado).
// Navegador simulado entre Lockatus (:8081) y Escriba (:8000). Escriba es SPA: "/" sirve 200 y el
// gate es client-side; el "autenticado" se prueba contra /api/me (exige sesión, devuelve el rol).
const HUB = process.env.HUB || "http://localhost:8081";
const APP = process.env.APP || "http://localhost:8000";

const jars = {};
const jarOf = (url) => (jars[new URL(url).port] ||= {});
const cookieHeader = (jar) => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
const applySetCookie = (jar, r) => { for (const line of (r.headers.getSetCookie?.() || [])) { const kv = line.split(";")[0]; const i = kv.indexOf("="); const n = kv.slice(0, i).trim(), v = kv.slice(i + 1).trim(); if (/max-age=0/i.test(line) || v === "") delete jar[n]; else jar[n] = v; } };
async function navigate(url) {
  let cur = url;
  for (let i = 0; i < 8; i++) {
    const jar = jarOf(cur);
    const r = await fetch(cur, { headers: { Cookie: cookieHeader(jar) }, redirect: "manual" });
    applySetCookie(jar, r);
    if (r.status >= 300 && r.status < 400 && r.headers.get("location")) { cur = new URL(r.headers.get("location"), cur).toString(); continue; }
    return { status: r.status, url: cur, text: await r.text() };
  }
  throw new Error("demasiados redirects");
}
async function appMe() {
  const jar = jarOf(APP);
  const r = await fetch(APP + "/api/me", { headers: { Cookie: cookieHeader(jar) } });
  return { status: r.status, body: r.status === 200 ? await r.json() : null };
}
async function adminCall(method, path, body) {
  const jar = jarOf(HUB);
  const r = await fetch(HUB + path, { method, headers: { "Content-Type": "application/json", Cookie: cookieHeader(jar) }, body: body ? JSON.stringify(body) : undefined });
  applySetCookie(jar, r); return r;
}
let ok = 0, fail = 0;
const check = (n, c) => { if (c) { ok++; console.log("  ✓", n); } else { fail++; console.log("  ✗", n); } };

await adminCall("POST", "/api/login", { email: "admin@lockatus.local", password: "admin1234" });
await adminCall("PUT", "/api/admin/apps/escriba/redirect-uris", { redirect_uris: [APP + "/auth/callback"] });
await adminCall("PUT", "/api/admin/users/1/role", { app: "escriba", role: "dueño" });

// 1) Sin sesión en el hub: /auth/login delega → aterriza en Lockatus con la continuación OIDC.
for (const k in jars) delete jars[k];
let r = await navigate(APP + "/auth/login");
check("Escriba federada delega el login en Lockatus (el hub)", new URL(r.url).port === "8081" && r.status === 200 && /return=%2Fauthorize/.test(r.url));

// 2) Con sesión en el hub: el SSO completa y /api/me reconoce la sesión.
for (const k in jars) delete jars[k];
await adminCall("POST", "/api/login", { email: "admin@lockatus.local", password: "admin1234" });
r = await navigate(APP + "/auth/login");
let me = await appMe();
check("tras el SSO, Escriba reconoce la sesión (/api/me 200)", new URL(r.url).port === "8000" && me.status === 200);

// 3) La sesión local de Escriba persiste.
me = await appMe();
check("la sesión de Escriba persiste", me.status === 200);

// 4) Revocar el rol → el hub corta en /authorize y el callback responde 403 (sin sembrar sesión).
for (const k in jars) delete jars[k];
await adminCall("POST", "/api/login", { email: "admin@lockatus.local", password: "admin1234" });
await adminCall("PUT", "/api/admin/users/1/role", { app: "escriba", role: "" });
r = await navigate(APP + "/auth/login");
const denied = r.status === 403 || /Acceso denegado/.test(r.text);
const noSession = (await appMe()).status === 401;
check("revocar el rol → Escriba queda sin acceso (access_denied)", denied && noSession);

console.log(`\n${fail === 0 ? "TODO OK ✅" : "HAY FALLAS ❌"}  (${ok} ok, ${fail} fail)`);
process.exit(fail === 0 ? 0 : 1);
