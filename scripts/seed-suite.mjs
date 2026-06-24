// seed-suite.mjs — registra en Lockatus los redirect_uris de cada app de la suite y le da
// al admin un rol en todas (para poder entrar por SSO a cada una). Idempotente: se puede
// correr cuantas veces quieras. Pensado para el docker-compose.suite.yml.
//
// Env:
//   HUB         URL del hub (default http://localhost:8081)
//   ADMIN_EMAIL / ADMIN_PASS  credenciales del admin del hub
//   SUITE_HOST  host público de las apps para el browser (default host.docker.internal)
//   *_PORT      puertos host de cada app (matchean el compose)
const HUB = (process.env.HUB || "http://localhost:8081").replace(/\/$/, "");
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@lockatus.local";
const ADMIN_PASS = process.env.ADMIN_PASS || "admin1234";
const H = process.env.SUITE_HOST || "host.docker.internal";

// Topología de la suite: slug → { callback path, puerto host, rol top para el admin }.
const APPS = {
  selega:    { cb: "/api/auth/sso/callback", port: process.env.SELEGA_PORT || 8088, role: "superadmin" },
  fulgoria:  { cb: "/callback",              port: process.env.FULGORIA_PORT || 3000, role: "admin" },
  anonimal:  { cb: "/callback",              port: process.env.ANONIMAL_PORT || 8097, role: "admin" },
  fisherboy: { cb: "/auth/callback",         port: process.env.FISHERBOY_PORT || 8092, role: "dios" },
};

let cookie = "";
const setCookie = (r) => { const sc = r.headers.getSetCookie?.() || []; if (sc.length) cookie = sc.map((l) => l.split(";")[0]).join("; "); };
async function call(method, path, body) {
  const r = await fetch(HUB + path, {
    method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  setCookie(r);
  return r;
}

async function waitHub() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(HUB + "/health"); if (r.ok) return; } catch {}
    await new Promise((s) => setTimeout(s, 1000));
  }
  throw new Error("el hub no respondió a tiempo en " + HUB);
}

await waitHub();
const login = await call("POST", "/api/login", { email: ADMIN_EMAIL, password: ADMIN_PASS });
if (!login.ok) { console.error("seed-suite: login admin falló", login.status); process.exit(1); }

for (const [slug, a] of Object.entries(APPS)) {
  const redirect = `http://${H}:${a.port}${a.cb}`;
  // Además del de Docker, registramos el de localhost (por si entrás directo por localhost).
  const localRedirect = `http://localhost:${a.port}${a.cb}`;
  const ru = await call("PUT", `/api/admin/apps/${slug}/redirect-uris`, { redirect_uris: [redirect, localRedirect] });
  const rr = await call("PUT", "/api/admin/users/1/role", { app: slug, role: a.role });
  console.log(`  ${slug.padEnd(10)} redirect=${ru.status} role(${a.role})=${rr.status}  → ${redirect}`);
}
console.log("seed-suite: listo ✅");
