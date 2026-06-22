# ADR-001 — Lockatus: hub de identidad de la Suite Escriba

- **Estado:** aceptado · 2026-06-22
- **Autor:** Diego Parras

## Contexto

Las apps de la suite (Escriba, Fisherboy, Anonimal, Fulgoria) son **single-user**: una
credencial por nivel/rol. Solo **Selega** es multiusuario de verdad (Postgres + tabla de usuarios
+ roles). Se quiere un **login unificado multiusuario**, con **2FA** y **auditoría opcional**,
**sin romper** nada de lo que ya corre.

## Decisión

**Lockatus** es el 6º componente: el **hub de identidad** de la suite — el tercer contrato que la
unifica, junto al sistema de diseño compartido y al handoff. **Generaliza la auth de Selega**
(la única app que ya resolvió multiusuario), no trae un IdP monolítico externo.

Decisiones cerradas:

1. **Opcional y no-rompe.** Cada app conserva su login standalone. La federación va detrás de un
   flag `AUTH_MODE=local|federado`, **default `local`** (= comportamiento de hoy). Reversible.
2. **Protocolo OIDC Authorization Code + PKCE.** Un solo mecanismo (redirect) cubre apps en el
   mismo server y en servers distintos. Standalone = la app no llama a Lockatus.
3. **Firma asimétrica (RS256).** El hub firma con su clave privada; las apps **verifican con la
   pública** (JWKS). Verificación **offline** → si el hub se cae, las sesiones vivas siguen
   andando; solo no se pueden iniciar nuevas.
4. **2FA TOTP** (Google Authenticator y compatibles) **en Lockatus, una vez**, heredado por todas
   las apps federadas. Con **códigos de recuperación** + **reset de admin**. Modelo de factores
   **extensible** (passkeys en v2 = agregar una fila, sin migrar).
5. **Roles shallow.** La app **declara su catálogo de roles**; Lockatus los **asigna** (la matriz
   de accesos). Cambiar el rol de una persona = cambiarle los permisos. **Qué hace** cada rol es
   dominio de la app. El modelo profundo (per-usuario real) solo donde la app *posee* recursos por
   persona — hoy, solo Selega.
6. **Multi-tenant: `org_id` reservado** en el modelo desde el día uno (aunque v1 use una sola org).
   La UI/admin multi-tenant completa es v2; el **borde** va en v1 porque es lo único caro de
   retrofitear.
7. **Tokens:** access **corto** + **refresh** (habilita revocación básica: un usuario dado de baja
   no puede refrescar). Logout único cross-domain (SLO) = v2.
8. **Auditoría partida:** **seguridad** (logins, 2FA, cambios de rol) **ON** por defecto;
   **actividad** (qué hace cada usuario dentro de cada app) **opt-in, OFF** por defecto, con
   indicador visible y retención configurable. Las apps emiten eventos de actividad **solo** si la
   org la activó.
9. Las 4 apps single-user **no se vuelven multiusuario por dentro**: Lockatus pasa a ser su
   **tabla de usuarios externa**. Aceptan identidad + rol del token y gatean por ese rol.

## Stack

Node (servidor HTTP propio, espejo de Selega) + **PostgreSQL** (`pg`) + frontend vanilla con el
sistema de diseño de la suite. **Cripto con librerías probadas**: `scrypt` (nativo de Node) para
contraseñas, **`jose`** (JWT/JWKS RS256), **`otplib`** (TOTP), `qrcode` (enrolar). Docker,
Apache-2.0. La clave de firma se **genera una vez y se persiste cifrada** en la base (cero gestión
manual de archivos de clave); rotación = acción de admin.

## Alcance

| Dimensión | v1 (núcleo) | v2 |
|---|---|---|
| Topología | standalone + federado (mismo y distinto server) | — |
| Identidad | cuentas locales | Google/MS, LDAP, BYO-IdP (gratis por ser OIDC) |
| 2FA | TOTP + recovery codes + reset admin | passkeys, magic link |
| Qué autentica | personas + API keys | M2M fino |
| Resiliencia | verificación offline (JWKS) | logout único (SLO) + revocación fina |
| Permisos | roles por app (la app declara, Lockatus asigna) | definición de permisos centralizada |
| Multi-tenant | `org_id` en el modelo (1 org) | UI/admin multi-org |
| Auditoría | seguridad (on) + actividad (opt-in, off) | dashboards, retención por org |

## Rollout (cada fase cierra sin romper la anterior)

0. **ADR** (este documento). 1. **Lockatus standalone** (repo nuevo, no toca ninguna app).
2. **Cliente compartido + 1 app piloto** detrás del flag, probado en compose local.
3. **App por app** (Fisherboy, Anonimal, Fulgoria, Selega), cada una por el gate de auditoría.
4. **Escriba (prod) última.** 5. **v2.**

## Riesgos / pendientes

Gestión y **rotación de claves** (privada cifrada en DB; rotar = endpoint admin). `redirect_uri`
con allowlist; `state`/`nonce`/PKCE anti-CSRF/replay; HTTPS obligatorio. Rotar los **secretos
viejos filtrados** de la suite en el mismo movimiento. **SLO** diferido a v2. Implicancia **legal**
de la auditoría de actividad: el default-off + indicador visible protegen; el que la prende es el
responsable.
