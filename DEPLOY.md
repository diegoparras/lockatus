# Desplegar Lockatus

Lockatus es el hub de identidad de la suite. Self-hosted, una imagen Docker + su PostgreSQL.

## 1. Build / pull

```bash
git clone https://github.com/diegoparras/lockatus.git && cd lockatus
cp .env.example .env        # editá los valores de abajo
docker compose up -d --build
docker compose logs lockatus   # copiá la contraseña de admin generada (se imprime UNA vez)
```

## 2. Variables obligatorias (`.env`)

| Variable | Qué |
|---|---|
| `POSTGRES_PASSWORD` | contraseña de la base (fuerte) |
| `LOCKATUS_SECRET` | **clave maestra** — cifra los secretos TOTP y firma la sesión. `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. **Guardala**: si la perdés, hay que re-enrolar los 2FA. |
| `LOCKATUS_ISSUER` | la URL pública del hub (ej. `https://auth.tu-dominio.com`). Va en los tokens; **debe ser la que ven las apps**. |

`LOCKATUS_ADMIN_PASS` vacío → se genera y se imprime una vez. Detrás de TLS: `LOCKATUS_SECURE_COOKIE=1`.

## 3. Producción

- **TLS** con reverse proxy (Caddy/nginx o el del panel) y `LOCKATUS_SECURE_COOKIE=1`.
- **Cerrá el puerto de Postgres** (sacá el mapeo `127.0.0.1:55433` del compose).
- **Backups** del volumen `lockatus-pg` — es el padrón de usuarios + la clave de firma (cifrada).
- La clave de firma RS256 se **genera sola** al primer arranque y queda cifrada en la base; rotación
  futura = endpoint de admin (pendiente).

## 4. Federar las apps de la suite

1. **Registrar** cada app: cargá su `redirect_uri` (panel/API). El catálogo de roles ya viene sembrado.
2. **Asignar accesos** en la matriz (sin rol = sin acceso).
3. **En cada app**, prender el flag `AUTH_MODE=federado` apuntando a `LOCKATUS_ISSUER`:
   - **Apps Node**: cliente [`client/lockatus-client.mjs`](client/lockatus-client.mjs) (ESM) o el patrón CJS
     de [Fulgoria](https://github.com/diegoparras/fulgoria) (`lockatus.js`, sin deps). Ejemplo: [`examples/demo-app`](examples/demo-app).
   - **Apps Python (FastAPI)**: cliente [`clients/python/lockatus_client.py`](clients/python/lockatus_client.py).
     Ejemplo: [`examples/demo-py`](examples/demo-py).
   - Default `local` = la app sigue con su login propio → **rollear de a una, sin romper nada**.
   - **Escriba (producción) se federa última.**

## 5. Pre-deploy (gate del ecosistema)

El CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) corre `npm test` (núcleo) + la integración
(2FA/OIDC/recovery/SSO contra Postgres) y **solo entonces** publica la imagen a GHCR. No deployar en rojo.

## Pendiente del operador (Diego)

- Crear el repo **GitHub** `lockatus` + el package **GHCR** (público) — el CI publica al pushear.
- **Rotar los secretos viejos filtrados** de la suite en el mismo movimiento.
- Decidir SMTP si querés el **auto-servicio de recuperación por mail** (hoy: recuperación por admin).
- Definir la **marca** (acento provisional `#6655d6`).
