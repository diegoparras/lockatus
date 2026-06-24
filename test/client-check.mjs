// client-check.mjs — SSO de punta a punta CROSS-SERVER: una app demo (:8090) federada con
// Lockatus (:8081). Actúa como navegador (jars de cookie por-origen, sigue los redirects entre
// los dos servers). Requiere ambos servers arriba: el dev de Lockatus y examples/demo-app/server.mjs.
const HUB = process.env.HUB || "http://localhost:8081";
const APP = process.env.APP || "http://localhost:8090";

const jars = {}; // por puerto → { cookieName: value }
const jarOf = (url) => (jars[new URL(url).port] ||= {});
const cookieHeader = (jar) => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
function applySetCookie(jar, r) {
  for (const line of (r.headers.getSetCookie?.() || [])) {
    const kv = line.split(";")[0]; const i = kv.indexOf("="); const name = kv.slice(0, i).trim(), val = kv.slice(i + 1).trim();
    if (/max-age=0/i.test(line) || val === "") delete jar[name]; else jar[name] = val;
  }
}
// Sigue redirects manualmente, cambiando de jar según el origen de cada salto.
async function navigate(url, { method = "GET", body, ct } = {}) {
  let cur = url, m = method, b = body;
  for (let i = 0; i < 8; i++) {
    const jar = jarOf(cur);
    const r = await fetch(cur, { method: m, headers: { ...(ct ? { "Content-Type": ct } : {}), Cookie: cookieHeader(jar) }, body: b, redirect: "manual" });
    applySetCookie(jar, r);
    if (r.status >= 300 && r.status < 400 && r.headers.get("location")) {
      cur = new URL(r.headers.get("location"), cur).toString(); m = "GET"; b = undefined;
      continue;
    }
    return { status: r.status, url: cur, text: await r.text() };
  }
  throw new Error("demasiados redirects");
}

let ok = 0, fail = 0;
const check = (n, c) => { if (c) { ok++; console.log("  ✓", n); } else { fail++; console.log("  ✗", n); } };

// 0) admin prepara el cliente "fulgoria": registra el redirect_uri de la demo y se da rol "editor".
async function adminCall(method, path, body) {
  const jar = jarOf(HUB);
  const r = await fetch(HUB + path, { method, headers: { "Content-Type": "application/json", Cookie: cookieHeader(jar) }, body: body ? JSON.stringify(body) : undefined });
  applySetCookie(jar, r); return r;
}
await adminCall("POST", "/api/login", { email: "admin@lockatus.local", password: "admin1234" });
await adminCall("PUT", "/api/admin/apps/fulgoria/redirect-uris", { redirect_uris: [APP + "/callback"] });
await adminCall("PUT", "/api/admin/users/1/role", { app: "fulgoria", role: "editor" });
// (el jar de :8081 ya tiene la sesión del hub del admin → el SSO será instantáneo)

// 1) sin sesión, la app demo ofrece "Entrar con Lockatus".
let r = await navigate(APP + "/");
check("la app demo arranca deslogueada", r.status === 200 && /Entrar con Lockatus/.test(r.text));

// 2) /login → rebota a Lockatus → (ya hay sesión del hub) → vuelve a la app con el código → sesión local.
r = await navigate(APP + "/login");
check("tras el SSO, la app demo te reconoce", r.status === 200 && r.url.startsWith(APP) && /admin@lockatus\.local/.test(r.text));
check("la app demo muestra el ROL que dijo Lockatus (editor)", /editor/.test(r.text));

// 3) la sesión local persiste (cookie propia de la app, su dominio).
r = await navigate(APP + "/");
check("la sesión local de la app persiste", r.status === 200 && /admin@lockatus\.local/.test(r.text));

// 4) logout local → vuelve a estar deslogueado en la app.
await navigate(APP + "/logout");
r = await navigate(APP + "/");
check("logout de la app → desloguea", /Entrar con Lockatus/.test(r.text));

console.log(`\n${fail === 0 ? "TODO OK ✅" : "HAY FALLAS ❌"}  (${ok} ok, ${fail} fail)`);
process.exit(fail === 0 ? 0 : 1);
