// server.mjs — app de DEMO que se federa con Lockatus usando la mini-lib de cliente.
// Es el patrón que una app real (Fulgoria, Selega, …) sumaría detrás del flag AUTH_MODE=federado.
// No toca ninguna app de la suite: es el ejemplo/refencia de integración.
import http from "node:http";
import { createLockatusClient } from "../../client/lockatus-client.mjs";

const PORT = Number(process.env.PORT) || 8090;
const ISSUER = process.env.LOCKATUS_ISSUER || "http://localhost:8081";
const CLIENT_ID = process.env.CLIENT_ID || "fulgoria"; // se federa como "fulgoria"

const lk = createLockatusClient({
  issuer: ISSUER,
  clientId: CLIENT_ID,
  redirectUri: `http://localhost:${PORT}/callback`,
  secret: process.env.DEMO_SECRET || "demo-secret-solo-dev",
});

const page = (body) => `<!doctype html><meta charset=utf-8><title>App demo · Lockatus</title>
<body style="font-family:system-ui;max-width:540px;margin:3rem auto;line-height:1.6">
<h2>App demo <span style="color:#888;font-weight:400">(federada con Lockatus como "${CLIENT_ID}")</span></h2>${body}`;

http.createServer((req, res) => {
  const path = req.url.split("?")[0];
  if (path === "/login") return lk.beginLogin(req, res);
  if (path === "/callback") return void lk.handleCallback(req, res);
  if (path === "/logout") return lk.logout(req, res);

  const user = lk.getUser(req);
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(page(user
    ? `<p>Entraste como <b>${user.email}</b>.</p>
       <p>Tu rol en esta app: <b style="color:#6655d6">${user.role}</b> — lo dijo Lockatus, esta app no tiene usuarios propios.</p>
       <p><a href="/logout">Cerrar sesión</a></p>`
    : `<p>No estás logueado en esta app.</p><p><a href="/login">Entrar con Lockatus →</a></p>`));
}).listen(PORT, () => console.log(`App demo en http://localhost:${PORT}  (issuer: ${ISSUER}, client_id: ${CLIENT_ID})`));
