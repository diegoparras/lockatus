// crypto.js — primitivas de cripto. Contraseñas con scrypt (KDF fuerte) + comparación en tiempo
// constante. Cifrado AES-256-GCM de secretos en reposo (TOTP, clave privada). Tokens aleatorios.
import { scryptSync, randomBytes, timingSafeEqual, createHash, createCipheriv, createDecipheriv } from "node:crypto";
import { aesKey } from "./config.js";

export function hashPassword(pw) {
  const salt = randomBytes(16);
  const hash = scryptSync(String(pw), salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPassword(pw, stored) {
  if (!stored || !stored.includes(":")) return false;
  const [s, h] = stored.split(":");
  const hash = scryptSync(String(pw), Buffer.from(s, "hex"), 64);
  const hb = Buffer.from(h, "hex");
  return hash.length === hb.length && timingSafeEqual(hash, hb);
}

// AES-256-GCM: devuelve iv:tag:ciphertext (hex). Para secretos que hay que recuperar (TOTP).
export function encryptSecret(plain) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", aesKey, iv);
  const enc = Buffer.concat([c.update(String(plain), "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("hex")).join(":");
}

export function decryptSecret(stored) {
  try {
    const [iv, tag, enc] = stored.split(":").map((x) => Buffer.from(x, "hex"));
    const d = createDecipheriv("aes-256-gcm", aesKey, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
  } catch { return null; }
}

export const sha256 = (s) => createHash("sha256").update(String(s)).digest("hex");
// PKCE S256: BASE64URL(SHA256(code_verifier)).
export const sha256b64url = (s) => createHash("sha256").update(String(s)).digest("base64url");
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

// Códigos de recuperación de 2FA: legibles, agrupados. Se guarda el hash, nunca el código.
export function genRecoveryCodes(n = 10) {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sin 0/O/1/I para evitar confusión
  const one = () => Array.from(randomBytes(8)).map((b) => abc[b % abc.length]).join("");
  return Array.from({ length: n }, () => `${one().slice(0, 4)}-${one().slice(4, 8)}`);
}
