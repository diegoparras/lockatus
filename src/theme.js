// theme.js — fija el tema ANTES del primer paint para evitar el flash claro→oscuro.
// Externo (no inline) porque la CSP de Lockatus es script-src 'self'.
// Default: respeta prefers-color-scheme si el usuario no eligió todavía.
(function () {
  try {
    var t = localStorage.getItem("lockatus.theme");
    if (!t && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) t = "dark";
    if (t === "dark") document.documentElement.dataset.theme = "dark";
  } catch (e) { /* sin storage: queda en claro */ }
})();
