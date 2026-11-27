// accesos-check.mjs — integración de la matriz de accesos contra el server :8081 (Postgres arriba):
// confirmación de roles altos, no sacarte tu admin ni deshabilitarte, un deshabilitado pierde el
// panel, historial de una celda (con detalle y con registros viejos), cambios en bloque y copia
// de accesos con vista previa, y que todo quede en la auditoría.
import { randomBytes } from "node:crypto";

process.env.DATABASE_URL ||= `postgresql://${process.env.POSTGRES_USER || "lockatus"}:${process.env.POSTGRES_PASSWORD || "lockatus"}@127.0.0.1:55433/${process.env.POSTGRES_DB || "lockatus"}`;
const pg = (await import("pg")).default;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });

const BASE = process.env.BASE || "http://localhost:8081";
const tokenOf = (link) => new URL(link).searchParams.get("token");
function client() {
  let cookie = "";
  return async (method, path, body, headers = {}) => {
    const r = await fetch(BASE + path, {
      method,
      headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body !== undefined ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
    });
    const sc = r.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0];
    let data = {}; try { data = await r.json(); } catch { /* */ }
    return { status: r.status, data };
  };
}
let ok = 0, fail = 0;
const check = (n, c) => { if (c) { ok++; console.log("  ✓", n); } else { fail++; console.log("  ✗", n); } };
const tag = randomBytes(3).toString("hex");

const admin = client();
await admin("POST", "/api/login", { email: "admin@lockatus.local", password: "admin1234" });
let r = await admin("GET", "/api/admin/matrix");
const ME = r.data.me;
check("la matriz dice quién soy (me)", Number.isInteger(ME) && r.data.users.some((u) => u.id === ME));

// ---- no sacarte tu propio admin ni deshabilitarte ----
r = await admin("PUT", `/api/admin/users/${ME}/role`, { app: "lockatus", role: "" });
check("sacarte tu propio admin de Lockatus → 403", r.status === 403 && r.data.bloqueado === true);
r = await admin("PUT", `/api/admin/users/${ME}/status`, { status: "disabled" });
check("deshabilitarte a vos mismo → 409", r.status === 409);
r = await admin("GET", "/api/me");
check("seguís siendo admin y activo", r.data.admin === true);
r = await admin("PUT", "/api/admin/apps/lockatus", { name: "Lockatus", roles: ["dueño"] });
check("el catálogo de Lockatus no puede perder el rol admin", r.status === 400);

// ---- confirmación de roles altos ----
const mk = async (pref) => (await admin("POST", "/api/admin/users", { email: `${pref}_${tag}@org.com`, name: `${pref} ${tag}` })).data;
const X = await mk("acc_x");
r = await admin("PUT", `/api/admin/users/${X.id}/role`, { app: "lockatus", role: "admin" });
check("dar admin de Lockatus sin confirmar → 409 need_confirm", r.status === 409 && r.data.need_confirm === true);
r = await admin("GET", "/api/admin/matrix");
check("…y no se escribió nada", !r.data.users.find((u) => u.id === X.id).roles.lockatus);
r = await admin("PUT", `/api/admin/users/${X.id}/role`, { app: "lockatus", role: "admin", confirm: true });
check("con confirm:true → asignado", r.status === 200 && r.data.role === "admin" && r.data.antes === null);
r = await admin("PUT", `/api/admin/users/${X.id}/role`, { app: "arcanum", role: "superadmin" });
check("superadmin de Arcanum también pide confirmación", r.status === 409 && r.data.need_confirm);
r = await admin("PUT", `/api/admin/users/${X.id}/role`, { app: "arcanum", role: "operador", via: "celda" });
check("un rol intermedio no pide confirmación", r.status === 200 && r.data.role === "operador");
r = await admin("PUT", `/api/admin/users/${X.id}/role`, { app: "arcanum", role: "lectura", antes: "operador", via: "celda" });
check("con el rol anterior correcto → ok", r.status === 200 && r.data.antes === "operador");
r = await admin("PUT", `/api/admin/users/${X.id}/role`, { app: "arcanum", role: "operador", antes: "operador" });
check("si el rol cambió mientras tanto → 409 desactualizado", r.status === 409 && r.data.desactualizado === true && r.data.actual === "lectura");
r = await admin("PUT", `/api/admin/users/${X.id}/role`, { app: "arcanum", role: "operador" }, { "Content-Type": "text/plain" });
check("un cambio de rol que no es JSON → 415", r.status === 415);

