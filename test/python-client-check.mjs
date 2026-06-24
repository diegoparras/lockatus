// python-client-check.mjs — el cliente Python (clients/python) probado de punta a punta: una app
// FastAPI (:8091) federada con Lockatus (:8081). Actúa como navegador siguiendo los redirects.
const HUB = process.env.HUB || "http://localhost:8081";
const APP = process.env.APP || "http://localhost:8091";

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

// admin: registra el redirect del demo Python + se da rol "editor" en "anonimal".
await adminCall("POST", "/api/login", { email: "admin@lockatus.local", password: "admin1234" });
await adminCall("PUT", "/api/admin/apps/anonimal/redirect-uris", { redirect_uris: [APP + "/callback"] });
await adminCall("PUT", "/api/admin/users/1/role", { app: "anonimal", role: "editor" });

let r = await navigate(APP + "/");
check("el demo Python arranca deslogueado", r.status === 200 && /Entrar con Lockatus/.test(r.text));

r = await navigate(APP + "/login");
check("SSO: el cliente Python verifica el token y te reconoce", r.status === 200 && r.url.startsWith(APP) && /admin@lockatus\.local/.test(r.text));
check("muestra el rol que dijo Lockatus (editor)", /editor/.test(r.text));

r = await navigate(APP + "/");
check("la sesión local (firmada por el cliente Python) persiste", r.status === 200 && /admin@lockatus\.local/.test(r.text));

// la matriz manda también acá.
for (const k in jars) delete jars[k];
await adminCall("POST", "/api/login", { email: "admin@lockatus.local", password: "admin1234" });
await adminCall("PUT", "/api/admin/users/1/role", { app: "anonimal", role: "" });
r = await navigate(APP + "/login");
check("revocar el rol → el demo Python queda sin acceso (access_denied)", r.status === 403 || /Acceso denegado/.test(r.text));

console.log(`\n${fail === 0 ? "TODO OK ✅" : "HAY FALLAS ❌"}  (${ok} ok, ${fail} fail)`);
process.exit(fail === 0 ? 0 : 1);
