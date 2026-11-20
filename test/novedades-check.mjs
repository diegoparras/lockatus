// novedades-check.mjs — novedades por version (sin DB). Salen del CHANGELOG.md (una sola fuente) y
// se muestran en el cartel de arranque (registros de EasyPanel), en la UI tras una actualizacion
// y en el Release de GitHub.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as nov from "../server/novedades.js";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
let ok = 0, fail = 0;
const check = (name, cond) => { if (cond) { ok++; console.log("  ok  ", name); } else { fail++; console.log("  FALLA", name); } };
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const MUESTRA = `# Changelog

Formato basado en Keep a Changelog.

## [0.3.0] - 2026-11-21

### Nuevo
- **Novedades** en la UI: se ven al entrar
  despues de una actualizacion (\`GET /api/novedades\`).

### Corregido
- Un arreglo corto.

## [0.2.1] - 2026-11-20

### Corregido
- Otro arreglo.

## [0.2.0] - 2026-11-19

### Nuevo
- Algo grande.
`;

const v = nov.parsear(MUESTRA);
check("parsea versiones en orden", igual(v.map((x) => x.version), ["0.3.0", "0.2.1", "0.2.0"]));
check("parsea la fecha", v[0].fecha === "2026-11-21");
check("parsea las secciones", igual(v[0].secciones.map((s) => s.titulo), ["Nuevo", "Corregido"]));
check("une los items multilinea", igual(v[0].secciones[0].items, ["**Novedades** en la UI: se ven al entrar despues de una actualizacion (`GET /api/novedades`)."]));

check("desde la vista hasta la actual, de la mas nueva a la mas vieja", igual(nov.desde(v, "0.2.0", "0.3.0").map((x) => x.version), ["0.3.0", "0.2.1"]));
check("ya vista: nada que mostrar", igual(nov.desde(v, "0.3.0", "0.3.0"), []));
check("primera vez: solo la actual", igual(nov.desde(v, null, "0.3.0").map((x) => x.version), ["0.3.0"]));
check("nunca muestra versiones posteriores a la que corre", igual(nov.desde(v, "0.2.0", "0.2.1").map((x) => x.version), ["0.2.1"]));
check("compara como version, no como texto", igual(nov.desde(v, "0.10.0", "0.3.0"), []));

check("texto plano para el log", igual(nov.lineasLog(v[0]), [
  "Nuevo: Novedades en la UI: se ven al entrar despues de una actualizacion (GET /api/novedades).",
  "Corregido: Un arreglo corto.",
]));
const md = nov.notasMarkdown(v[0]);
check("notas en markdown para el Release", /^### Nuevo\n- \*\*Novedades\*\* en la UI/.test(md) && /### Corregido\n- Un arreglo corto\./.test(md));

const l = nov.cartelArranque("0.3.0", v, 60);
check("cartel: ningun renglon pasa el ancho", l.every((x) => x.length <= 60));
check("cartel: abre y cierra con raya", /^=+$/.test(l[0]) && /^=+$/.test(l[l.length - 1]));
check("cartel: primero la version y la fecha", l[1] === "LOCKATUS v0.3.0  (2026-11-21)");
check("cartel: despues que cambia", l[2] === "Que cambia en esta version:");
check("cartel: corta al ancho", l[3] === "- Nuevo: Novedades en la UI: se ven al entrar despues de una");
check("cartel: la continuacion queda sangrada", /^ {4}actualizacion/.test(l[4]));
const sin = nov.cartelArranque("9.9.9", v, 60);
check("cartel sin seccion: avisa y no tira", sin[1] === "LOCKATUS v9.9.9" && sin[2] === "Sin notas para esta version en el CHANGELOG.");
check("cartel sin CHANGELOG: avisa y no tira", nov.cartelArranque("1.0.0", []).includes("Sin notas para esta version en el CHANGELOG."));

const { version } = JSON.parse(readFileSync(join(RAIZ, "package.json"), "utf8"));
check("el cartel real entra en 80 columnas", nov.cartelArranque(version, nov.todas()).every((x) => x.length <= 80));
const reales = nov.parsear(readFileSync(join(RAIZ, "CHANGELOG.md"), "utf8"));
const actual = reales.find((x) => x.version === version);
check(`el CHANGELOG tiene la seccion ## [${version}] de package.json (cada deploy dice que cambia)`, !!actual);
check(`la seccion ${version} del CHANGELOG no esta vacia`, !!actual && actual.secciones.some((s) => s.items.length));
check("la version de package.json es la primera del CHANGELOG", reales[0] && reales[0].version === version);

console.log(`\n${fail === 0 ? "TODO OK" : "HAY FALLAS"}  (${ok} ok, ${fail} fail)`);
process.exit(fail === 0 ? 0 : 1);
