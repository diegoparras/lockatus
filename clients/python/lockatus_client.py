"""lockatus_client.py — cliente OIDC para apps Python (FastAPI/Starlette/…) que se federan con
Lockatus, el hub de identidad de la suite. Sin PyJWT: verifica los tokens RS256 con `cryptography`
contra el JWKS del hub (offline). Maneja el flujo Authorization Code + PKCE y firma la sesión local
de la app (HMAC). El "quién sos" lo pone Lockatus; el rol viene en el token.

    lk = Lockatus(issuer, client_id, redirect_uri, secret)
    # /login: redirige a lk.authorize_url(...) con la cookie de transacción lk.sign({verifier,...})
    # /callback: lk.exchange(code, verifier) -> lk.verify_jwt(id/access) -> setea cookie lk.sign({...})
"""
import base64
import hashlib
import hmac
import json
import secrets
import time
import urllib.parse

import httpx
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding, rsa

_now_ms = lambda: int(time.time() * 1000)
_b64d = lambda s: base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))
_b64e = lambda b: base64.urlsafe_b64encode(b).rstrip(b"=").decode()


class Lockatus:
    def __init__(self, issuer, client_id, redirect_uri, secret):
        self.issuer = issuer.rstrip("/")
        self.client_id = client_id
        self.redirect_uri = redirect_uri
        self.secret = secret.encode() if isinstance(secret, str) else secret
        self._jwks = None
        self._jwks_at = 0.0

    # --- PKCE + URL de autorización ---
    def pkce(self):
        verifier = _b64e(secrets.token_bytes(32))
        challenge = _b64e(hashlib.sha256(verifier.encode()).digest())
        return verifier, challenge

    def authorize_url(self, state, nonce, challenge):
        q = urllib.parse.urlencode({
            "client_id": self.client_id, "redirect_uri": self.redirect_uri,
            "response_type": "code", "scope": "openid email", "state": state,
            "nonce": nonce, "code_challenge": challenge, "code_challenge_method": "S256",
        })
        return f"{self.issuer}/authorize?{q}"

    # --- canje del código por tokens ---
    async def exchange(self, code, verifier):
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.post(f"{self.issuer}/token", data={
                "grant_type": "authorization_code", "code": code,
                "redirect_uri": self.redirect_uri, "client_id": self.client_id,
                "code_verifier": verifier,
            })
        tok = r.json()
        if "access_token" not in tok:
            raise ValueError("no se pudo canjear el código")
        return tok

    # --- verificación RS256 contra el JWKS del hub ---
    async def _keys(self):
        if self._jwks and time.time() - self._jwks_at < 3600:
            return self._jwks
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.get(f"{self.issuer}/jwks.json")
        self._jwks = r.json().get("keys", [])
        self._jwks_at = time.time()
        return self._jwks

    async def verify_jwt(self, token, audience=None, nonce=None):
        h_b, p_b, s_b = token.split(".")
        header = json.loads(_b64d(h_b))
        keys = await self._keys()
        jwk = next((k for k in keys if k.get("kid") == header.get("kid")), keys[0] if keys else None)
        if not jwk:
            raise ValueError("sin clave en el JWKS")
        n = int.from_bytes(_b64d(jwk["n"]), "big")
        e = int.from_bytes(_b64d(jwk["e"]), "big")
        pub = rsa.RSAPublicNumbers(e, n).public_key()
        pub.verify(_b64d(s_b), f"{h_b}.{p_b}".encode(), padding.PKCS1v15(), hashes.SHA256())  # lanza si falla
        c = json.loads(_b64d(p_b))
        if c.get("iss") != self.issuer:
            raise ValueError("iss inválido")
        aud = c.get("aud")
        aud = aud if isinstance(aud, list) else [aud]
        if audience and audience not in aud:
            raise ValueError("aud inválido")
        if c.get("exp") and c["exp"] * 1000 < _now_ms():
            raise ValueError("token expirado")
        if nonce and c.get("nonce") != nonce:
            raise ValueError("nonce inválido")
        return c

    # --- sesión local de la app (cookie firmada HMAC, sin estado) ---
    def sign(self, obj):
        body = _b64e(json.dumps(obj, separators=(",", ":")).encode())
        mac = _b64e(hmac.new(self.secret, body.encode(), hashlib.sha256).digest())
        return f"{body}.{mac}"

    def unsign(self, token):
        try:
            body, mac = (token or "").split(".")
            exp = _b64e(hmac.new(self.secret, body.encode(), hashlib.sha256).digest())
            if not hmac.compare_digest(mac, exp):
                return None
            o = json.loads(_b64d(body))
            if o.get("exp") and o["exp"] < _now_ms():
                return None
            return o
        except Exception:
            return None
