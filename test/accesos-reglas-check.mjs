// accesos-reglas-check.mjs — reglas de la matriz de accesos sin base: el nivel de cada rol
// (color y confirmación), no sacarte tu admin, Lockatus nunca sin admin activo, la vista previa
// de los cambios en bloque y de la copia de accesos.
process.env.LOCKATUS_SECRET ||= "test-secret-reglas-0123456789";
const { nivelRol, esRolAlto } = await import("../src/niveles.js");
const { evaluarCambios, evaluarEstado, cambiosDeCopia, MSJ } = await import("../server/accesos.js");

let ok = 0, fail = 0;
const check = (name, cond) => { if (cond) { ok++; console.log("  ok  ", name); } else { fail++; console.log("  FALLA", name); } };
const niveles = (roles) => roles.map((r) => nivelRol(roles, r)).join("");

// ---- niveles por catálogo (los de la suite) ----
check("Escriba: dueño alto, editor medio, lector básico", niveles(["dueño", "editor", "lector"]) === "321");
check("Fisherboy: dios alto, angel medio, humano básico", niveles(["dios", "angel", "humano"]) === "321");
check("Arcanum: superadmin y admin altos, operador medio, lectura básico", niveles(["superadmin", "admin", "operador", "lectura"]) === "3321");
check("Selega (de abajo hacia arriba): manda la palabra, no el orden",
  niveles(["agente", "supervisor", "auditor", "admin", "superadmin"]) === "22133");
check("Searchgirl: admin alto, usuario básico", niveles(["admin", "usuario"]) === "31");
check("Poirot: investigador intermedio", nivelRol(["admin", "investigador", "lector"], "investigador") === 2);
check("catálogo sin palabras conocidas: manda el orden (primero alto, último básico)", niveles(["jefe", "capataz", "peon"]) === "321");
check("cualquier rol que contenga admin es alto", nivelRol(["sysadmin", "x"], "sysadmin") === 3 && esRolAlto(["x", "co-admin"], "co-admin"));
check("sin rol → nivel 0", nivelRol(["admin"], "") === 0 && nivelRol(["admin"], null) === 0);
check("mayúsculas no cambian el nivel", nivelRol(["Admin", "Lector"], "Admin") === 3 && nivelRol(["Admin", "Lector"], "Lector") === 1);

// ---- evaluarCambios ----
const apps = [
  { slug: "lockatus", name: "Lockatus", roles: ["admin"] },
  { slug: "arcanum", name: "Arcanum", roles: ["superadmin", "admin", "operador", "lectura"] },
  { slug: "escriba", name: "Escriba", roles: ["dueño", "editor", "lector"] },
];
const yo = { id: 1, email: "yo@x.com", name: "Yo", status: "active", roles: { lockatus: "admin", arcanum: "lectura" } };
const otra = { id: 2, email: "otra@x.com", name: "Otra", status: "active", roles: { lockatus: "admin" } };
const ana = { id: 3, email: "ana@x.com", name: "Ana", status: "active", roles: { escriba: "lector" } };
const baja = { id: 4, email: "baja@x.com", name: "Baja", status: "disabled", roles: { lockatus: "admin" } };
const usuarios = [yo, otra, ana, baja];
const ev = (cambios, actorId = 1, us = usuarios) => evaluarCambios({ actorId, cambios, apps, usuarios: us });

