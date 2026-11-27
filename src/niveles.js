// niveles.js — nivel de un rol dentro del catálogo de SU app. Lo usan el panel (color de cada
// celda) y el servidor (qué roles piden confirmación). Un solo archivo para los dos: el servidor
// lo importa desde ../src y el navegador lo baja como /niveles.js.
//
// Cada app declara su propio catálogo, así que no hay una escala común. El nivel sale así:
//   1. Palabras conocidas (manda sobre el orden): superadmin, admin, dueño, dios, owner, root y
//      cualquier rol que contenga "admin" son ALTOS; lectura, lector, humano, usuario, auditor,
//      invitado, viewer y parecidos son BÁSICOS.
//   2. Un rol desconocido en un catálogo que tiene alguna palabra conocida es INTERMEDIO
//      (editor, operador, angel, supervisor, investigador, agente).
//   3. Si el catálogo no tiene ninguna palabra conocida, manda el orden: la convención de la
//      suite es declarar los roles del más alto al más bajo, así que el primero es ALTO, el
//      último BÁSICO y los del medio INTERMEDIOS.
// Por qué no sólo el orden: Selega declara sus roles de abajo hacia arriba (agente … superadmin).

export const NIVEL = { SIN: 0, BASICO: 1, MEDIO: 2, ALTO: 3 };
export const NOMBRE_NIVEL = { 0: "Sin acceso", 1: "Básico", 2: "Intermedio", 3: "Alto" };

const ALTOS = new Set(["superadmin", "super-admin", "admin", "administrador", "administradora",
  "dueño", "dueña", "dueno", "duena", "owner", "dios", "diosa", "root"]);
const BASICOS = new Set(["lectura", "lector", "lectora", "solo-lectura", "humano", "humana",
  "usuario", "usuaria", "user", "auditor", "auditora", "invitado", "invitada", "guest",
  "viewer", "reader", "consulta"]);

const norm = (s) => String(s ?? "").trim().toLowerCase();
const esAlta = (r) => ALTOS.has(r) || r.includes("admin");
const esBasica = (r) => BASICOS.has(r);

/** Nivel (0..3) de `rol` dentro del catálogo `roles` de su app. Sin rol → 0. */
export function nivelRol(roles, rol) {
  const r = norm(rol);
  if (!r) return NIVEL.SIN;
  if (esAlta(r)) return NIVEL.ALTO;
  if (esBasica(r)) return NIVEL.BASICO;
  const cat = (roles || []).map(norm);
  if (cat.some((x) => esAlta(x) || esBasica(x))) return NIVEL.MEDIO;
  const i = cat.indexOf(r);
  if (i < 0) return NIVEL.MEDIO;
  if (i === 0) return NIVEL.ALTO;
  if (i === cat.length - 1) return NIVEL.BASICO;
  return NIVEL.MEDIO;
}

/** Los roles altos piden confirmación (en el panel y en el servidor). */
export const esRolAlto = (roles, rol) => nivelRol(roles, rol) === NIVEL.ALTO;
