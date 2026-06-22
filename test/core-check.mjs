// core-check.mjs — verificación del núcleo de seguridad (sin DB). Genera la clave de firma,
// emite un access token y lo valida como lo haría una app vía JWKS; prueba sesión y TOTP.
import { initKeys, getJwks, getKid } from "../server/keys.js";
import { signAccessToken, signSession, verifySession } from "../server/tokens.js";
import { newSecret, verifyTotp } from "../server/totp.js";
import { encryptSecret, decryptSecret, genRecoveryCodes } from "../server/crypto.js";
import { authenticator } from "otplib";
import { jwtVerify, importJWK } from "jose";

let ok = 0, fail = 0;
const check = (name, cond) => { if (cond) { ok++; console.log("  ✓", name); } else { fail++; console.log("  ✗", name); } };

await initKeys(); // sin DB → clave efímera en memoria (igual sirve para el test)
const jwks = getJwks();
check("JWKS expone 1 clave pública con kid", jwks.keys.length === 1 && !!getKid());

const token = await signAccessToken({ sub: 7, email: "maria@org.com", app: "escriba", role: "editor", org: 1 });
const pub = await importJWK(jwks.keys[0], "RS256");
const { payload } = await jwtVerify(token, pub, { issuer: "http://localhost:8081", audience: "escriba" });
check("una app verifica el token con la pública (offline)", payload.email === "maria@org.com" && payload.role === "editor");

let rejected = false;
try { await jwtVerify(token, pub, { issuer: "http://localhost:8081", audience: "fisherboy" }); }
catch { rejected = true; }
check("el token de Escriba NO sirve para otra app (aud)", rejected);

const cookie = signSession({ uid: 1, exp: Date.now() + 10000 });
check("sesión del hub: roundtrip", !!verifySession(cookie));
check("sesión del hub: detecta manipulación", verifySession(cookie.slice(0, -2) + "zz") === null);

const sec = newSecret();
check("TOTP: código válido pasa", verifyTotp(authenticator.generate(sec), sec));
check("TOTP: código inválido falla", !verifyTotp("000000", sec));

const enc = encryptSecret(sec);
check("secreto cifrado en reposo se recupera", decryptSecret(enc) === sec && enc !== sec);
check("códigos de recuperación: 10, formato xxxx-xxxx", genRecoveryCodes().length === 10 && /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(genRecoveryCodes()[0]));

console.log(`\n${fail === 0 ? "TODO OK ✅" : "HAY FALLAS ❌"}  (${ok} ok, ${fail} fail)`);
process.exit(fail === 0 ? 0 : 1);