let it = ev([{ uid: 1, app: "lockatus", role: "" }])[0];
check("no te podés sacar tu propio admin de Lockatus", it.estado === "bloqueado" && it.motivo === MSJ.propio);
it = ev([{ uid: 2, app: "lockatus", role: "" }])[0];
check("sí podés sacarle el admin a otra persona (quedás vos)", it.estado === "cambia");
it = ev([{ uid: 2, app: "lockatus", role: "" }], 9, [otra, ana])[0];
check("Lockatus no puede quedar sin admin activo (el único admin)", it.estado === "bloqueado" && it.motivo === MSJ.ultimo);
it = ev([{ uid: 2, app: "lockatus", role: "" }], 9, [otra, baja])[0];
check("un admin deshabilitado no cuenta como admin activo", it.estado === "bloqueado" && it.motivo === MSJ.ultimo);
let items = ev([{ uid: 2, app: "lockatus", role: "" }, { uid: 1, app: "lockatus", role: "" }]);
check("en bloque: sacarte el tuyo se bloquea y el de la otra persona pasa", items[0].estado === "cambia" && items[1].estado === "bloqueado");
it = ev([{ uid: 3, app: "arcanum", role: "superadmin" }])[0];
check("dar superadmin marca el cambio como rol alto", it.estado === "cambia" && it.alto === true && it.antes === null);
it = ev([{ uid: 3, app: "escriba", role: "editor" }])[0];
check("un rol intermedio no es alto", it.estado === "cambia" && it.alto === false && it.antes === "lector");
it = ev([{ uid: 3, app: "escriba", role: "lector" }])[0];
check("mismo rol → igual (no se escribe)", it.estado === "igual");
it = ev([{ uid: 3, app: "escriba", role: "jefe" }])[0];
check("rol que la app no declara → inválido", it.estado === "invalido");
it = ev([{ uid: 3, app: "nada", role: "x" }])[0];
check("app desconocida → inválido", it.estado === "invalido");
it = ev([{ uid: 99, app: "escriba", role: "lector" }])[0];
check("usuario inexistente → inválido", it.estado === "invalido");
it = ev([{ uid: 3, app: "escriba", role: "editor", antes: "dueño" }])[0];
check("si el acceso cambió desde la vista previa → desactualizado", it.estado === "desactualizado");
it = ev([{ uid: 3, app: "escriba", role: "editor", antes: "lector" }])[0];
check("con el rol anterior correcto → cambia", it.estado === "cambia");
items = ev([{ uid: 3, app: "escriba", role: "editor" }, { uid: 3, app: "escriba", role: "dueño" }]);
check("dos cambios a la misma celda: gana el último", items.length === 1 && items[0].despues === "dueño" && items[0].alto);

// ---- evaluarEstado ----
check("no te podés deshabilitar a vos", evaluarEstado({ actorId: 1, uid: 1, status: "disabled", usuarios }) === MSJ.deshabilitarte);
check("deshabilitar a otro admin cuando quedás vos: se puede", evaluarEstado({ actorId: 1, uid: 2, status: "disabled", usuarios }) === null);
check("deshabilitar al último admin activo: no", evaluarEstado({ actorId: 9, uid: 2, status: "disabled", usuarios: [otra, ana] }) === MSJ.ultimo);
check("habilitar siempre se puede", evaluarEstado({ actorId: 1, uid: 1, status: "active", usuarios }) === null);

// ---- copiar accesos ----
const origen = { id: 5, roles: { arcanum: "operador", escriba: "editor" } };
const destino = { id: 6, roles: { escriba: "lector", lockatus: "admin" } };
let c = cambiosDeCopia({ origen, destino, apps, conservar: false });
check("copiar (igualar): suma, cambia y saca lo que el origen no tiene",
  c.length === 3 && c.find((x) => x.app === "lockatus").role === null && c.find((x) => x.app === "escriba").antes === "lector");
c = cambiosDeCopia({ origen, destino, apps, conservar: true });
check("copiar (conservar): no saca nada", c.length === 2 && !c.some((x) => x.role === null));
check("copiar a alguien que ya tiene lo mismo: sin cambios", cambiosDeCopia({ origen, destino: { id: 7, roles: { ...origen.roles } }, apps }).length === 0);

console.log(`\n${fail === 0 ? "TODO OK" : "HAY FALLAS"}  (${ok} ok, ${fail} fail)`);
process.exit(fail === 0 ? 0 : 1);
