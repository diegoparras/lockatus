// clave-inicial-check.mjs — La contrasena que se genera para el primer admin (sin
// LOCKATUS_ADMIN_PASS) nunca va al log: los registros del contenedor los ve cualquiera con acceso
// al panel. Queda en un archivo 0600 y el log solo dice donde leerla. Sin DB.
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { guardarClaveInicial, avisoClaveInicial, ARCHIVO_CLAVE_INICIAL } from "../server/clave-inicial.js";

let ok = 0, fail = 0;
const check = (name, cond) => { if (cond) { ok++; console.log("  ok  ", name); } else { fail++; console.log("  FALLA", name); } };

const dir = mkdtempSync(join(tmpdir(), "lockatus-clave-"));
const ruta = guardarClaveInicial("clave-de-prueba-123", dir);
check("la clave queda en el directorio indicado", ruta === join(dir, ARCHIVO_CLAVE_INICIAL));
check("el archivo tiene la clave", readFileSync(ruta, "utf8").trim() === "clave-de-prueba-123");
if (process.platform !== "win32") check("permisos 0600", (statSync(ruta).mode & 0o777) === 0o600);

const aviso = avisoClaveInicial({ email: "admin@x", ruta });
check("el aviso dice donde leerla", aviso.some((l) => l.includes(ruta)));
check("el aviso NUNCA lleva la clave", aviso.every((l) => !l.includes("clave-de-prueba-123")));
check("el aviso dice como fijarla", aviso.some((l) => l.includes("LOCKATUS_ADMIN_PASS")));

const noDir = join(dir, "soy-un-archivo");
writeFileSync(noDir, "x");
let error = null;
try { guardarClaveInicial("otra", noDir); } catch (e) { error = e; }
check("si no se puede escribir, tira", error !== null);
const avisoError = avisoClaveInicial({ email: "admin@x", error });
check("sin archivo, el aviso dice como entrar igual", avisoError.some((l) => l.includes("LOCKATUS_ADMIN_PASS")));
check("tampoco lleva la clave", avisoError.every((l) => !l.includes("otra")));

console.log(`\n${fail ? "HAY FALLAS" : "TODO OK"}  (${ok} ok, ${fail} fail)`);
process.exit(fail ? 1 : 0);
