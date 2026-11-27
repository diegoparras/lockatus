// accesos.js — reglas de los cambios de acceso (la matriz quién × app → rol). Toda escritura de
// roles pasa por acá: una celda, el Deshacer, el cambio en bloque y la copia de accesos.
//
// Reglas (se validan en el servidor; el panel sólo las anticipa):
//   · Nadie se saca su propio acceso de admin a Lockatus (ni se deshabilita a sí mismo).
//   · Lockatus nunca queda sin ningún admin activo.
//   · Dar un rol ALTO (el más alto de su app o cualquiera que contenga "admin"; ver
//     src/niveles.js) pide confirmación explícita: `confirm: true` en el pedido.
//   · Cada cambio queda en audit_security con su detalle: quién, a quién, en qué app, rol
//     anterior, rol nuevo y desde dónde (celda, deshacer, bloque, copia).
import * as db from "./db.js";
import { esRolAlto } from "../src/niveles.js";

export const HUB = "lockatus";
export const ROL_HUB = "admin";

export const MSJ = {
  propio: "No podés sacarte tu propio acceso de admin a Lockatus.",
  ultimo: "Lockatus no puede quedar sin ningún admin activo.",
  deshabilitarte: "No podés deshabilitar tu propio usuario.",
  confirmar: "Dar un rol alto pide confirmación.",
  desactualizado: "El acceso cambió mientras tanto; revisalo de nuevo.",
};

const VIAS = new Set(["celda", "deshacer", "reintento", "bloque", "copia", "api"]);
export const viaValida = (v) => (VIAS.has(v) ? v : "api");

/** Admins activos de Lockatus según un mapa de usuarios (id → {status, roles}). */
const adminsActivos = (usuarios) =>
  [...usuarios.values()].filter((u) => u.status === "active" && u.roles?.[HUB] === ROL_HUB).map((u) => u.id);

/**
 * Evalúa una lista de cambios SIN escribir nada (función pura: se prueba sin base).
 *   cambios:  [{ uid, app, role, antes? }]   role vacío/null = sin acceso.
 *             `antes` (opcional) es lo que vio el panel: si no coincide, el cambio se descarta.
 *   apps:     [{ slug, name, roles }]
 *   usuarios: [{ id, email, name, status, roles: {app: rol} }]  (los afectados + los admins del hub)
 * Devuelve un ítem por celda (el último cambio pedido para cada usuario·app gana), con
 * estado: "cambia" | "igual" | "bloqueado" | "invalido" | "desactualizado".
 */
export function evaluarCambios({ actorId, cambios, apps, usuarios }) {
  const porApp = new Map(apps.map((a) => [a.slug, a]));
  const porId = new Map(usuarios.map((u) => [Number(u.id), { ...u, id: Number(u.id), roles: { ...(u.roles || {}) } }]));
  const unicos = new Map();
  for (const c of cambios || []) unicos.set(`${Number(c?.uid)}|${String(c?.app ?? "")}`, c);

  const items = [];
  for (const c of unicos.values()) {
    const uid = Number(c.uid), slug = String(c.app ?? "");
    const u = porId.get(uid), a = porApp.get(slug);
    const despues = c.role ? String(c.role) : null;
    const it = { uid, email: u?.email || "", nombre: u?.name || "", app: slug, appNombre: a?.name || slug,
      antes: u ? (u.roles[slug] || null) : null, despues, alto: false, estado: "cambia", motivo: "" };
    items.push(it);
    if (!u) { it.estado = "invalido"; it.motivo = "Usuario no encontrado."; continue; }
    if (!a) { it.estado = "invalido"; it.motivo = "App desconocida."; continue; }
    if (despues && !a.roles.includes(despues)) { it.estado = "invalido"; it.motivo = "Rol no declarado por la app."; continue; }
    if (c.antes !== undefined && (c.antes || null) !== it.antes) { it.estado = "desactualizado"; it.motivo = MSJ.desactualizado; continue; }
    if (it.antes === despues) { it.estado = "igual"; continue; }
    it.alto = !!despues && esRolAlto(a.roles, despues);
    if (slug === HUB && it.antes === ROL_HUB && despues !== ROL_HUB && uid === Number(actorId)) {
      it.estado = "bloqueado"; it.motivo = MSJ.propio;
    }
  }

  // ¿Cuántos admins activos quedan si se aplica todo lo que cambia? Si ninguno, se bloquean
  // todas las bajas de admin del hub de este pedido (no se elige cuál sí y cuál no).
  const despues = new Map([...porId.values()].map((u) => [u.id, { ...u, roles: { ...u.roles } }]));
  for (const it of items) if (it.estado === "cambia") {
    const u = despues.get(it.uid);
    if (it.despues) u.roles[it.app] = it.despues; else delete u.roles[it.app];
  }
  if (adminsActivos(despues).length === 0) {
    for (const it of items) if (it.estado === "cambia" && it.app === HUB && it.antes === ROL_HUB) {
      it.estado = "bloqueado"; it.motivo = MSJ.ultimo;
    }
  }
  return items;
}

