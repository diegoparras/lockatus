# Imagen base pinneada por digest para builds reproducibles (node:24-slim, LTS).
FROM node:24-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54
WORKDIR /app
# Deps primero (cache de capa). Todas las deps son JS puro (pg/jose/otplib/qrcode).
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund
# Todo el repo, incluido CHANGELOG.md: de ahi salen el cartel de arranque y las novedades de la UI.
COPY . /app
EXPOSE 8080
# Healthcheck (Checkov CKV_DOCKER_2): el server responde /health. Honra PORT (Easypanel/Heroku
# inyectan su puerto); cae a 8080.
HEALTHCHECK --interval=30s --timeout=4s --start-period=15s --retries=3 \
  CMD node -e "const p=process.env.PORT||8080;fetch('http://127.0.0.1:'+p+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Seguridad: usuario NO-root (`node`, uid 1000, ya viene en la imagen).
USER node
CMD ["node", "server/index.js"]
