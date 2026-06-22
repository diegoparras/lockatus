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

export const config = {
  port: Number(process.env.PORT) || 8080,
  databaseUrl: process.env.DATABASE_URL || "postgresql://lockatus:lockatus@127.0.0.1:55433/lockatus",
  // URL pública del emisor: va en los tokens (iss) y en el JWKS. Las apps la usan para validar.
  issuer: (process.env.LOCKATUS_ISSUER || "http://localhost:8081").replace(/\/$/, ""),
  adminEmail: process.env.LOCKATUS_ADMIN_EMAIL || "admin@lockatus.local",
  adminPass: process.env.LOCKATUS_ADMIN_PASS || "", // vacío → se genera y se imprime una vez
  cookieName: "lockatus_session",
  sessionTtlMs: 1000 * 60 * 60 * 12, // sesión del hub (navegador): 12 h
  cookieSecure: process.env.LOCKATUS_SECURE_COOKIE === "1",
  accessTokenTtl: "10m",                       // token de acceso CORTO (verificación offline)
  refreshTokenTtlMs: 1000 * 60 * 60 * 24 * 30, // refresh 30 días (revocable)
  secret: masterSecret(),
};

// Clave AES-256 derivada del secreto maestro: cifra los secretos TOTP y la clave privada en reposo.
export const aesKey = createHash("sha256").update(config.secret).digest();
