# app/main.py — ViMove FastAPI server (Render-ready, no build step)
from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path
from urllib.parse import urlencode

from fastapi import FastAPI, Request, Form, status
from fastapi.responses import (
    HTMLResponse,
    RedirectResponse,
    PlainTextResponse,
    JSONResponse,
    FileResponse,
)
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

from app import program_engine

# ---------------------------------------------------------------------
# Supabase (server side). Service key comes ONLY from the environment —
# never committed. URL + anon key are public.
# ---------------------------------------------------------------------
SUPABASE_URL = "https://sgnbrzqelnekzoasknzi.supabase.co"
SUPABASE_ANON = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNnbmJyenFlbG5la3pvYXNrbnpp"
    "Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUwMTEzMTcsImV4cCI6MjEwMDU4NzMxN30.oskSk-7NnxXO3Vkv44XQT3LzN8tzx4gmcZwKsLmaks8"
)
PATIENT_EMAIL_DOMAIN = "hasta.vimoveai.com"


def _supabase_key() -> str:
    return os.environ.get("SUPABASE_SERVICE_KEY", "")


def _http(method: str, url: str, headers: dict, data=None):
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            txt = r.read().decode() or "null"
            return r.status, json.loads(txt)
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or "null")
        except Exception:
            return e.code, None
    except Exception:
        return 0, None


def _caller_id(access_token: str):
    """Verify a Supabase access token and return the user id, or None."""
    if not access_token:
        return None
    st, data = _http(
        "GET", f"{SUPABASE_URL}/auth/v1/user",
        {"Authorization": f"Bearer {access_token}", "apikey": SUPABASE_ANON},
    )
    if st == 200 and isinstance(data, dict) and data.get("id"):
        return data["id"]
    return None


def _profile_role(uid: str, key: str):
    st, data = _http(
        "GET", f"{SUPABASE_URL}/rest/v1/profiles?id=eq.{uid}&select=role",
        {"Authorization": f"Bearer {key}", "apikey": key},
    )
    if st == 200 and isinstance(data, list) and data:
        return data[0].get("role")
    return None


def _slug_username(name: str) -> str:
    s = (name or "").strip().lower()
    for a, b in (("ı", "i"), ("ş", "s"), ("ğ", "g"), ("ü", "u"), ("ö", "o"), ("ç", "c")):
        s = s.replace(a, b)
    return re.sub(r"[^a-z0-9]", "", s)   # ASCII-only so the synthetic email is valid

# ---------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------
APP_DIR = Path(__file__).resolve().parent          # .../app
TEMPLATES_DIR = APP_DIR / "templates"              # .../app/templates
STATIC_DIR = APP_DIR / "static"                    # .../app/static
BASE_DIR = APP_DIR.parent                          # project root

# ---------------------------------------------------------------------
# App
# ---------------------------------------------------------------------
app = FastAPI(
    title="ViMove",
    description="AI-guided movement therapy — browser-based exercise tracking.",
    version="2.0.0",
)

app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
templates = Jinja2Templates(directory=str(TEMPLATES_DIR))

# Conditions that have a real, evidence-based program today (from programs.json).
# Other conditions (arthritis, balance, etc.) are shown as "coming soon" in the UI.
CONDITIONS = program_engine.list_conditions()

# Toggle the donation page on/off (hidden during the competition).
# Set to True to bring the Donate page + nav/footer links back.
DONATE_ENABLED = False


# ---------------------------------------------------------------------
# Template helper — injects shared context (request, year, active nav item)
# ---------------------------------------------------------------------
def render(template: str, request: Request, active: str = "", status_code: int = 200, **extra):
    ctx = {"request": request, "year": datetime.now().year, "active": active,
           "donate_enabled": DONATE_ENABLED}
    ctx.update(extra)
    return templates.TemplateResponse(template, ctx, status_code=status_code)


# ---------------------------------------------------------------------
# Security headers
#   CSP allows: jsDelivr (MediaPipe), Google Storage (model weights),
#   Google Fonts, and Google Analytics — while keeping the rest locked down.
# ---------------------------------------------------------------------
@app.middleware("http")
async def add_security_headers(request, call_next):
    resp = await call_next(request)
    resp.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "script-src 'self' https://cdn.jsdelivr.net https://www.googletagmanager.com "
        "'unsafe-eval' 'wasm-unsafe-eval' blob:; "
        "connect-src 'self' https://cdn.jsdelivr.net https://storage.googleapis.com "
        "https://www.google-analytics.com https://*.google-analytics.com "
        "https://www.googletagmanager.com "
        "https://sgnbrzqelnekzoasknzi.supabase.co wss://sgnbrzqelnekzoasknzi.supabase.co; "
        "img-src 'self' data: blob: https://www.googletagmanager.com https://*.google-analytics.com; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        "font-src 'self' https://fonts.gstatic.com data:; "
        "media-src 'self' blob: https://sgnbrzqelnekzoasknzi.supabase.co; "
        "worker-src 'self' blob:; "
        "frame-ancestors 'self'; "
        "object-src 'none';"
    )
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    resp.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    return resp


