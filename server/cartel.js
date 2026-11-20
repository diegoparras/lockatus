// cartel.js — lo PRIMERO que escribe el contenedor al levantar (registros de EasyPanel): version y
// que cambia, leido del CHANGELOG.md. index.js lo importa antes que nada (los imports ESM se
// evaluan en orden), asi sale antes que cualquier aviso de config.js o de Postgres.
// Nunca rompe el arranque: sin CHANGELOG dice "Sin notas para esta version". No imprime
// variables de entorno ni secretos: solo la version y el texto del CHANGELOG.
import { cartelArranque, todas, versionActual } from "./novedades.js";

// Una sola escritura (no una por renglon): docker lee stdout y stderr por separado, y si el cartel
// sale en pedazos los avisos de stderr (p. ej. LOCKATUS_SECRET no seteado) se le meten en el medio.
try {
  process.stdout.write(cartelArranque(versionActual(), todas()).map((l) => `[lockatus] ${l}`).join("\n") + "\n");
} catch { /* el cartel es informativo: nunca frena el arranque */ }
