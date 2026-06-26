// db.js — capa de datos sobre PostgreSQL (`pg`). Esquema, repositorio y seed. Todo acceso pasa por
// acá. Diseñado multi-tenant desde el día uno (org_id) y con factores de auth extensibles
// (password/totp/recovery/… passkey en v2 = otra fila). Funciones ASÍNCRONAS.
import pg from "pg";
import { randomBytes } from "node:crypto";
import { config } from "./config.js";
import { hashPassword, sha256, randomToken } from "./crypto.js";

const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });
const q = (text, params) => pool.query(text, params);

export async function initDb() {
  for (let i = 1; ; i++) {
    try { await q("SELECT 1"); break; }
    catch (e) { if (i >= 15) throw e; await new Promise((r) => setTimeout(r, 1000)); }
  }
  await q(`
    CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS orgs (
      id SERIAL PRIMARY KEY, slug TEXT UNIQUE NOT NULL, name TEXT,
      activity_audit BOOLEAN DEFAULT false, audit_retention_days INTEGER DEFAULT 90,
      creado TIMESTAMPTZ DEFAULT now());
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY, org_id INTEGER NOT NULL DEFAULT 1 REFERENCES orgs(id),
      email TEXT NOT NULL, name TEXT, status TEXT NOT NULL DEFAULT 'active',
      creado TIMESTAMPTZ DEFAULT now(), UNIQUE(org_id, email));
    ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT false;
    CREATE TABLE IF NOT EXISTS auth_factors (
      id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL, secret TEXT, data JSONB DEFAULT '{}',
      confirmed_at TIMESTAMPTZ, creado TIMESTAMPTZ DEFAULT now());
    CREATE TABLE IF NOT EXISTS apps (
      slug TEXT PRIMARY KEY, name TEXT, redirect_uris TEXT[] DEFAULT '{}',
      roles TEXT[] DEFAULT '{}', creado TIMESTAMPTZ DEFAULT now());
    CREATE TABLE IF NOT EXISTS role_assignments (
      id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      app_slug TEXT NOT NULL REFERENCES apps(slug) ON DELETE CASCADE,
      role TEXT NOT NULL, granted_by TEXT, granted TIMESTAMPTZ DEFAULT now(),
      UNIQUE(user_id, app_slug));
    CREATE TABLE IF NOT EXISTS api_keys (
      id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      app_slug TEXT, name TEXT, key_hash TEXT NOT NULL,
      creado TIMESTAMPTZ DEFAULT now(), last_used TIMESTAMPTZ);
    CREATE TABLE IF NOT EXISTS auth_codes (
      code_hash TEXT PRIMARY KEY, user_id INTEGER, app_slug TEXT, redirect_uri TEXT,
      code_challenge TEXT, scope TEXT, nonce TEXT, expires TIMESTAMPTZ);
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      token_hash TEXT PRIMARY KEY, user_id INTEGER, app_slug TEXT,
      expires TIMESTAMPTZ, revoked BOOLEAN DEFAULT false, creado TIMESTAMPTZ DEFAULT now());
    CREATE TABLE IF NOT EXISTS audit_security (
      id SERIAL PRIMARY KEY, ts TIMESTAMPTZ DEFAULT now(), org_id INTEGER,
      actor TEXT, event TEXT, target TEXT, ip TEXT);
    -- Tokens de alta/reset de contraseña: el LINK lleva el token EN CLARO; acá solo guardamos su
    -- HASH (sha256). Un solo uso (used_at) y con expiración (expires_at). Reemplaza a la contraseña
    -- temporal: el admin manda el link, el usuario pone SU propia clave (el admin nunca la ve).
    CREATE TABLE IF NOT EXISTS password_setup_tokens (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,                 -- 'alta' | 'reset'
      token_hash TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_by TEXT,
      creado TIMESTAMPTZ DEFAULT now());
    CREATE INDEX IF NOT EXISTS idx_setup_token_hash ON password_setup_tokens(token_hash);
    CREATE INDEX IF NOT EXISTS idx_setup_token_user ON password_setup_tokens(user_id);
    CREATE TABLE IF NOT EXISTS audit_activity (
      id SERIAL PRIMARY KEY, ts TIMESTAMPTZ DEFAULT now(), org_id INTEGER,
      user_email TEXT, app_slug TEXT, action TEXT, detail JSONB DEFAULT '{}');
    CREATE INDEX IF NOT EXISTS idx_factors_user ON auth_factors(user_id);
    CREATE INDEX IF NOT EXISTS idx_assign_user ON role_assignments(user_id);
    CREATE INDEX IF NOT EXISTS idx_assign_app ON role_assignments(app_slug);
    CREATE INDEX IF NOT EXISTS idx_audit_sec_ts ON audit_security(ts);
  `);
}

