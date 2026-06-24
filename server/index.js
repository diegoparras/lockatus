// index.js — servidor de Lockatus: sirve el front estático y enruta API + endpoints OIDC.
// No-fatal si Postgres no está: igual levanta y responde /health y /jwks (clave efímera).
import http from "node:http";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { extname, join, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { initDb, seedAdmin } from "./db.js";
import { initKeys } from "./keys.js";
import { handle } from "./api.js";

const root = normalize(join(dirname(fileURLToPath(import.meta.url)), ".."));
// Versión: única fuente = package.json. Se inyecta en el HTML (el "Acerca de" la lee del <meta>).
const VERSION = (() => { try { return JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version || ""; } catch { return ""; } })();
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".png": "image/png", ".woff2": "font/woff2" };
const API = new Set(["/health", "/jwks.json", "/authorize", "/token", "/userinfo"]);
const isApi = (p) => API.has(p) || p === "/api" || p.startsWith("/api/") || p.startsWith("/.well-known/");
const BLOQUEADO = (p) => p.startsWith("/server") || p.startsWith("/node_modules") || p.startsWith("/keys") ||
  p.startsWith("/docs") || p.startsWith("/test") || p.endsWith(".env") || p === "/package.json";

let dbOk = false;

const server = http.createServer(async (req, res) => {
  const path = decodeURIComponent(req.url.split("?")[0]);
  try {
    if (isApi(path)) return await handle(req, res, path, dbOk);
    const txt = { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" };
    if (BLOQUEADO(path)) { res.writeHead(403, txt); return res.end("forbidden"); }
    const rel = path.startsWith("/public/") ? path : "/src" + (path === "/" ? "/index.html" : path);
    const file = normalize(join(root, rel));
    if (!file.startsWith(root)) { res.writeHead(403, txt); return res.end("forbidden"); }
    let data = await readFile(file);
    // index.html: inyectar la versión (placeholder __LOCKATUS_VERSION__) desde package.json.
    if (extname(file) === ".html") data = Buffer.from(data.toString("utf8").replace(/__LOCKATUS_VERSION__/g, VERSION), "utf8");
    res.writeHead(200, {
      "Content-Type": MIME[extname(file)] || "application/octet-stream",
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
      // Defensa en profundidad: solo recursos propios. `data:` en img por el QR del 2FA;
      // `unsafe-inline` en style por los style="" que arma el front. Sin framing, sin object.
      "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; " +
        "script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    });
    res.end(data);
  } catch { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); res.end("not found"); }
});

let port = config.port;
server.on("error", (e) => {
  if (e.code === "EADDRINUSE" && port < config.port + 20) {
    console.warn(`  Puerto ${port} ocupado, probando ${port + 1}…`);
    port += 1; setTimeout(() => server.listen(port), 80);
  } else { throw e; }
});
server.on("listening", () => {
  const p = server.address().port;
  console.log(`\n  Lockatus → http://localhost:${p}   (iss: ${config.issuer})`);
  if (!dbOk) console.log("  ⚠ Postgres no disponible — /health y /jwks OK; login/persistencia OFF\n");
});

(async () => {
  let passGenerada = null;
  try { await initDb(); dbOk = true; }
  catch (e) {
    const url = String(config.databaseUrl || "").replace(/:[^:@/]+@/, ":****@");
    console.warn("  ⚠ No se pudo inicializar Postgres:", e.message || e.code || String(e), "| url:", url);
  }
  try { await initKeys(); } catch (e) { console.warn("  ⚠ Claves de firma:", e.message || String(e)); }
  if (dbOk) { try { passGenerada = await seedAdmin(); } catch (e) { console.warn("  ⚠ Seed admin:", e.message || String(e)); } }
  server.listen(port);
  if (passGenerada) console.log(`  Admin: ${config.adminEmail}   ·   Pass (generada, se muestra una vez): ${passGenerada}`);
})();
