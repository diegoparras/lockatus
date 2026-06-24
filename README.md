# Lockatus

**Hub de identidad y SSO de la Suite [Escriba](https://github.com/diegoparras/escriba).** Un solo
login multiusuario para todas las apps de la familia, con **2FA (TOTP)**, **OIDC** (Authorization
Code + PKCE), **roles por app** y **auditoría opcional**. Self-hosted, Apache-2.0.

> Estado: **v0.1 — scaffold** (Fase 1). Base de seguridad y modelo de datos listos; el flujo de
> login con 2FA y el panel de accesos se cablean encima. Ver [docs/ADR-001-lockatus.md](docs/ADR-001-lockatus.md).

## Qué es

Las apps de la suite (Escriba, Fisherboy, Anonimal, Fulgoria) son single-user; solo Selega es
multiusuario. Lockatus es el **padrón de personas y el portero** común: tiene los usuarios, sus
contraseñas, su 2FA y sus **roles por app**, y les da un pase firmado para entrar a cualquier app
sin reloguear (SSO). Es **opcional** y **no rompe** nada: cada app conserva su login standalone;
la federación va detrás de un flag, apagada por defecto.

## Instalación (Docker)

```bash
git clone https://github.com/diegoparras/lockatus.git && cd lockatus
cp .env.example .env        # editá POSTGRES_PASSWORD y LOCKATUS_SECRET (clave maestra)
docker compose up -d --build
docker compose logs lockatus   # acá se imprime la contraseña de admin generada (una vez)
# → http://localhost:8081
```

La **clave maestra** `LOCKATUS_SECRET` cifra los secretos TOTP y firma la sesión; generala con
`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. La clave de firma OIDC
(RS256) se **genera sola** en el primer arranque y se guarda cifrada en la base.

## Endpoints (descubrimiento OIDC)

| Ruta | Para qué |
|---|---|
| `GET /health` | salud del servicio (+ estado de la base) |
| `GET /.well-known/openid-configuration` | metadata del emisor (issuer) |
| `GET /jwks.json` | clave pública para que las apps **verifiquen los tokens offline** |

## Variables de entorno

| Variable | Default | Para qué |
|---|---|---|
| `POSTGRES_PASSWORD` | — (**obligatoria**) | contraseña de la base |
| `LOCKATUS_SECRET` | — (**obligatoria**) | clave maestra (cifra TOTP + firma la sesión) |
| `LOCKATUS_ISSUER` | `http://localhost:8081` | URL pública del emisor (va en los tokens) |
| `LOCKATUS_ADMIN_EMAIL` | `admin@lockatus.local` | primer superadmin |
| `LOCKATUS_ADMIN_PASS` | *(vacío)* | vacío → se genera y se imprime una vez en los logs |
| `LOCKATUS_SECURE_COOKIE` | `0` | poné `1` detrás de TLS |
| `LOCKATUS_PORT` | `8081` | puerto del host |

## Integrar una app (federación)

Una app se federa con Lockatus sin volverse multiusuario por dentro: Lockatus es su tabla de
usuarios externa. Pasos:

1. **Registrar la app**: en el panel (o por API) cargá su `redirect_uri` en el catálogo. Las apps
   de la suite ya vienen sembradas con su catálogo de roles.
2. **Asignar accesos**: en la matriz, dale a cada persona su rol en esa app (sin rol = sin acceso).
3. **En la app (Node)**: usá el cliente [`client/lockatus-client.mjs`](client/lockatus-client.mjs) —
   `beginLogin` / `handleCallback` / `getUser` / `logout`. El `getUser(req).role` viene del token;
   tu app aplica ese rol con su lógica. Todo detrás de un flag (`AUTH_MODE=local|federado`,
   default `local` → la app sigue con su login propio; no rompe nada).

Ejemplo completo y corrible: [`examples/demo-app/server.mjs`](examples/demo-app/server.mjs)
(`npm run demo`, con Lockatus arriba). El flujo es OIDC estándar (Authorization Code + PKCE), así
que cualquier cliente OIDC sirve — y las apps quedan listas para apuntar a otro IdP si hiciera falta.

## Stack

Node (servidor HTTP propio) · PostgreSQL (`pg`) · `jose` (JWT/JWKS RS256) · `otplib` (TOTP) ·
`qrcode` · scrypt (nativo) · frontend vanilla. Generaliza la auth de Selega. Parte de la familia
Escriba.
