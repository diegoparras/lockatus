// notas-version.mjs — notas de la version de package.json, sacadas del CHANGELOG.md (las usa el CI
// para el Release). Sale con error si la version no tiene su seccion: ningun deploy sin decir que
// cambia.
//   node scripts/notas-version.mjs            -> markdown de la version actual
//   node scripts/notas-version.mjs --version  -> solo el numero
import { versionActual, todas, notasMarkdown } from "../server/novedades.js";

const version = versionActual();
if (process.argv.includes("--version")) {
  process.stdout.write(version);
} else {
  const v = todas().find((x) => x.version === version);
  if (!v || !v.secciones.length) {
    console.error(`CHANGELOG.md no tiene la seccion "## [${version}]" (o esta vacia): agregala antes de publicar.`);
    process.exit(1);
  }
  process.stdout.write(notasMarkdown(v));
}
