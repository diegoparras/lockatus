// onboarding-check.mjs — verifica que se pueda dar de alta una app NUEVA de la familia sin
// tocar el código del hub: PUT /api/admin/apps/:slug declara slug + catálogo de roles, queda
// en la matriz, y se le pueden asignar esos roles (y solo esos) a los usuarios.
const HUB = process.env.HUB || "http://localhost:8081";
let cookie = "";
const setCookie = (r) => { const sc = r.headers.getSetCookie?.() || []; if (sc.length) cookie = sc.map((l) => l.split(";")[0]).join("; "); };
async function call(method, path, body) {
  const r = await fetch(HUB + path, {
    method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  setCookie(r);
  let json = null; try { json = await r.json(); } catch {}
  return { status: r.status, json };
}
let ok = 0, fail = 0;
const check = (n, c) => { if (c) { ok++; console.log("  ✓", n); } else { fail++; console.log("  ✗", n); } };

await call("POST", "/api/login", { email: "admin@lockatus.local", password: "admin1234" });

const SLUG = "probe-app";
const r1 = await call("PUT", `/api/admin/apps/${SLUG}`, { name: "Probe", roles: ["jefe", "peon"], redirect_uris: ["http://localhost:9999/cb"] });
check("alta de app nueva con catálogo de roles (PUT /api/admin/apps/:slug)", r1.status === 200 && r1.json?.slug === SLUG);

const m = await call("GET", "/api/admin/matrix");
const app = (m.json?.apps || []).find((a) => a.slug === SLUG);
check("la app nueva aparece en la matriz con sus roles", !!app && app.roles?.includes("jefe") && app.roles?.includes("peon"));

const slugBad = await call("PUT", "/api/admin/apps/Mala_Slug", { name: "x", roles: ["a"] });
check("rechaza slug inválido", slugBad.status === 400);
const noRoles = await call("PUT", `/api/admin/apps/${SLUG}`, { name: "Probe", roles: [] });
check("rechaza alta sin roles", noRoles.status === 400);

// crear un usuario y asignarle un rol declarado por la app nueva
const u = await call("POST", "/api/admin/users", { email: "probe.user@lockatus.local", name: "Probe User" });
const uid = u.json?.id;
const assignOk = await call("PUT", `/api/admin/users/${uid}/role`, { app: SLUG, role: "jefe" });
check("se puede asignar un rol DECLARADO por la app nueva", assignOk.status === 200 && assignOk.json?.role === "jefe");
const assignBad = await call("PUT", `/api/admin/users/${uid}/role`, { app: SLUG, role: "fantasma" });
check("rechaza un rol NO declarado por la app", assignBad.status === 400);

console.log(`\n${fail === 0 ? "TODO OK ✅" : "HAY FALLAS ❌"}  (${ok} ok, ${fail} fail)`);
process.exit(fail === 0 ? 0 : 1);
