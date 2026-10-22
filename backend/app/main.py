"""FastAPI application: PS 5.3 Meeting-to-Action Tracker Agent."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlmodel import Session

from .api import followup, meetings, system, workflow
from .config import REPO_DIR, get_settings
from .db import init_db
from .services.processing import recover_interrupted
from .services.reminders import ReminderWorker

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("app")


@asynccontextmanager
async def lifespan(app: FastAPI):
    s = get_settings()
    engine = init_db()
    with Session(engine, expire_on_commit=False) as session:
        n = recover_interrupted(session)
        if n:
            log.warning("marked %d interrupted meeting job(s) as failed", n)
    if not s.organizer_token:
        log.warning("ORGANIZER_TOKEN is not set: all protected endpoints will refuse requests")
    worker = None
    if s.reminder_poll_seconds > 0:
        worker = ReminderWorker(engine, s.reminder_poll_seconds)
        worker.start()
    app.state.reminder_worker = worker
    yield
    if worker:
        worker.stop()


app = FastAPI(title="PS 5.3 Meeting-to-Action Tracker Agent", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=list(get_settings().cors_origins), allow_credentials=False,
                   allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE"],
                   allow_headers=["Authorization", "Content-Type"])


@app.middleware("http")
async def security_headers(request: Request, call_next):  # noqa: ANN001
    resp = await call_next(request)
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("X-Frame-Options", "DENY")
    resp.headers.setdefault("Referrer-Policy", "no-referrer")
    if request.url.path.startswith("/api/"):
        resp.headers.setdefault("Cache-Control", "no-store")
    return resp


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception) -> JSONResponse:
    log.exception("unhandled error on %s", request.url.path)
    return JSONResponse({"detail": f"internal error ({type(exc).__name__})"}, status_code=500)


for r in (meetings.router, workflow.router, followup.router, system.router):
    app.include_router(r)

# Serve the built frontend (if present) from the same origin.
DIST = REPO_DIR / "frontend" / "dist"
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str) -> FileResponse:
        if path.startswith("api/"):
            raise HTTPException(404, "not found")
        target = (DIST / path).resolve()
        if path and DIST.resolve() in target.parents and target.is_file():
            return FileResponse(target)
        return FileResponse(Path(DIST / "index.html"))
