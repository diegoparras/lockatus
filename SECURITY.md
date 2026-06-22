# Seguridad — Lockatus

Lockatus es el hub de identidad de la suite: maneja credenciales, 2FA y roles. La seguridad es
prioridad de diseño. Si encontrás una vulnerabilidad, reportala en privado a
**diegoparras@gmail.com** (no abras un issue público).

## Postura

- **Contraseñas con scrypt** (KDF fuerte) + comparación en tiempo constante (`timingSafeEqual`).
- **2FA TOTP** (RFC 6238); el secreto se guarda **cifrado** (AES-256-GCM) en reposo, con códigos
  de recuperación (se guarda el hash, nunca el código) y reset de admin.
- **Tokens RS256 asimétricos**: el hub firma con su clave privada; las apps verifican con la
  pública (JWKS). Verificación **offline** → menos acoplamiento y resiliencia si el hub se cae.
- **Clave de firma** generada una vez y persistida **cifrada** en la base (la privada nunca sale en
  claro). Rotación = acción de admin.
- **Sesión del hub** como cookie firmada HMAC, `HttpOnly`, `SameSite`, `Secure` detrás de TLS.
- **Queries 100% parametrizadas** (`pg`, sin concatenación SQL).
- Contenedor como **usuario no-root**.

## Pendiente (en construcción)

El flujo OIDC (Authorization Code + PKCE) con `redirect_uri` allowlist, `state`/`nonce`, refresh +
revocación, rate-limit de login y lockout, y el endurecimiento completo (semgrep / OWASP ZAP /
Trivy / gitleaks como en el resto de la suite) se completan antes de cualquier deploy.
