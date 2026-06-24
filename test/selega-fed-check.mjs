// selega-fed-check.mjs — Selega REAL (Node/Postgres, MULTIUSUARIO) federada con Lockatus
// (AUTH_MODE=federado). A diferencia de las otras apps (single-user), Selega tiene su propia
// tabla de usuarios: el callback hace FIND-OR-CREATE por email y mapea el rol que asigna el hub.
// Navegador simulado entre Lockatus (:8081) y Selega (:8093). El "autenticado" se prueba contra
// /api/auth/me (devuelve email + rol).
const HUB = process.env.HUB || "http://localhost:8081";
const APP = process.env.APP || "http://localhost:8093";
const EMAIL = "admin@lockatus.local";

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
  const r = await fetch(APP + "/api/auth/me", { headers: { Cookie: cookieHeader(jar) } });
  return { status: r.status, body: r.status === 200 ? await r.json() : null };
}
async function adminCall(method, path, body) {
  const jar = jarOf(HUB);
  const r = await fetch(HUB + path, { method, headers: { "Content-Type": "application/json", Cookie: cookieHeader(jar) }, body: body ? JSON.stringify(body) : undefined });
  applySetCookie(jar, r); return r;
}
let ok = 0, fail = 0;
const check = (n, c) => { if (c) { ok++; console.log("  ✓", n); } else { fail++; console.log("  ✗", n); } };

await adminCall("POST", "/api/login", { email: EMAIL, password: "admin1234" });
await adminCall("PUT", "/api/admin/apps/selega/redirect-uris", { redirect_uris: [APP + "/api/auth/sso/callback"] });
await adminCall("PUT", "/api/admin/users/1/role", { app: "selega", role: "auditor" });

// 1) Sin sesión en el hub: el SSO delega → aterriza en Lockatus con la continuación OIDC.
for (const k in jars) delete jars[k];
let r = await navigate(APP + "/api/auth/sso/login");
check("Selega federada delega el login en Lockatus (el hub)", new URL(r.url).port === "8081" && r.status === 200 && /return=%2Fauthorize/.test(r.url));

// 2) Con sesión en el hub: SSO + FIND-OR-CREATE del usuario por email + rol mapeado (auditor).
for (const k in jars) delete jars[k];
await adminCall("POST", "/api/login", { email: EMAIL, password: "admin1234" });
r = await navigate(APP + "/api/auth/sso/login");
let me = await appMe();
check("tras el SSO, Selega crea/reconoce el usuario por email con el rol del hub (auditor)",
  new URL(r.url).port === "8093" && me.status === 200 && me.body?.email === EMAIL && me.body?.role === "auditor");

// 3) La sesión local de Selega persiste.
me = await appMe();
check("la sesión de Selega persiste", me.status === 200 && me.body?.email === EMAIL);

// 4) Cambiar el rol en el hub → el re-login federado lo refleja (el hub manda el rol).
for (const k in jars) delete jars[k];
await adminCall("POST", "/api/login", { email: EMAIL, password: "admin1234" });
await adminCall("PUT", "/api/admin/users/1/role", { app: "selega", role: "supervisor" });
await navigate(APP + "/api/auth/sso/login");
me = await appMe();
check("cambiar el rol en el hub se refleja en Selega al re-loguear (supervisor)", me.status === 200 && me.body?.role === "supervisor");

// 5) Revocar el rol → el hub corta en /authorize y el callback responde 403 (sin sesión).
for (const k in jars) delete jars[k];
await adminCall("POST", "/api/login", { email: EMAIL, password: "admin1234" });
await adminCall("PUT", "/api/admin/users/1/role", { app: "selega", role: "" });
r = await navigate(APP + "/api/auth/sso/login");
const denied = r.status === 403 || /Acceso denegado/.test(r.text);
const noSession = (await appMe()).status === 401;
check("revocar el rol → Selega queda sin acceso (access_denied)", denied && noSession);

console.log(`\n${fail === 0 ? "TODO OK ✅" : "HAY FALLAS ❌"}  (${ok} ok, ${fail} fail)`);
process.exit(fail === 0 ? 0 : 1);
