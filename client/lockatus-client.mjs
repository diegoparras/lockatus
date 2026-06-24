// lockatus-client.mjs — cliente OIDC para apps Node que se federan con Lockatus.
// Agnóstico de framework (toma req/res de node:http). Maneja el flujo Authorization Code + PKCE,
// verifica los tokens con el JWKS del hub (offline) y deja una sesión LOCAL de la app (su cookie,
// su dominio). El "quién sos" lo pone Lockatus; el "qué podés hacer" lo aplica tu app con `user.role`.
//
//   import { createLockatusClient } from "./lockatus-client.mjs";
//   const lk = createLockatusClient({ issuer, clientId, redirectUri, secret });
//   // /login → lk.beginLogin(req,res) · /callback → lk.handleCallback(req,res)
//   // en cada request → const user = lk.getUser(req)  ·  /logout → lk.logout(req,res)
import { createRemoteJWKSet, jwtVerify } from "jose";
import { createHmac, createHash, randomBytes, timingSafeEqual } from "node:crypto";

const b64 = (b) => Buffer.from(b).toString("base64url");
const sign = (obj, secret) => {
  const body = Buffer.from(JSON.stringify(obj)).toString("base64url");
  return body + "." + createHmac("sha256", secret).update(body).digest("base64url");
};
const unsign = (token, secret) => {
  if (!token || !token.includes(".")) return null;
  const [body, mac] = token.split(".");
  const exp = createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(mac), e = Buffer.from(exp);
  if (a.length !== e.length || !timingSafeEqual(a, e)) return null;
  try { const o = JSON.parse(Buffer.from(body, "base64url").toString()); if (o.exp && o.exp < Date.now()) return null; return o; } catch { return null; }
};
const parseCookies = (req) => Object.fromEntries((req.headers.cookie || "").split(";").map((c) => {
  const i = c.indexOf("="); return i < 0 ? [c.trim(), ""] : [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1).trim())];
}).filter((x) => x[0]));
const cookie = (name, val, { maxAge = 3600, clear = false, secure = false } = {}) =>
  `${name}=${clear ? "" : val}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : maxAge}${secure ? "; Secure" : ""}`;

export function createLockatusClient({ issuer, clientId, redirectUri, secret, sessionCookie = "lk_session", sessionTtlMs = 12 * 3600e3, postLogin = "/", secure = false }) {
  issuer = issuer.replace(/\/$/, "");
  const JWKS = createRemoteJWKSet(new URL(issuer + "/jwks.json"));
  const TX = "lk_tx";

  return {
    // Manda al usuario a Lockatus (guarda verifier/state/nonce en una cookie de transacción firmada).
    beginLogin(req, res) {
      const verifier = b64(randomBytes(32));
      const challenge = createHash("sha256").update(verifier).digest("base64url");
      const state = b64(randomBytes(16)), nonce = b64(randomBytes(16));
      const tx = sign({ verifier, state, nonce, exp: Date.now() + 600e3 }, secret);
      const url = issuer + "/authorize?" + new URLSearchParams({
        client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: "openid email",
        state, nonce, code_challenge: challenge, code_challenge_method: "S256",
      });
      res.writeHead(302, { "Set-Cookie": cookie(TX, tx, { maxAge: 600, secure }), Location: url });
      res.end();
    },

    // Vuelve de Lockatus: canjea el código, verifica los tokens con el JWKS y crea la sesión local.
    async handleCallback(req, res) {
      const u = new URL(req.url, "http://local");
      const code = u.searchParams.get("code"), state = u.searchParams.get("state"), err = u.searchParams.get("error");
      const tx = unsign(parseCookies(req)[TX], secret);
      const fail = (c, m) => { res.writeHead(c, { "Content-Type": "text/html; charset=utf-8" }); res.end(`<p>${m}</p>`); return null; };
      if (err) return fail(403, "Acceso denegado por Lockatus: " + err);
      if (!tx || !code || state !== tx.state) return fail(400, "Estado de login inválido.");
      const tr = await fetch(issuer + "/token", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: clientId, code_verifier: tx.verifier }),
      });
      const tok = await tr.json().catch(() => ({}));
      if (!tok.access_token) return fail(400, "No se pudo canjear el código.");
      try {
        const { payload: id } = await jwtVerify(tok.id_token, JWKS, { issuer, audience: clientId });
        if (id.nonce !== tx.nonce) return fail(400, "nonce inválido.");
        const { payload: ac } = await jwtVerify(tok.access_token, JWKS, { issuer, audience: clientId });
        const user = { sub: id.sub, email: id.email, name: id.name, role: ac.role };
        const sess = sign({ ...user, exp: Date.now() + sessionTtlMs }, secret);
        res.writeHead(302, { "Set-Cookie": [cookie(sessionCookie, sess, { maxAge: Math.floor(sessionTtlMs / 1000), secure }), cookie(TX, "", { clear: true })], Location: postLogin });
        res.end();
        return user;
      } catch { return fail(400, "Token inválido."); }
    },

    getUser(req) {
      const s = unsign(parseCookies(req)[sessionCookie], secret);
      return s ? { sub: s.sub, email: s.email, name: s.name, role: s.role } : null;
    },

    logout(req, res, to = "/") {
      res.writeHead(302, { "Set-Cookie": cookie(sessionCookie, "", { clear: true }), Location: to });
      res.end();
    },
  };
}