// ---- historial de la celda ----
r = await admin("GET", `/api/admin/users/${X.id}/history?app=arcanum`);
check("historial: dos cambios, el más nuevo primero, con rol anterior y nuevo",
  r.status === 200 && r.data.eventos.length === 2 && r.data.eventos[0].antes === "operador" && r.data.eventos[0].despues === "lectura"
  && r.data.eventos[1].antes === null && r.data.eventos[0].actor === "admin@lockatus.local" && r.data.eventos[0].via === "celda");
check("historial: el acceso actual con quién lo dio", r.data.actual?.role === "lectura" && r.data.actual?.granted_by === "admin@lockatus.local");
await pool.query("INSERT INTO audit_security(org_id,actor,event,target) VALUES(1,'viejo@org.com','asignar_rol',$1)", [`acc_x_${tag}@org.com@escriba=lector`]);
r = await admin("GET", `/api/admin/users/${X.id}/history?app=escriba`);
check("historial: también lee los registros viejos (sin detalle)", r.data.eventos.length === 1 && r.data.eventos[0].despues === "lector" && r.data.eventos[0].actor === "viejo@org.com");
r = await admin("GET", `/api/admin/users/${X.id}/history?app=noexiste`);
check("historial de una app desconocida → 400", r.status === 400);

// ---- X entra como admin; deshabilitado pierde el panel ----
const xs = client();
await xs("POST", "/api/set-password", { token: tokenOf(X.link), password: "Clave-de-X-123" });
r = await xs("GET", `/api/admin/users/${X.id}/history?app=lockatus`);
check("otro admin puede leer el historial", r.status === 200 && r.data.eventos[0].despues === "admin");
r = await xs("PUT", `/api/admin/users/${X.id}/role`, { app: "lockatus", role: "" });
check("X tampoco puede sacarse su admin", r.status === 403);
r = await admin("PUT", `/api/admin/users/${X.id}/status`, { status: "disabled" });
check("deshabilitar a otro admin (quedás vos) → ok", r.status === 200);
r = await xs("GET", "/api/admin/matrix");
check("un admin deshabilitado pierde el panel aunque tenga la cookie", r.status === 401);
const nadie = client();
r = await nadie("GET", `/api/admin/users/${X.id}/history?app=lockatus`);
check("historial sin sesión → 401", r.status === 401);

// ---- cambios en bloque ----
const A = await mk("acc_a"), B = await mk("acc_b");
const cambios = [{ uid: A.id, app: "escriba", role: "editor" }, { uid: B.id, app: "escriba", role: "editor" }, { uid: ME, app: "lockatus", role: "" }];
r = await admin("POST", "/api/admin/roles/preview", { cambios });
check("vista previa: 2 cambian y sacarte tu admin queda bloqueado", r.status === 200 && r.data.cambian === 2 && r.data.bloqueados === 1);
r = await admin("GET", "/api/admin/matrix");
check("la vista previa no escribe", !r.data.users.find((u) => u.id === A.id).roles.escriba);
r = await admin("POST", "/api/admin/roles/bulk", { cambios });
check("aplicar en bloque sin confirmar → 409", r.status === 409 && r.data.need_confirm);
r = await admin("POST", "/api/admin/roles/bulk", { cambios, confirm: true });
check("aplicar en bloque con confirm → 2 aplicados, 1 bloqueado", r.status === 200 && r.data.aplicados === 2 && r.data.bloqueados === 1);
r = await admin("GET", "/api/me");
check("…y seguís siendo admin", r.data.admin === true);
r = await admin("GET", `/api/admin/users/${A.id}/history?app=escriba`);
check("el cambio en bloque queda en el historial (via bloque)", r.data.eventos[0]?.via === "bloque" && r.data.eventos[0]?.despues === "editor");
r = await admin("POST", "/api/admin/roles/bulk", { cambios: [{ uid: A.id, app: "escriba", role: "lector", antes: "dueño" }], confirm: true });
check("en bloque, una celda que cambió mientras tanto se saltea", r.status === 200 && r.data.aplicados === 0 && r.data.desactualizados === 1);
r = await admin("POST", "/api/admin/roles/bulk", { cambios: "nada" });
check("cambios que no son lista → 400", r.status === 400);

