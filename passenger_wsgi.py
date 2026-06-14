# Phusion Passenger entry point for cPanel "Setup Python App".
#
# ViMove is a FastAPI (ASGI) application, but Passenger speaks WSGI — so we
# wrap the ASGI app with a2wsgi's ASGIMiddleware to expose a WSGI `application`.
# (Only used on cPanel/Passenger hosting; a VPS runs gunicorn/uvicorn directly.)
import os
import sys

# Make sure the application root (this folder) is importable.
sys.path.insert(0, os.path.dirname(__file__))

from a2wsgi import ASGIMiddleware
from app.main import app as asgi_app

application = ASGIMiddleware(asgi_app)
