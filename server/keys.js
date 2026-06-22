// keys.js — clave de firma RS256 del emisor OIDC. Se GENERA una vez y se PERSISTE cifrada en la
// base (cero gestión manual de archivos). Las apps verifican los tokens con la pública vía JWKS.
import { generateKeyPair, exportPKCS8, exportSPKI, importPKCS8, importSPKI, exportJWK, calculateJwkThumbprint } from "jose";
import { getConfig, setConfig } from "./db.js";
import { encryptSecret, decryptSecret } from "./crypto.js";

let _priv = null, _pub = null, _jwks = null, _kid = null;

export async function initKeys() {
  let privEnc, spki;
  try { privEnc = await getConfig("oidc_priv"); spki = await getConfig("oidc_pub"); } catch { /* DB caída */ }

  if (privEnc && spki) {
    const pkcs8 = decryptSecret(privEnc);
    _priv = await importPKCS8(pkcs8, "RS256");
    _pub = await importSPKI(spki, "RS256");
  } else {
    const { publicKey, privateKey } = await generateKeyPair("RS256", { modulusLength: 2048, extractable: true });
    _priv = privateKey; _pub = publicKey;
    const pkcs8 = await exportPKCS8(privateKey);
    spki = await exportSPKI(publicKey);
    try { await setConfig("oidc_priv", encryptSecret(pkcs8)); await setConfig("oidc_pub", spki); }
    catch { console.warn("  ⚠ No se pudo persistir la clave de firma (DB?) — clave EFÍMERA en memoria."); }
  }

  const jwk = await exportJWK(_pub);
  _kid = await calculateJwkThumbprint(jwk);
  _jwks = { keys: [{ ...jwk, kid: _kid, use: "sig", alg: "RS256" }] };
}

export const getPrivateKey = () => _priv;
export const getKid = () => _kid;
export const getJwks = () => _jwks || { keys: [] };
