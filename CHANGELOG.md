# Changelog

Todos los cambios de Lockatus que se notan, de la version mas nueva a la mas vieja.
Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y
[Versionado Semantico](https://semver.org/lang/es/). Cada deploy sube la version y agrega su
seccion aca: sin ella el CI no publica la imagen.

## [0.2.0] - 2026-11-27

### Nuevo
- **Accesos mas pulido.** La columna de personas y el encabezado quedan fijos al desplazarse
  (ya no se ven restos de otras columnas por debajo) y aparece una sombra cuando hay columnas
  debajo. Flechas a los costados para ver mas apps, fila y columna iluminadas al pasar el mouse
  y navegacion con las flechas del teclado (Enter abre la lista de roles).
- **Roles con color por nivel** dentro de cada app: alto (superadmin, admin, dueño, dios),
  intermedio y basico (lectura, lector, humano). "Sin acceso" se ve como un guion. Todas las
  columnas tienen el mismo ancho y el rol mas largo entra entero.
- **Buscador de personas** (nombre o email) y **filtro de apps** (se recuerda en el navegador).
  Cada encabezado dice cuantas personas tienen acceso a esa app.
- **Guardado con Deshacer**: cada cambio se guarda al momento, la celda muestra si se esta
  guardando, si se guardo o si fallo (con reintento), y el aviso ofrece Deshacer.
- **Historial de cada celda**: quien cambio ese acceso y cuando, al apoyar el mouse o desde la
  lista de roles (`GET /api/admin/users/:id/history?app=`).
- **Cambios en bloque**: elegir varias personas y darles un rol de una app, y copiar los accesos
  de una persona a otra (desde el menu de la fila). Los dos muestran una vista previa de lo que
  cambia y piden confirmacion.

### Seguridad
- **Dar un rol alto pide confirmacion**, tambien por API: `PUT /api/admin/users/:id/role` con
  un rol alto responde 409 si no lleva `"confirm": true`. Los scripts que asignan roles altos
  (como `scripts/seed-suite.mjs`) ya lo mandan.
- **Nadie se puede sacar su propio admin de Lockatus** ni deshabilitarse, y Lockatus nunca queda
  sin un admin activo. Lo valida el servidor, con un candado que evita que dos cambios a la vez
  lo dejen sin admin. El catalogo de Lockatus no puede perder el rol admin.
- **Un admin deshabilitado pierde el panel** aunque su sesion siga abierta.
- La auditoria guarda el detalle de cada cambio de acceso: quien, a quien, en que app, rol
  anterior y nuevo, y desde donde (matriz, Deshacer, en bloque, copia).

## [0.1.7] - 2026-11-26

### Cambiado
- **Arcanum ofrece sus roles reales: superadmin, admin, operador y lectura** (antes admin,
  editor y lector). Desde Lockatus ya se puede dar superadmin de Arcanum, que es el que crea
  usuarios, cambia los topes de Monotributo, la receta de Mis Comprobantes y la conexion con
  Fisherboy. Los accesos que ya existian se pasan solos: editor a operador y lector a lectura.

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
