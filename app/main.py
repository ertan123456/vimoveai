# app/main.py — ViMove FastAPI server (Render-ready, no build step)
from __future__ import annotations

from datetime import datetime
from pathlib import Path
from urllib.parse import urlencode

from fastapi import FastAPI, Request, Form, status
from fastapi.responses import (
    HTMLResponse,
    RedirectResponse,
    PlainTextResponse,
    JSONResponse,
)
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from app import program_engine

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


# ---------------------------------------------------------------------
# Template helper — injects shared context (request, year, active nav item)
# ---------------------------------------------------------------------
def render(template: str, request: Request, active: str = "", status_code: int = 200, **extra):
    ctx = {"request": request, "year": datetime.now().year, "active": active}
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
        "https://www.googletagmanager.com; "
        "img-src 'self' data: blob: https://www.googletagmanager.com https://*.google-analytics.com; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        "font-src 'self' https://fonts.gstatic.com data:; "
        "media-src 'self' blob:; "
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