# ---------------------------------------------------------------------
# Health / API
# ---------------------------------------------------------------------
@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/api/ping")
def api_ping():
    return {"pong": True}


# ---------------------------------------------------------------------
# Pages
# ---------------------------------------------------------------------
@app.get("/", response_class=HTMLResponse)
def index(request: Request):
    return render("index.html", request, active="home", conditions=program_engine.all_conditions())


@app.get("/about", response_class=HTMLResponse)
def about(request: Request):
    return render("about.html", request, active="about")


@app.get("/progress", response_class=HTMLResponse)
def progress(request: Request):
    """Client-side progress dashboard (reads session history from localStorage)."""
    return render("progress.html", request, active="progress")


@app.get("/donate", response_class=HTMLResponse)
def donate(request: Request):
    """Donation page — hidden during the competition (see DONATE_ENABLED)."""
    if not DONATE_ENABLED:
        return RedirectResponse(url="/", status_code=status.HTTP_302_FOUND)
    return render("donate.html", request, active="donate")


@app.get("/community", response_class=HTMLResponse)
def community(request: Request):
    """Photo gallery of ViMove being used in the real world."""
    return render("community.html", request, active="community")


@app.get("/privacy", response_class=HTMLResponse)
def privacy(request: Request):
    """Privacy policy (required for the Play Store / camera use)."""
    return render("privacy.html", request, active="privacy")


# ---------------------------------------------------------------------
# Role panels (client-side role gating via Supabase; data protected by RLS)
# ---------------------------------------------------------------------
@app.get("/hasta", response_class=HTMLResponse)
def panel_hasta(request: Request):
    return render("panel_hasta.html", request, role="hasta")


@app.get("/uzman", response_class=HTMLResponse)
def panel_uzman(request: Request):
    return render("panel_uzman.html", request, role="uzman")


@app.get("/admin", response_class=HTMLResponse)
def panel_admin(request: Request):
    return render("panel_admin.html", request, role="super_admin")


@app.get("/giris", response_class=HTMLResponse)
def giris(request: Request):
    """Login page — username/password (patients) + Google (everyone else)."""
    return render("login.html", request, active="giris")


class CreatePatientBody(BaseModel):
    username: str
    password: str
    full_name: str = ""
    access_token: str


@app.post("/api/create-patient")
def create_patient(body: CreatePatientBody):
    """A specialist creates a patient account (username + password) linked to them."""
    key = _supabase_key()
    if not key:
        return JSONResponse({"error": "not_configured"}, status_code=503)
    caller = _caller_id(body.access_token)
    if not caller:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    role = _profile_role(caller, key)
    if role not in ("uzman", "super_admin"):
        return JSONResponse({"error": "forbidden", "detail": f"role={role}"}, status_code=403)

    username = _slug_username(body.username)
    if len(username) < 3 or len(body.password) < 6:
        return JSONResponse({"error": "invalid_input"}, status_code=400)
    email = f"{username}@{PATIENT_EMAIL_DOMAIN}"

    st, data = _http(
        "POST", f"{SUPABASE_URL}/auth/v1/admin/users",
        {"Authorization": f"Bearer {key}", "apikey": key, "Content-Type": "application/json"},
        {"email": email, "password": body.password, "email_confirm": True,
         "user_metadata": {"full_name": body.full_name or username, "username": username}},
    )
    if st not in (200, 201) or not isinstance(data, dict) or not data.get("id"):
        msg = str((data or {}).get("msg") or (data or {}).get("error_description") or "").lower()
        if st in (409, 422) or "already" in msg or "registered" in msg or "exists" in msg:
            return JSONResponse({"error": "exists"}, status_code=409)
        detail = {"status": st, "msg": (data or {}).get("msg") or (data or {}).get("error_code") or str(data)[:150]}
        return JSONResponse({"error": "create_failed", "detail": detail}, status_code=502)

    # link to the specialist + name (critical; service key bypasses RLS, role
    # stays 'hasta' from the signup trigger so no role change is needed)
    hdr = {"Authorization": f"Bearer {key}", "apikey": key,
           "Content-Type": "application/json", "Prefer": "return=minimal"}
    _http("PATCH", f"{SUPABASE_URL}/rest/v1/profiles?id=eq.{data['id']}", hdr,
          {"specialist_id": caller, "full_name": body.full_name or username})
    # store the username too (best-effort — ignored if the column doesn't exist yet)
    _http("PATCH", f"{SUPABASE_URL}/rest/v1/profiles?id=eq.{data['id']}", hdr, {"username": username})
    return {"ok": True, "username": username}