/** ¿Se puede pasar a `status` al usuario `uid`? Devuelve el motivo si no (o null). */
export function evaluarEstado({ actorId, uid, status, usuarios }) {
  if (status === "active") return null;
  if (Number(uid) === Number(actorId)) return MSJ.deshabilitarte;
  const porId = new Map(usuarios.map((u) => [Number(u.id), { ...u, id: Number(u.id) }]));
  const u = porId.get(Number(uid));
  if (!u || u.status !== "active" || u.roles?.[HUB] !== ROL_HUB) return null;
  porId.set(u.id, { ...u, status: "disabled" });
  return adminsActivos(porId).length === 0 ? MSJ.ultimo : null;
}

/**
 * Evalúa y (si no es `dryRun`) aplica los cambios dentro de UNA transacción con candado.
 * confirmar: "alto" → pide confirm si algún cambio da un rol alto; "siempre" → pide confirm
 * siempre (cambios en bloque y copias, que el panel muestra antes en una vista previa).
 * Devuelve { items, aplicados, needConfirm }.
 */
export async function aplicarCambios({ actor, actorId, cambios, confirm, dryRun, via, ip = "", confirmar = "alto", lote = null, esperado = null }) {
  return db.enTransaccionDeAccesos(async (tx) => {
    const ids = [...new Set((cambios || []).map((c) => Number(c?.uid)).filter(Number.isInteger))];
    const [apps, usuarios] = [await tx.apps(), await tx.usuarios(ids)];
    const items = evaluarCambios({ actorId, cambios, apps, usuarios });
    const aAplicar = items.filter((i) => i.estado === "cambia");
    if (dryRun) return { items, aplicados: 0, needConfirm: false };
    // `esperado` = lo que el admin vio en la vista previa ([{app, role}] de un mismo usuario): si
    // lo que se aplicaría ahora es otra cosa (alguien cambió algo en el medio), no se aplica nada.
    if (Array.isArray(esperado)) {
      const k = (app, role) => `${app}=${role || ""}`;
      const vio = new Set(esperado.map((e) => k(String(e?.app ?? ""), e?.role)));
      const hoy = new Set(aAplicar.map((i) => k(i.app, i.despues)));
      if (vio.size !== hoy.size || [...vio].some((x) => !hoy.has(x))) return { items, aplicados: 0, needConfirm: false, desfasado: true };
    }
    const pideConfirm = aAplicar.length > 0 && (confirmar === "siempre" || aAplicar.some((i) => i.alto));
    if (pideConfirm && confirm !== true) return { items, aplicados: 0, needConfirm: true };
    const v = viaValida(via);
    for (const i of aAplicar) {
      if (i.despues) await tx.asignar(i.uid, i.app, i.despues, actor);
      else await tx.revocar(i.uid, i.app);
      const detail = { uid: i.uid, email: i.email, app: i.app, antes: i.antes, despues: i.despues, via: v, ...(lote ? { lote } : {}) };
      await tx.auditar(actor, i.despues ? "asignar_rol" : "revocar_acceso",
        i.despues ? `${i.email}@${i.app}=${i.despues}` : `${i.email}@${i.app}`, detail, ip);
    }
    return { items, aplicados: aAplicar.length, needConfirm: false };
  });
}

/** Cambia el estado de un usuario respetando las reglas del hub. Devuelve {ok} o {error}. */
export async function cambiarEstado({ actor, actorId, uid, status, ip = "" }) {
  return db.enTransaccionDeAccesos(async (tx) => {
    const usuarios = await tx.usuarios([Number(uid)]);
    const u = usuarios.find((x) => Number(x.id) === Number(uid));
    if (!u) return { error: "usuario no encontrado", code: 404 };
    const motivo = evaluarEstado({ actorId, uid, status, usuarios });
    if (motivo) return { error: motivo, code: 409 };
    await tx.estado(u.id, status);
    await tx.auditar(actor, "estado_usuario", `${u.email}=${status}`, { uid: u.id, email: u.email, antes: u.status, despues: status }, ip);
    return { ok: true };
  });
}

/** Los cambios que deja a `destino` con los accesos de `origen` (todas las apps). */
export function cambiosDeCopia({ origen, destino, apps, conservar }) {
  const out = [];
  for (const a of apps) {
    const quiere = origen.roles?.[a.slug] || null, tiene = destino.roles?.[a.slug] || null;
    if (quiere === tiene) continue;
    if (!quiere && conservar) continue; // "sumar": no saca lo que el destino ya tiene
    out.push({ uid: destino.id, app: a.slug, role: quiere, antes: tiene });
  }
  return out;
}
