// config.js — configuración del backend desde variables de entorno.
import { randomBytes, createHash } from "node:crypto";

function masterSecret() {
  const s = process.env.LOCKATUS_SECRET;
  if (s) return s;
  // Dev sin secreto: uno EFÍMERO + aviso fuerte. NO usar en prod (al reiniciar se pierden
  // los TOTP enrolados y se invalidan las sesiones). El docker-compose exige LOCKATUS_SECRET.
  console.warn("  ⚠ LOCKATUS_SECRET no seteado — usando uno EFÍMERO (solo dev).");
  return randomBytes(32).toString("hex");
}

// URL pública del emisor (issuer): base de la que derivamos el appUrl (donde abre el navegador).
const issuer = (process.env.LOCKATUS_ISSUER || "http://localhost:8081").replace(/\/$/, "");

export const config = {
  port: Number(process.env.PORT) || 8080,
  databaseUrl: process.env.DATABASE_URL || "postgresql://lockatus:lockatus@127.0.0.1:55433/lockatus",
  // URL pública del emisor: va en los tokens (iss) y en el JWKS. Las apps la usan para validar.
  issuer,
  // URL pública del front (para armar el LINK de alta/reset que recibe el usuario). Por defecto
  // = el issuer (el front se sirve desde el mismo origen). Se puede override con LOCKATUS_APP_URL.
  appUrl: (process.env.LOCKATUS_APP_URL || issuer).replace(/\/$/, ""),
  adminEmail: process.env.LOCKATUS_ADMIN_EMAIL || "admin@lockatus.local",
  adminPass: process.env.LOCKATUS_ADMIN_PASS || "", // vacío → se genera y se imprime una vez
  cookieName: "lockatus_session",
  sessionTtlMs: 1000 * 60 * 60 * 12, // sesión del hub (navegador): 12 h
  cookieSecure: process.env.LOCKATUS_SECURE_COOKIE === "1",
  accessTokenTtl: "10m",                       // token de acceso CORTO (verificación offline)
  refreshTokenTtlMs: 1000 * 60 * 60 * 24 * 30, // refresh 30 días (revocable)
  // Vida de los tokens de alta/reset de contraseña (link de un solo uso). El de ALTA dura más
  // (onboarding sin apuro); el de RESET es corto (responde a un pedido puntual).
  setupTokenAltaTtlMs: Number(process.env.LOCKATUS_SETUP_ALTA_TTL_MS) || 1000 * 60 * 60 * 72, // 72 h
  setupTokenResetTtlMs: Number(process.env.LOCKATUS_SETUP_RESET_TTL_MS) || 1000 * 60 * 60,    // 1 h
  // SMTP OPCIONAL: si SMTP_HOST está seteado, el link se manda por email. Si no, off (el endpoint
  // devuelve el link para que el admin lo copie). Nunca se manda la contraseña, solo el link.
  smtp: {
    host: process.env.SMTP_HOST || "",
    port: Number(process.env.SMTP_PORT) || 587,
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
    from: process.env.SMTP_FROM || process.env.SMTP_USER || "lockatus@localhost",
    secure: process.env.SMTP_SECURE === "1", // true = TLS implícito (puerto 465)
  },
  secret: masterSecret(),
};

// Clave AES-256 derivada del secreto maestro: cifra los secretos TOTP y la clave privada en reposo.
export const aesKey = createHash("sha256").update(config.secret).digest();
