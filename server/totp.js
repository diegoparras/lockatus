// totp.js — 2FA por TOTP (RFC 6238). Compatible con Google Authenticator, Authy, 1Password, etc.
// El secreto se genera acá; se guarda CIFRADO (ver crypto.encryptSecret) en auth_factors.
import { authenticator } from "otplib";
import QRCode from "qrcode";

export const newSecret = () => authenticator.generateSecret();

// otpauth://… que el authenticator escanea. El "issuer" es lo que la app muestra en la lista.
export const otpauthUrl = (email, secret) => authenticator.keyuri(email, "Lockatus", secret);

export const qrDataUrl = (otpauth) => QRCode.toDataURL(otpauth);

export function verifyTotp(token, secret) {
  try { return authenticator.verify({ token: String(token).replace(/\s+/g, ""), secret }); }
  catch { return false; }
}
