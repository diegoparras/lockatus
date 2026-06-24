"""app.py — app de DEMO en FastAPI que se federa con Lockatus usando el cliente Python.
Es el patrón de referencia para las apps Python de la suite (Escriba/Fisherboy/Anonimal) detrás
del flag AUTH_MODE=federado. No toca ninguna app: es el ejemplo corrible.

    uvicorn app:app --port 8091     (con Lockatus arriba)
"""
import os
import sys
import time
import secrets

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, RedirectResponse

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "clients", "python"))
from lockatus_client import Lockatus  # noqa: E402

PORT = int(os.environ.get("PORT", "8091"))
ISSUER = os.environ.get("LOCKATUS_ISSUER", "http://localhost:8081")
CLIENT_ID = os.environ.get("CLIENT_ID", "anonimal")  # se federa como "anonimal"

lk = Lockatus(ISSUER, CLIENT_ID, f"http://localhost:{PORT}/callback", os.environ.get("DEMO_SECRET", "demo-py-secret-solo-dev"))
SESSION, TX = "lk_session", "lk_tx"
app = FastAPI()


def page(body: str, status: int = 200) -> HTMLResponse:
    return HTMLResponse(
        f"<!doctype html><meta charset=utf-8><title>App demo Python · Lockatus</title>"
        f"<body style='font-family:system-ui;max-width:540px;margin:3rem auto;line-height:1.6'>"
        f"<h2>App demo Python <span style='color:#888;font-weight:400'>(FastAPI, federada como \"{CLIENT_ID}\")</span></h2>{body}",
        status_code=status,
    )


@app.get("/login")
async def login():
    verifier, challenge = lk.pkce()
    state, nonce = secrets.token_urlsafe(12), secrets.token_urlsafe(12)
    tx = lk.sign({"verifier": verifier, "state": state, "nonce": nonce, "exp": (time.time() + 600) * 1000})
    resp = RedirectResponse(lk.authorize_url(state, nonce, challenge))
    resp.set_cookie(TX, tx, httponly=True, max_age=600, samesite="lax")
    return resp


@app.get("/callback")
async def callback(request: Request):
    if request.query_params.get("error"):
        return page(f"<p>Acceso denegado por Lockatus: {request.query_params['error']}</p>", 403)
    tx = lk.unsign(request.cookies.get(TX, ""))
    code, state = request.query_params.get("code"), request.query_params.get("state")
    if not tx or not code or state != tx["state"]:
        return RedirectResponse("/")
    try:
        tok = await lk.exchange(code, tx["verifier"])
        await lk.verify_jwt(tok["id_token"], audience=CLIENT_ID, nonce=tx["nonce"])
        ac = await lk.verify_jwt(tok["access_token"], audience=CLIENT_ID)
        resp = RedirectResponse("/")
        resp.delete_cookie(TX)
        resp.set_cookie(SESSION, lk.sign({"email": ac["email"], "role": ac.get("role"), "exp": (time.time() + 12 * 3600) * 1000}), httponly=True, max_age=12 * 3600, samesite="lax")
        return resp
    except Exception as e:  # noqa: BLE001
        return page(f"<p>Login fallido: {e}</p>", 400)


@app.get("/logout")
async def logout():
    resp = RedirectResponse("/")
    resp.delete_cookie(SESSION)
    return resp


@app.get("/")
async def home(request: Request):
    u = lk.unsign(request.cookies.get(SESSION, ""))
    if u:
        return page(f"<p>Entraste como <b>{u['email']}</b>.</p>"
                    f"<p>Tu rol en esta app: <b style='color:#6c4fb3'>{u.get('role')}</b> — lo dijo Lockatus, esta app no tiene usuarios propios.</p>"
                    f"<p><a href='/logout'>Cerrar sesión</a></p>")
    return page("<p>No estás logueado en esta app.</p><p><a href='/login'>Entrar con Lockatus →</a></p>")
