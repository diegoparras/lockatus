// mailer.js — envío de email OPCIONAL del link de alta/reset de contraseña. nodemailer se carga
// de forma LAZY: solo si SMTP_HOST está seteado (off por defecto). Si el envío falla, NO se
// propaga: quien llama igual devuelve el link (con emailed:false). NUNCA se loguea el token/link.
import { config } from "./config.js";

export const smtpConfigured = () => !!config.smtp.host;

let _transport = null; // cache del transporter (una sola conexión/config por proceso)
async function transport() {
  if (_transport) return _transport;
  const { default: nodemailer } = await import("nodemailer"); // lazy → no se carga sin SMTP
  const { host, port, user, pass, secure } = config.smtp;
  _transport = nodemailer.createTransport({
    host, port, secure,
    ...(user || pass ? { auth: { user, pass } } : {}), // auth opcional (relays internos)
  });
  return _transport;
}

// Manda el link. Devuelve true si se envió, false si no había SMTP o falló (sin tirar excepción).
// `kind` ('alta'|'reset') solo cambia el texto; el cuerpo lleva el LINK, jamás una contraseña.
export async function sendSetupLink(to, link, kind = "alta") {
  if (!smtpConfigured()) return false;
  const alta = kind !== "reset";
  const subject = alta ? "Activá tu cuenta en Lockatus" : "Restablecé tu contraseña en Lockatus";
  const intro = alta
    ? "Te crearon una cuenta en Lockatus (identidad de la Suite Escriba). Abrí este enlace para definir tu contraseña:"
    : "Pediste (o un administrador pidió) restablecer tu contraseña en Lockatus. Abrí este enlace para definir una nueva:";
  const text = `${intro}\n\n${link}\n\nEl enlace es de un solo uso y vence pronto. Si no esperabas este correo, ignoralo.`;
  const html =
    `<p>${intro}</p>` +
    `<p><a href="${link}">${link}</a></p>` +
    `<p style="color:#666;font-size:13px">El enlace es de un solo uso y vence pronto. Si no esperabas este correo, ignoralo.</p>`;
  try {
    const t = await transport();
    await t.sendMail({ from: config.smtp.from, to, subject, text, html });
    return true;
  } catch (e) {
    // No rompemos el flujo ni revelamos el link en el log: solo un aviso genérico.
    console.warn("  ⚠ SMTP: no se pudo enviar el correo de alta/reset:", e?.message || String(e));
    return false;
  }
}