// ---- config k/v (cache corta; usado también para persistir la clave de firma) ----
let _cfg = null, _ts = 0;
async function loadCfg() {
  if (_cfg && Date.now() - _ts < 30000) return _cfg;
  _cfg = Object.fromEntries((await q("SELECT key,value FROM config")).rows.map((r) => [r.key, r.value]));
  _ts = Date.now();
  return _cfg;
}
export const getConfig = async (k, def = null) => { const c = await loadCfg(); return c[k] ?? def; };
export const setConfig = async (k, v) => {
  await q("INSERT INTO config(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    [k, v == null ? null : String(v)]);
  _ts = 0;
};

// ---- orgs ----
async function ensureDefaultOrg() {
  await q("INSERT INTO orgs(id,slug,name) VALUES(1,'default','Organización') ON CONFLICT(id) DO NOTHING");
  await q("SELECT setval(pg_get_serial_sequence('orgs','id'), GREATEST((SELECT MAX(id) FROM orgs),1))");
}

// ---- usuarios ----
export const getUserByEmail = async (email, org = 1) =>
  (await q("SELECT * FROM users WHERE org_id=$1 AND lower(email)=lower($2)", [org, email])).rows[0] || null;
export async function createUser({ email, name = "", org = 1, status = "active" }) {
  const r = await q("INSERT INTO users(org_id,email,name,status) VALUES($1,$2,$3,$4) RETURNING id", [org, email, name, status]);
  return r.rows[0].id;
}
export const setUserStatus = async (id, status) => void (await q("UPDATE users SET status=$1 WHERE id=$2", [status, id]));

// ---- factores de auth (password / totp / recovery / …) ----
export async function setPasswordFactor(userId, pw) {
  await q("DELETE FROM auth_factors WHERE user_id=$1 AND kind='password'", [userId]);
  await q("INSERT INTO auth_factors(user_id,kind,secret,confirmed_at) VALUES($1,'password',$2,now())", [userId, hashPassword(pw)]);
}
export const getPasswordHash = async (userId) =>
  (await q("SELECT secret FROM auth_factors WHERE user_id=$1 AND kind='password' LIMIT 1", [userId])).rows[0]?.secret || null;
export const getTotpFactor = async (userId) =>
  (await q("SELECT secret FROM auth_factors WHERE user_id=$1 AND kind='totp' AND confirmed_at IS NOT NULL LIMIT 1", [userId])).rows[0] || null;

// ---- apps (catálogo: cada app DECLARA sus roles; Lockatus los asigna) ----
export async function ensureApp(slug, name, roles, redirects = []) {
  await q(`INSERT INTO apps(slug,name,roles,redirect_uris) VALUES($1,$2,$3,$4)
           ON CONFLICT(slug) DO UPDATE SET name=excluded.name, roles=excluded.roles`,
    [slug, name, roles, redirects]);
}
export const listApps = async () => (await q("SELECT slug,name,roles FROM apps ORDER BY name")).rows;

// ---- asignaciones de rol (la matriz de accesos) ----
export const assignRole = async (userId, appSlug, role, by) => void (await q(
  `INSERT INTO role_assignments(user_id,app_slug,role,granted_by) VALUES($1,$2,$3,$4)
   ON CONFLICT(user_id,app_slug) DO UPDATE SET role=excluded.role, granted_by=excluded.granted_by, granted=now()`,
  [userId, appSlug, role, by]));
export const revokeRole = async (userId, appSlug) => void (await q("DELETE FROM role_assignments WHERE user_id=$1 AND app_slug=$2", [userId, appSlug]));
export const rolesDe = async (userId) =>
  Object.fromEntries((await q("SELECT app_slug,role FROM role_assignments WHERE user_id=$1", [userId])).rows.map((r) => [r.app_slug, r.role]));

export const getUserById = async (id) => (await q("SELECT id,email,name,status,org_id,must_change_password FROM users WHERE id=$1", [id])).rows[0] || null;
export const setMustChange = async (id, v) => void (await q("UPDATE users SET must_change_password=$1 WHERE id=$2", [!!v, id]));
export const removeTotpFactor = async (userId) => void (await q("DELETE FROM auth_factors WHERE user_id=$1 AND kind IN ('totp','recovery')", [userId]));
// Enrolado de 2FA: el secreto entra SIN confirmar; recién al validar un código se confirma.
export async function setTotpUnconfirmed(userId, encSecret) {
  await q("DELETE FROM auth_factors WHERE user_id=$1 AND kind='totp'", [userId]);
  await q("INSERT INTO auth_factors(user_id,kind,secret) VALUES($1,'totp',$2)", [userId, encSecret]);
}
export const getTotpRaw = async (userId) => (await q("SELECT secret, confirmed_at FROM auth_factors WHERE user_id=$1 AND kind='totp' LIMIT 1", [userId])).rows[0] || null;
export const confirmTotp = async (userId) => void (await q("UPDATE auth_factors SET confirmed_at=now() WHERE user_id=$1 AND kind='totp'", [userId]));
export async function setRecoveryCodes(userId, hashes) {
  await q("DELETE FROM auth_factors WHERE user_id=$1 AND kind='recovery'", [userId]);
  for (const h of hashes) await q("INSERT INTO auth_factors(user_id,kind,secret,data,confirmed_at) VALUES($1,'recovery',$2,'{\"used\":false}',now())", [userId, h]);
}
// Consume un código de recuperación (one-shot): lo marca usado y devuelve true si valía.
export const consumeRecovery = async (userId, hash) =>
  (await q("UPDATE auth_factors SET data=jsonb_set(data,'{used}','true') WHERE user_id=$1 AND kind='recovery' AND secret=$2 AND (data->>'used') IS DISTINCT FROM 'true' RETURNING id", [userId, hash])).rowCount > 0;
export async function createUserWithPassword({ email, name = "", org = 1 }, pass) {
  const id = await createUser({ email, name, org });
  await setPasswordFactor(id, pass);
  return id;
}

// La matriz de accesos: cada usuario con su mapa {app_slug: rol} y si tiene 2FA confirmado.
export const listMatrix = async (org = 1) => (await q(`
  SELECT u.id, u.email, u.name, u.status,
    EXISTS(SELECT 1 FROM auth_factors f WHERE f.user_id=u.id AND f.kind='totp' AND f.confirmed_at IS NOT NULL) AS totp,
    COALESCE(jsonb_object_agg(ra.app_slug, ra.role) FILTER (WHERE ra.app_slug IS NOT NULL), '{}'::jsonb) AS roles
  FROM users u LEFT JOIN role_assignments ra ON ra.user_id=u.id
  WHERE u.org_id=$1 GROUP BY u.id ORDER BY lower(u.email)`, [org])).rows;

export const getApp = async (slug) => (await q("SELECT slug,name,roles,redirect_uris FROM apps WHERE slug=$1", [slug])).rows[0] || null;
export const setRedirectUris = async (slug, uris) => void (await q("UPDATE apps SET redirect_uris=$1 WHERE slug=$2", [uris, slug]));
export const deleteApp = async (slug) => void (await q("DELETE FROM apps WHERE slug=$1", [slug])); // role_assignments cae por ON DELETE CASCADE
export const roleFor = async (userId, appSlug) => (await q("SELECT role FROM role_assignments WHERE user_id=$1 AND app_slug=$2", [userId, appSlug])).rows[0]?.role || null;

// ---- OIDC: códigos de autorización (un solo uso, cortos) + refresh tokens ----
export async function saveAuthCode({ code, userId, app, redirectUri, challenge, scope, nonce, ttlSec = 60 }) {
  await q(`INSERT INTO auth_codes(code_hash,user_id,app_slug,redirect_uri,code_challenge,scope,nonce,expires)
           VALUES($1,$2,$3,$4,$5,$6,$7, now() + ($8 || ' seconds')::interval)`,
    [sha256(code), userId, app, redirectUri, challenge, scope, nonce, String(ttlSec)]);
}
// Canjea el código: lo BORRA y lo devuelve (atómico → no se puede reusar).
export async function takeAuthCode(code) {
  const r = await q(`DELETE FROM auth_codes WHERE code_hash=$1 AND expires > now()
                     RETURNING user_id, app_slug, redirect_uri, code_challenge, scope, nonce`, [sha256(code)]);
  return r.rows[0] || null;
}
export async function saveRefreshToken({ token, userId, app, ttlMs }) {
  await q(`INSERT INTO refresh_tokens(token_hash,user_id,app_slug,expires)
           VALUES($1,$2,$3, now() + ($4 || ' milliseconds')::interval)`, [sha256(token), userId, app, String(ttlMs)]);
}
export const getRefreshToken = async (token) =>
  (await q("SELECT user_id, app_slug FROM refresh_tokens WHERE token_hash=$1 AND revoked=false AND expires > now()", [sha256(token)])).rows[0] || null;
// Al cambiar/resetear la contraseña: matar todos los refresh tokens del usuario (lo saca de todas las apps).
export const revokeAllRefresh = async (userId) => void (await q("UPDATE refresh_tokens SET revoked=true WHERE user_id=$1", [userId]));

// ---- tokens de alta/reset de contraseña (link de un solo uso, hash en reposo) ----
// Genera un token nuevo: el VALOR EN CLARO solo se devuelve acá (va en el link), en la DB queda
// únicamente el sha256. TTL según el tipo ('alta' 72h, 'reset' 1h). Invalida tokens previos del
// mismo usuario+tipo aún sin usar (un solo link vivo a la vez por flujo).
export async function createSetupToken(userId, kind, createdBy = "") {
  const k = kind === "reset" ? "reset" : "alta";
  const ttlMs = k === "reset" ? config.setupTokenResetTtlMs : config.setupTokenAltaTtlMs;
  const token = randomToken(32); // ≥32 bytes aleatorios, base64url
  await q("UPDATE password_setup_tokens SET used_at=now() WHERE user_id=$1 AND kind=$2 AND used_at IS NULL", [userId, k]);
  await q(`INSERT INTO password_setup_tokens(user_id, kind, token_hash, expires_at, created_by)
           VALUES($1,$2,$3, now() + ($4 || ' milliseconds')::interval, $5)`,
    [userId, k, sha256(token), String(ttlMs), createdBy]);
  const link = `${config.appUrl}/set-password?token=${token}`;
  return { token, link, kind: k };
}
// Consume un token: lo busca POR HASH, valida que no esté usado ni vencido, lo marca usado de forma
// ATÓMICA (un solo uso aunque haya carrera) y devuelve {userId, kind}. Null si no vale (genérico:
// quien llama da un error sin revelar si el usuario existe → anti-enumeración).
export async function consumeSetupToken(token) {
  if (!token || typeof token !== "string") return null;
  const r = await q(
    `UPDATE password_setup_tokens SET used_at=now()
       WHERE token_hash=$1 AND used_at IS NULL AND expires_at > now()
       RETURNING user_id, kind`, [sha256(token)]);
  const row = r.rows[0];
  return row ? { userId: row.user_id, kind: row.kind } : null;
}

// ---- auditoría de seguridad (siempre on) ----
export const auditSec = async (actor, event, target = "", org = 1, ip = "") =>
  void (await q("INSERT INTO audit_security(org_id,actor,event,target,ip) VALUES($1,$2,$3,$4,$5)", [org, actor, event, target, ip]));

// ---- seed / comisión inicial ----
export async function seedAdmin() {
  await ensureDefaultOrg();
  // Catálogo de la suite, para que la matriz de accesos tenga sentido out-of-the-box.
  await ensureApp("lockatus", "Lockatus", ["admin"]);
  await ensureApp("escriba", "Escriba", ["dueño", "editor", "lector"]);
  await ensureApp("fisherboy", "Fisherboy", ["dios", "angel", "humano"]);
  await ensureApp("anonimal", "Anonimal", ["admin", "editor", "lector"]);
  await ensureApp("fulgoria", "Fulgoria", ["admin", "editor", "lector"]);
  await ensureApp("trustux", "Trustux", ["admin", "editor", "lector"]);
  await ensureApp("arcanum", "Arcanum", ["admin", "editor", "lector"]);
  await ensureApp("selega", "Selega", ["agente", "supervisor", "auditor", "admin", "superadmin"]);

  const existing = await getUserByEmail(config.adminEmail);
  if (existing) {
    if (config.adminPass) await setPasswordFactor(existing.id, config.adminPass); // reset → nunca quedás afuera
    return null;
  }
  // Cambiaron LOCKATUS_ADMIN_EMAIL después del primer arranque: renombramos el admin DEFAULT de
  // fábrica (admin@lockatus.local) al email configurado, en vez de crear un admin duplicado.
  // Seguro: solo toca ese default y solo cuando el email nuevo está libre (estamos en este branch).
  const DEFAULT_ADMIN = "admin@lockatus.local";
  if (config.adminEmail !== DEFAULT_ADMIN) {
    const legacy = await getUserByEmail(DEFAULT_ADMIN);
    if (legacy) {
      await q("UPDATE users SET email=$1 WHERE id=$2", [config.adminEmail, legacy.id]);
      if (config.adminPass) await setPasswordFactor(legacy.id, config.adminPass);
      await auditSec("sistema", "admin_email_rename", `${DEFAULT_ADMIN} -> ${config.adminEmail}`);
      return null;
    }
  }
  const pass = config.adminPass || randomBytes(6).toString("base64url");
  const id = await createUser({ email: config.adminEmail, name: "Admin" });
  await setPasswordFactor(id, pass);
  await assignRole(id, "lockatus", "admin", "sistema");
  await auditSec("sistema", "seed_admin", config.adminEmail);
  return config.adminPass ? null : pass; // pass generada → se imprime una vez
}
