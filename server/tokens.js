// tokens.js — emisión de tokens. Access/ID tokens firmados RS256 (asimétrico, verificables offline
// por las apps vía JWKS). Sesión del HUB como cookie firmada HMAC (stateless, sin store).
import { SignJWT, jwtVerify } from "jose";
import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";
import { getPrivateKey, getPublicKey, getKid } from "./keys.js";

// Token de acceso para una app: lleva quién sos (sub/email/org) y tu rol EN ESA app.
export async function signAccessToken({ sub, email, app, role, org }) {
  return new SignJWT({ email, role, org, typ: "access" })
    .setProtectedHeader({ alg: "RS256", kid: getKid() })
    .setSubject(String(sub))
    .setIssuer(config.issuer)
    .setAudience(app)
    .setIssuedAt()
    .setExpirationTime(config.accessTokenTtl)
    .sign(getPrivateKey());
}

// ID token OIDC: identidad del usuario para la app (claims estándar + nonce).
export async function signIdToken({ sub, email, name, app, nonce }) {
  const t = new SignJWT({ email, name, ...(nonce ? { nonce } : {}), typ: "id" })
    .setProtectedHeader({ alg: "RS256", kid: getKid() })
    .setSubject(String(sub)).setIssuer(config.issuer).setAudience(app)
    .setIssuedAt().setExpirationTime("1h");
  return t.sign(getPrivateKey());
}

// Verificación local del access token (lo que hace una app, u /userinfo del propio hub).
export async function verifyAccessToken(token) {
  try { const { payload } = await jwtVerify(token, getPublicKey(), { issuer: config.issuer }); return payload; }
  catch { return null; }
}

// --- Sesión del hub (navegador): cookie firmada HMAC, stateless ---
export function signSession(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = createHmac("sha256", config.secret).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function verifySession(cookie) {
  if (!cookie || !cookie.includes(".")) return null;
  const [body, mac] = cookie.split(".");
  const expected = createHmac("sha256", config.secret).update(body).digest("base64url");
  const a = Buffer.from(mac), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString());
    if (p.exp && p.exp < Date.now()) return null;
    return p;
  } catch { return null; }
}
