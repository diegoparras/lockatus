// api.js — router del backend. Por ahora: health + descubrimiento OIDC (issuer metadata + JWKS).
// El flujo Authorization Code + PKCE, el login con 2FA y el panel de accesos se cablean encima.
import { getJwks } from "./keys.js";
import { config } from "./config.js";

function json(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(obj));
}

export async function handle(req, res, path, dbOk) {
  if (path === "/health")
    return json(res, 200, { ok: true, service: "lockatus", db: dbOk });

  if (path === "/jwks.json" || path === "/.well-known/jwks.json")
    return json(res, 200, getJwks());

  if (path === "/.well-known/openid-configuration")
    return json(res, 200, {
      issuer: config.issuer,
      authorization_endpoint: `${config.issuer}/authorize`,
      token_endpoint: `${config.issuer}/token`,
      jwks_uri: `${config.issuer}/jwks.json`,
      userinfo_endpoint: `${config.issuer}/userinfo`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      id_token_signing_alg_values_supported: ["RS256"],
      scopes_supported: ["openid", "profile", "email", "roles"],
    });

  return json(res, 404, { error: "no encontrado" });
}
