// app.js — front mínimo del login. El flujo real (password + 2FA → redirect OIDC) se cabla encima.
const f = document.getElementById("login");
const msg = document.getElementById("msg");
f?.addEventListener("submit", (e) => {
  e.preventDefault();
  msg.textContent = "Base lista. El login con 2FA y el panel de accesos se cablean en el próximo paso.";
});
