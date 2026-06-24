# Agregar una app nueva de la familia Escriba a Lockatus

Lockatus es el hub de identidad de la suite. **Cualquier app nueva de la familia** (hoy:
Escriba, Fisherboy, Anonimal, Fulgoria, Selega, Trustux; mañana las que vengan) se suma al
login unificado sin reescribir el hub. Son dos lados: **declararla en el hub** y **vendorizar
el cliente OIDC en la app**.

## 1. Declarar la app en el hub

La app declara su **slug** y su **catálogo de roles** (los roles que ella entiende). Dos formas:

- **En caliente, sin redeploy** (recomendado para apps nuevas) — endpoint admin:
  ```
  PUT /api/admin/apps/<slug>
  { "name": "Trustux", "roles": ["admin","editor","lector"],
    "redirect_uris": ["https://trustux.tu-dominio/callback"] }
  ```
- **Permanente** (queda en el seed) — agregar una línea en `seedAdmin()` (`server/db.js`):
  ```js
  await ensureApp("trustux", "Trustux", ["admin", "editor", "lector"]);
  ```

Después:
- **Registrar el/los redirect_uri** (a dónde vuelve el navegador tras el login). Debe coincidir
  EXACTO con el que manda la app: `PUT /api/admin/apps/<slug>/redirect-uris { "redirect_uris": [...] }`.
- **Asignar roles** a los usuarios en la matriz (pantalla de accesos del admin, o
  `PUT /api/admin/users/<id>/role { "app": "<slug>", "role": "<rol>" }`). Sin rol para esa app,
  el usuario recibe `access_denied` al intentar entrar (gating por la matriz).

> El script `scripts/seed-suite.mjs` hace los dos últimos pasos para todas las apps de la suite
> de una (útil para el `docker-compose.suite.yml`).

## 2. Vendorizar el cliente OIDC en la app

La app conserva su login propio; la federación va detrás de un flag `AUTH_MODE=local|federado`
(default `local` = no cambia nada). En `federado`:

- `/login` → arma PKCE (S256) + `state` + `nonce`, los guarda firmados en una cookie de
  transacción, y redirige al `/authorize` del hub.
- `/callback` → canjea el `code` (`/token`), **verifica los JWT RS256 contra el JWKS del hub
  (offline)**, y siembra la MISMA cookie de sesión que el login propio → el resto del gate por
  rol de la app no cambia. El rol viene en el access token (claim `role`).

No hace falta sumar dependencias pesadas: el cliente verifica RS256 con la cripto nativa.

| Stack  | Cliente de referencia                          | Apps que ya lo usan       |
|--------|------------------------------------------------|---------------------------|
| Node   | `node:crypto` (sin deps) — ver `fulgoria/lockatus.js` o `selega/server/lockatus.js` | Fulgoria, Selega |
| Python | `cryptography` (import lazy) — ver `anonimal/app/lockatus_client.py` | Anonimal, Fisherboy |

**App multiusuario** (como Selega): en el `/callback`, hacé **find-or-create** del usuario por
email y mapeá el rol del hub a tu catálogo (ver `selega/server/db.js: upsertFederatedUser`). El
hub pasa a ser la fuente de verdad de identidad y rol.

**App single-user**: la cookie de sesión solo prueba "autenticado" (Anonimal) o lleva el rol
mapeado (Fisherboy). No necesitás tabla de usuarios.

## 3. Sumarla al compose de la suite (opcional)

Si la corrés en el `docker-compose.suite.yml`: agregá el service con `AUTH_MODE=federado`,
`LOCKATUS_ISSUER=http://host.docker.internal:8081`, `LOCKATUS_CLIENT_ID=<slug>` y
`LOCKATUS_REDIRECT_URI=http://host.docker.internal:<puerto>/callback`, y sumá el slug + puerto a
`scripts/seed-suite.mjs`.

---

**Trustux** ya está declarado en el catálogo del hub. Hoy es CLI/librería de verificación de
firma (sin web server todavía); cuando tenga su UI web, federa como las demás siguiendo el
patrón Node de arriba.
