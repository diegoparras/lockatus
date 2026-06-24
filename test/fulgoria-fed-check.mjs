// fulgoria-fed-check.mjs — Fulgoria REAL federada con Lockatus (modo AUTH_MODE=federado).
// Actúa como navegador entre Lockatus (:8081) y Fulgoria (:8096). Requiere ambos arriba.
const HUB = process.env.HUB || "http://localhost:8081";
const APP = process.env.APP || "http://localhost:8096";

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

// 1) navegador limpio (sin sesión en ningún lado): Fulgoria federada delega el login en el HUB.
let r = await navigate(APP + "/login");
check("Fulgoria federada manda el login a Lockatus (el hub)", new URL(r.url).port === "8081" && r.status === 200);
for (const k in jars) delete jars[k];

// 0) admin: registra el redirect de Fulgoria + se da rol "editor" en fulgoria.
await adminCall("POST", "/api/login", { email: "admin@lockatus.local", password: "admin1234" });
await adminCall("PUT", "/api/admin/apps/fulgoria/redirect-uris", { redirect_uris: [APP + "/callback"] });
await adminCall("PUT", "/api/admin/users/1/role", { app: "fulgoria", role: "editor" });

// 2) /login federado → rebota a Lockatus (ya logueado) → vuelve con el código → sesión local → la APP.
r = await navigate(APP + "/login");
check("tras el SSO con Lockatus, Fulgoria sirve la app (autenticado)", r.status === 200 && r.url.startsWith(APP) && !isLoginForm(r.text));
check("la app real cargó (su index, no el login)", /fulgoria-escriba-url|Fulgoria/i.test(r.text) && !isLoginForm(r.text));

// 3) la sesión local de Fulgoria persiste.
r = await navigate(APP + "/");
check("la sesión de Fulgoria persiste", r.status === 200 && !isLoginForm(r.text));

// 4) la matriz manda: revoco el rol → el SSO de Fulgoria queda denegado.
for (const k in jars) delete jars[k]; // navegador limpio
await adminCall("POST", "/api/login", { email: "admin@lockatus.local", password: "admin1234" });
await adminCall("PUT", "/api/admin/users/1/role", { app: "fulgoria", role: "" }); // revoca
r = await navigate(APP + "/login");
check("sin rol en la matriz → Fulgoria NO deja entrar (access_denied)", r.status === 403 || isLoginForm(r.text));

console.log(`\n${fail === 0 ? "TODO OK ✅" : "HAY FALLAS ❌"}  (${ok} ok, ${fail} fail)`);
process.exit(fail === 0 ? 0 : 1);
