// dev.mjs — arranque local para previsualización/desarrollo (no Docker). Lee el .env gitignored,
// arma DATABASE_URL hacia el Postgres del compose (127.0.0.1:55433) y delega en el server.
import { readFileSync } from "node:fs";
try {
  for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch { /* sin .env: caen los defaults */ }
process.env.DATABASE_URL ||= `postgresql://${process.env.POSTGRES_USER || "lockatus"}:${process.env.POSTGRES_PASSWORD || "lockatus"}@127.0.0.1:55433/${process.env.POSTGRES_DB || "lockatus"}`;
process.env.PORT ||= "8081";
await import("../server/index.js");