// ---- copiar accesos ----
await admin("PUT", `/api/admin/users/${A.id}/role`, { app: "arcanum", role: "lectura" });
await admin("PUT", `/api/admin/users/${B.id}/role`, { app: "fisherboy", role: "humano" });
r = await admin("POST", `/api/admin/users/${B.id}/copy-from`, { from: A.id, dry_run: true });
const porApp = Object.fromEntries((r.data.items || []).map((i) => [i.app, i]));
check("copiar (vista previa): suma arcanum y saca fisherboy", r.status === 200 && porApp.arcanum?.despues === "lectura" && porApp.fisherboy?.despues === null && r.data.cambian === 2);
r = await admin("POST", `/api/admin/users/${B.id}/copy-from`, { from: A.id, dry_run: true, conservar: true });
check("copiar conservando: no saca nada", r.data.cambian === 1 && r.data.items[0].app === "arcanum");
r = await admin("POST", `/api/admin/users/${B.id}/copy-from`, { from: A.id });
check("copiar sin confirmar → 409", r.status === 409 && r.data.need_confirm);
r = await admin("POST", `/api/admin/users/${B.id}/copy-from`, { from: A.id, confirm: true });
check("copiar con confirm → 2 aplicados", r.status === 200 && r.data.aplicados === 2);
r = await admin("GET", "/api/admin/matrix");
const rolesA = r.data.users.find((u) => u.id === A.id).roles, rolesB = r.data.users.find((u) => u.id === B.id).roles;
check("B quedó con los mismos accesos que A", JSON.stringify(rolesA) === JSON.stringify(rolesB));
r = await admin("POST", `/api/admin/users/${ME}/copy-from`, { from: A.id, dry_run: true });
const hub = (r.data.items || []).find((i) => i.app === "lockatus");
check("copiar sobre vos mismo: tu admin de Lockatus queda bloqueado", hub?.estado === "bloqueado");
r = await admin("POST", `/api/admin/users/${A.id}/copy-from`, { from: A.id, dry_run: true });
check("copiar de la misma persona → 400", r.status === 400);

// ---- auditoría ----
const aud = (await pool.query("SELECT event, detail FROM audit_security WHERE detail->>'uid' = $1::text ORDER BY id", [String(B.id)])).rows;
check("la auditoría guarda actor, usuario, app, rol anterior y nuevo",
  aud.length >= 3 && aud.every((x) => "antes" in x.detail && "despues" in x.detail && x.detail.app) && aud.some((x) => x.detail.via === "copia"));
const resumen = (await pool.query("SELECT 1 FROM audit_security WHERE event IN ('cambio_en_bloque','copiar_accesos') AND ts > now() - interval '5 minutes'")).rowCount;
check("los cambios en bloque y las copias dejan un resumen", resumen >= 2);

// limpieza
for (const u of [A, B]) await admin("PUT", `/api/admin/users/${u.id}/status`, { status: "disabled" });
await pool.end();
console.log(`\n${fail === 0 ? "TODO OK ✅" : "HAY FALLAS ❌"}  (${ok} ok, ${fail} fail)`);
process.exit(fail === 0 ? 0 : 1);