# ---------------------------------------------------------------------
# PWA: service worker served from root so its scope covers the whole site
# ---------------------------------------------------------------------
@app.get("/sw.js", include_in_schema=False)
def service_worker():
    return FileResponse(
        STATIC_DIR / "sw.js",
        media_type="application/javascript",
        headers={"Service-Worker-Allowed": "/", "Cache-Control": "no-cache"},
    )


@app.get("/teknoloji", response_class=HTMLResponse)
@app.get("/technology", response_class=HTMLResponse)
def technology(request: Request):
    """How the low-resolution vision pipeline works, with its benchmark."""
    bench = None
    f = APP_DIR / "data" / "lowres_bench.json"
    if f.exists():
        try:
            with f.open(encoding="utf-8") as fh:
                bench = json.load(fh)
        except Exception:
            bench = None
    return render("tech.html", request, active="tech", bench=bench)


@app.get("/veri-silme", response_class=HTMLResponse)
@app.get("/data-deletion", response_class=HTMLResponse)
def data_deletion(request: Request):
    """Account & data deletion instructions — required by Google Play for
    any app that lets users create an account."""
    return render("data_deletion.html", request, active="privacy")


@app.get("/manifest.webmanifest", include_in_schema=False)
def web_manifest():
    """Served from the app (not nginx) so the MIME type is exactly right —
    PWABuilder / Play's TWA check want application/manifest+json."""
    return FileResponse(
        STATIC_DIR / "manifest.webmanifest",
        media_type="application/manifest+json",
        headers={"Cache-Control": "no-cache"},
    )


@app.get("/.well-known/assetlinks.json", include_in_schema=False)
def assetlinks():
    """Digital Asset Links — links the domain to the Play Store (TWA) app.
    Paste the JSON produced by PWABuilder/Bubblewrap into app/data/assetlinks.json."""
    f = APP_DIR / "data" / "assetlinks.json"
    if f.exists():
        return FileResponse(f, media_type="application/json")
    return JSONResponse([], status_code=404)


@app.get("/exercises", response_class=HTMLResponse)
def exercises(request: Request):
    # Show each evidence-based program with its rationale + sources, at a
    # representative (age 65) dosing so the library is informative.
    programs = {slug: program_engine.build_program(slug, 65)
                for slug in program_engine.all_conditions()}
    return render("exercises.html", request, active="exercises", programs=programs)


@app.get("/start", response_class=HTMLResponse)
def start_form(request: Request, disease: str = "", age: str = "", gender: str = ""):
    """Session setup form. Optional query params pre-fill it (e.g. 'Change setup')."""
    last = {"disease": disease, "age": age, "gender": gender} if (disease or age or gender) else None
    return render("start.html", request, active="start",
                  last=last, conditions=program_engine.all_conditions())


@app.post("/start")
def start_post(
    request: Request,
    age: int = Form(...),
    gender: str = Form(...),
    disease: str = Form(...),
):
    gender = (gender or "").lower().strip()
    disease = (disease or "").lower().strip()

    active_slugs = {c["slug"] for c in CONDITIONS if c["active"]}
    if disease not in active_slugs:
        return render(
            "error.html", request,
            title="Condition not available yet",
            msg="That condition isn't available yet. Please choose one of the available programs.",
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    if gender not in ["male", "female", "other"]:
        return render(
            "error.html", request,
            title="Please pick a valid option",
            msg="Please choose one of the gender options to continue.",
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    # Stateless: carry the selection in the redirect URL (multi-user safe,
    # works on read-only hosting — no shared server-side file).
    qs = urlencode({"disease": disease, "age": age, "gender": gender})
    return RedirectResponse(url=f"/session?{qs}", status_code=status.HTTP_303_SEE_OTHER)


@app.get("/session", response_class=HTMLResponse)
def session(request: Request, disease: str = "parkinson", age: str = "65", gender: str = ""):
    """The live AI exercise screen, driven by a generated program (from query params)."""
    program = (program_engine.build_program(disease, age, gender)
               or program_engine.build_program("parkinson", age, gender))
    selection = {"disease": disease, "age": age, "gender": gender}
    return render("session.html", request, active="session", selection=selection, program=program)


@app.get("/api/program")
def api_program(disease: str = "parkinson", age: int = 65, gender: str = ""):
    """Inspect the generated program for any condition/age (debug & future use)."""
    prog = program_engine.build_program(disease, age, gender)
    if not prog:
        return JSONResponse({"error": "unknown condition"}, status_code=404)
    return prog


# ---------------------------------------------------------------------
# 404
# ---------------------------------------------------------------------
@app.exception_handler(404)
def not_found(request: Request, exc):
    if (TEMPLATES_DIR / "404.html").exists():
        return render("404.html", request, status_code=404)
    return PlainTextResponse("404 Not Found", status_code=404)
