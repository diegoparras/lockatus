// anonimal-fed-check.mjs — Anonimal REAL (FastAPI) federada con Lockatus (AUTH_MODE=federado),
// usando el cliente Python vendoreado. Navegador entre Lockatus (:8081) y Anonimal (:8097).
const HUB = process.env.HUB || "http://localhost:8081";
const APP = process.env.APP || "http://localhost:8097";

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
async function adminCall(method, path, body) {
  const jar = jarOf(HUB);
  const r = await fetch(HUB + path, { method, headers: { "Content-Type": "application/json", Cookie: cookieHeader(jar) }, body: body ? JSON.stringify(body) : undefined });
  applySetCookie(jar, r); return r;
}
let ok = 0, fail = 0;
const check = (n, c) => { if (c) { ok++; console.log("  ✓", n); } else { fail++; console.log("  ✗", n); } };
const isLoginForm = (t) => /name="password"/.test(t);

await adminCall("POST", "/api/login", { email: "admin@lockatus.local", password: "admin1234" });
await adminCall("PUT", "/api/admin/apps/anonimal/redirect-uris", { redirect_uris: [APP + "/callback"] });
await adminCall("PUT", "/api/admin/users/1/role", { app: "anonimal", role: "editor" });

// 1) Sin sesión en el hub: Anonimal federada delega el login → aterriza en Lockatus con la
//    continuación OIDC (?return=/authorize...). El form lo pinta el SPA del hub en runtime.
for (const k in jars) delete jars[k];
let r = await navigate(APP + "/login");
check("Anonimal federada delega el login en Lockatus (el hub)", new URL(r.url).port === "8081" && r.status === 200 && /return=%2Fauthorize/.test(r.url));

// 2) Con sesión en el hub: el SSO pasa transparente y Anonimal sirve la app.
for (const k in jars) delete jars[k];
await adminCall("POST", "/api/login", { email: "admin@lockatus.local", password: "admin1234" });

r = await navigate(APP + "/login");
check("tras el SSO, Anonimal sirve la app (autenticado, no el form)", r.status === 200 && r.url.startsWith(APP) && !isLoginForm(r.text));
r = await navigate(APP + "/");
check("la sesión de Anonimal persiste", r.status === 200 && !isLoginForm(r.text));

for (const k in jars) delete jars[k];
await adminCall("POST", "/api/login", { email: "admin@lockatus.local", password: "admin1234" });
await adminCall("PUT", "/api/admin/users/1/role", { app: "anonimal", role: "" });
r = await navigate(APP + "/login");
check("revocar el rol → Anonimal queda sin acceso (access_denied)", r.status === 403 || /Acceso denegado/.test(r.text) || isLoginForm(r.text));

console.log(`\n${fail === 0 ? "TODO OK ✅" : "HAY FALLAS ❌"}  (${ok} ok, ${fail} fail)`);
process.exit(fail === 0 ? 0 : 1);
