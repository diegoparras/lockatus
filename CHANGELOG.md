# Changelog

Todos los cambios de Lockatus que se notan, de la version mas nueva a la mas vieja.
Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y
[Versionado Semantico](https://semver.org/lang/es/). Cada deploy sube la version y agrega su
seccion aca: sin ella el CI no publica la imagen.

## [0.1.6] - 2026-11-20

### Seguridad
- **La contrasena generada del admin ya no se escribe en los registros del contenedor.** Sin
  `LOCKATUS_ADMIN_PASS`, queda en `/tmp/lockatus-admin-clave-inicial` (permisos 0600, solo la app la lee;
  `LOCKATUS_SECRETOS_DIR` cambia la carpeta) y el log dice como leerla desde la consola del servicio.
  Si el archivo se pierde, fijar `LOCKATUS_ADMIN_PASS` y reiniciar resetea la contrasena del admin.
- La contrasena generada pasa de 8 a 16 caracteres.

### Cambiado
- Los avisos del arranque dicen "AVISO:" en lugar de un simbolo (sin emojis en la consola).

## [0.1.5] - 2026-11-20

### Seguridad
- **`.dockerignore`**: un build local de la imagen ya no copia el `.env` (secretos), el historial
  de git ni el `node_modules` de la maquina. La imagen del CI no estaba afectada (se arma sobre
  el checkout, sin `.env`).

## [0.1.4] - 2026-11-20

### Nuevo
- **Cada deploy dice su version y que cambia.** Lo primero que escribe el contenedor al
  levantar (los registros del servicio en EasyPanel) es un cartel con la version y las
  novedades de este CHANGELOG, antes de cualquier aviso de configuracion o de Postgres.
- **Aviso de novedades en el panel**: al entrar despues de una actualizacion aparece
  "Novedades" con todo lo que cambio desde la ultima version vista en ese navegador (una sola
  vez). El historial queda a mano en el menu, **Novedades**, y en **Acerca de Lockatus**, con
  el enlace "Que cambio". Solo con sesion iniciada (`GET /api/novedades`).
- **Imagen etiquetada con la version** (`:0.1.4`, ademas de `:latest`) y Release `v0.1.4` en
  GitHub con estas mismas notas.

### Cambiado
- La imagen corre sobre **Node 24 LTS** (antes Node 22), fijada por digest para builds
  reproducibles, y el CI prueba y publica sobre Node 24.
