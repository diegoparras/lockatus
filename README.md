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

## Stack

Node (servidor HTTP propio) · PostgreSQL (`pg`) · `jose` (JWT/JWKS RS256) · `otplib` (TOTP) ·
`qrcode` · scrypt (nativo) · frontend vanilla. Generaliza la auth de Selega. Parte de la familia
Escriba.
